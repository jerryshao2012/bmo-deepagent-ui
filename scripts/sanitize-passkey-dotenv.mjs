#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  link as linkFile,
  lstat,
  mkdir,
  open,
  rename as renameFile,
  rmdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const protectedKeys = new Set([
  "FRONTEND_URLS",
  "PASSKEY_DERIVE_FROM_FRONTEND_URLS",
  "PASSKEY_ENABLED",
  "PASSKEY_ORIGIN",
  "PASSKEY_ORIGINS",
  "PASSKEY_PROXY_ID",
  "PASSKEY_PROXY_SECRET",
  "PASSKEY_RP_ID",
  "PASSKEY_RP_IDS",
]);

class SanitizeError extends Error {}

class RecoveryError extends SanitizeError {
  constructor(backupPath) {
    super(
      `automatic restore failed; original file remains recoverable. ` +
        `Move it back to requested input path before retrying.\n` +
        `Recovery backup: ${backupPath}`
    );
  }
}

class ConcurrentRecoveryError extends SanitizeError {
  constructor(backupPath) {
    super(
      `newer input pathname was preserved; prior original remains recoverable. ` +
        `Review both files before retrying.\n` +
        `Recovery backup: ${backupPath}`
    );
  }
}

const fail = (message) => {
  throw new SanitizeError(message);
};

function parseArguments(argv) {
  let input;
  let action;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--input") {
      if (input !== undefined || index + 1 >= argv.length) {
        fail("--input requires exactly one file");
      }
      input = argv[++index];
    } else if (argument === "--check" || argument === "--sanitize") {
      if (action !== undefined)
        fail("choose exactly one of --check or --sanitize");
      action = argument.slice(2);
    } else {
      fail(`unknown argument: ${argument}`);
    }
  }
  if (!input) fail("--input FILE is required");
  if (!action) fail("choose exactly one of --check or --sanitize");
  return { input: path.resolve(input), action };
}

function parseValue(rawValue, lineNumber) {
  let value = rawValue.trim();
  if (/\0|`|\$\(|\$\{/.test(value)) {
    fail(`unsupported ambiguous syntax on line ${lineNumber}`);
  }
  if (value.endsWith("\\")) {
    fail(`unsupported line continuation on line ${lineNumber}`);
  }
  if (value === "") return;
  if (value.startsWith("'") || value.startsWith('"')) {
    const quote = value[0];
    let escaped = false;
    let closing = -1;
    for (let index = 1; index < value.length; index += 1) {
      const character = value[index];
      if (quote === '"' && character === "\\" && !escaped) {
        escaped = true;
        continue;
      }
      if (character === quote && !escaped) {
        closing = index;
        break;
      }
      escaped = false;
    }
    if (closing < 0) fail(`unterminated quoted value on line ${lineNumber}`);
    const suffix = value.slice(closing + 1).trim();
    if (suffix !== "" && !suffix.startsWith("#")) {
      fail(`unsupported content after value on line ${lineNumber}`);
    }
    if (quote === '"') {
      const quoted = value.slice(1, closing);
      if (/\\(?![\\"nrt])/.test(quoted)) {
        fail(`unsupported escape in value on line ${lineNumber}`);
      }
    }
    return;
  }
  if (value.includes("'") || value.includes('"')) {
    fail(`unsupported quote in unquoted value on line ${lineNumber}`);
  }
  value = value.replace(/[ \t]+#.*$/, "").trimEnd();
  if (value.includes("\\")) {
    fail(`unsupported escape in unquoted value on line ${lineNumber}`);
  }
}

function splitRawLines(content) {
  const lines = [];
  let start = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === 0x0a) {
      lines.push(content.subarray(start, index + 1));
      start = index + 1;
    }
  }
  if (start < content.length) lines.push(content.subarray(start));
  return lines;
}

function parseDotenv(content) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    fail("input is not valid UTF-8");
  }
  const parsed = [];
  const seen = new Set();
  for (const [index, raw] of splitRawLines(content).entries()) {
    const lineNumber = index + 1;
    const body = raw.toString("utf8").replace(/[\r\n]+$/, "");
    if (/^[ \t]*(?:#|$)/.test(body)) {
      parsed.push({ raw });
      continue;
    }
    const match = body.match(
      /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=(.*)$/
    );
    if (!match) {
      const protectedMatch = body.match(
        /^[ \t]*(?:export[ \t]+)?(PASSKEY_[A-Za-z0-9_]*|FRONTEND_URLS)(?:[ \t]|$)/
      );
      if (protectedMatch) {
        fail(`malformed protected assignment for ${protectedMatch[1]}`);
      }
      fail(`unsupported dotenv syntax on line ${lineNumber}`);
    }
    const key = match[1];
    parseValue(match[2], lineNumber);
    if (seen.has(key)) fail(`duplicate assignment for ${key}`);
    seen.add(key);
    parsed.push({ raw, key });
  }
  return parsed;
}

async function openSafeRegularFile(input, missingIsValid = false) {
  let before;
  try {
    before = await lstat(input);
  } catch (error) {
    if (error?.code === "ENOENT" && missingIsValid) return null;
    if (error?.code === "ENOENT") fail(`input file does not exist: ${input}`);
    fail(`cannot inspect input file: ${input}`);
  }
  if (!before.isFile() || before.isSymbolicLink()) {
    fail(`input must be a regular non-symlink file: ${input}`);
  }
  if (before.nlink !== 1) fail(`input file must not have hard links: ${input}`);
  let handle;
  try {
    handle = await open(
      input,
      constants.O_RDONLY | constants.O_CLOEXEC | (constants.O_NOFOLLOW ?? 0)
    );
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino) {
      fail(`input file changed while opening: ${input}`);
    }
    return { handle, stat: after };
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof SanitizeError) throw error;
    fail(`cannot safely open input file: ${input}`);
  }
}

async function readSafeInput(input) {
  const { handle, stat: inputStat } = await openSafeRegularFile(input);
  try {
    return { content: await handle.readFile(), inputStat };
  } finally {
    await handle.close();
  }
}

function snapshotMatches(current, expectedStat, expectedContent) {
  return !(
    current.inputStat.dev !== expectedStat.dev ||
    current.inputStat.ino !== expectedStat.ino ||
    current.inputStat.size !== expectedStat.size ||
    current.inputStat.mtimeNs !== expectedStat.mtimeNs ||
    current.inputStat.ctimeNs !== expectedStat.ctimeNs ||
    !current.content.equals(expectedContent)
  );
}

async function assertInputUnchanged(input, expectedStat, expectedContent) {
  const current = await readSafeInput(input);
  if (!snapshotMatches(current, expectedStat, expectedContent)) {
    fail("input file changed during sanitize");
  }
}

async function createTemp(input) {
  const directory = path.dirname(input);
  const base = path.basename(input);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const tempPath = path.join(
      directory,
      `.${base}.sanitize.${randomBytes(8).toString("hex")}`
    );
    try {
      const handle = await open(
        tempPath,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_CLOEXEC,
        0o600
      );
      return { handle, tempPath };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  fail("could not create safe temporary file");
}

async function createBackupDirectory(input) {
  const parent = path.dirname(input);
  const base = path.basename(input);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const directory = path.join(
      parent,
      `.${base}.sanitize-backup.${randomBytes(8).toString("hex")}`
    );
    try {
      await mkdir(directory, { mode: 0o700 });
      return directory;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  fail("could not create safe backup directory");
}

async function unlinkKnownPath(candidate, expectedStat) {
  let current;
  try {
    current = await lstat(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
  if (current.dev !== expectedStat.dev || current.ino !== expectedStat.ino) {
    return false;
  }
  await unlink(candidate);
  return true;
}

async function restoreMovedPath(backupPath, input, exclusiveLink, movedStat) {
  try {
    await exclusiveLink(backupPath, input);
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
  await unlinkKnownPath(backupPath, movedStat);
  return true;
}

async function pathExists(candidate) {
  try {
    await lstat(candidate);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function commitSanitizedInput({
  input,
  inputStat,
  originalContent,
  tempPath,
  dependencies,
}) {
  const moveOriginal = dependencies.moveOriginal ?? renameFile;
  const exclusiveLink = dependencies.exclusiveLink ?? linkFile;
  const backupDirectory = await createBackupDirectory(input);
  const backupPath = path.join(backupDirectory, "original");
  let moved = false;
  let backupKnownOriginal = false;
  let backupExists = false;
  let retainRecoveryBackup = false;
  try {
    await assertInputUnchanged(input, inputStat, originalContent);
    await dependencies.afterCheckBeforeMove?.();
    await moveOriginal(input, backupPath);
    moved = true;
    backupExists = true;
    await dependencies.afterOriginalMove?.();

    let movedSnapshot;
    try {
      movedSnapshot = await readSafeInput(backupPath);
    } catch {
      movedSnapshot = null;
    }
    if (
      movedSnapshot === null ||
      !snapshotMatches(movedSnapshot, inputStat, originalContent)
    ) {
      try {
        const restored = await restoreMovedPath(
          backupPath,
          input,
          exclusiveLink,
          movedSnapshot?.inputStat ?? inputStat
        );
        if (restored) backupExists = false;
      } catch {
        if (await pathExists(input)) {
          backupExists = !(await unlinkKnownPath(
            backupPath,
            movedSnapshot?.inputStat ?? inputStat
          ));
        } else {
          retainRecoveryBackup = true;
          throw new RecoveryError(backupPath);
        }
      }
      fail("input file changed during sanitize");
    }
    backupKnownOriginal = true;

    try {
      await exclusiveLink(tempPath, input);
    } catch (error) {
      if (error?.code === "EEXIST" || (await pathExists(input))) {
        retainRecoveryBackup = true;
        throw new ConcurrentRecoveryError(backupPath);
      }
      try {
        const restored = await restoreMovedPath(
          backupPath,
          input,
          exclusiveLink,
          inputStat
        );
        if (restored) backupExists = false;
      } catch {
        if (await pathExists(input)) {
          backupExists = !(await unlinkKnownPath(backupPath, inputStat));
        } else {
          retainRecoveryBackup = true;
          throw new RecoveryError(backupPath);
        }
      }
      throw error;
    }

    backupExists = !(await unlinkKnownPath(backupPath, inputStat));
    return;
  } finally {
    if (moved && backupExists && backupKnownOriginal && !retainRecoveryBackup) {
      try {
        const restored = await restoreMovedPath(
          backupPath,
          input,
          exclusiveLink,
          inputStat
        );
        if (restored) backupExists = false;
      } catch {
        retainRecoveryBackup = true;
      }
      if (backupExists && !retainRecoveryBackup && (await pathExists(input))) {
        backupExists = !(await unlinkKnownPath(backupPath, inputStat).catch(
          () => false
        ));
      }
    }
    if (!backupExists) await rmdir(backupDirectory).catch(() => {});
  }
}

export async function sanitizePasskeyDotenv(argv, dependencies = {}) {
  const report = dependencies.report ?? (() => {});
  let tempPath = "";
  let tempHandle;
  let tempStat;
  let inputHandle;
  try {
    const { input, action } = parseArguments(argv);
    const opened = await openSafeRegularFile(input, true);
    if (opened === null) return 0;
    inputHandle = opened.handle;
    const inputStat = opened.stat;
    const content = await inputHandle.readFile();
    const parsed = parseDotenv(content);
    const found = parsed.filter(({ key }) => protectedKeys.has(key));
    if (action === "check") {
      if (found.length > 0) {
        fail(
          `deployment-owned keys are not allowed: ${found
            .map(({ key }) => key)
            .join(", ")}`
        );
      }
      return 0;
    }

    const sanitized = Buffer.concat(
      parsed.filter(({ key }) => !protectedKeys.has(key)).map(({ raw }) => raw)
    );
    ({ handle: tempHandle, tempPath } = await createTemp(input));
    await tempHandle.chmod(inputStat.mode & 0o7777);
    await tempHandle.writeFile(sanitized);
    await tempHandle.sync();
    tempStat = await tempHandle.stat();
    await tempHandle.close();
    tempHandle = undefined;
    await commitSanitizedInput({
      input,
      inputStat,
      originalContent: content,
      tempPath,
      dependencies,
    });
    await unlinkKnownPath(tempPath, tempStat);
    tempPath = "";
    return 0;
  } catch (error) {
    report(
      `Error: ${
        error instanceof SanitizeError
          ? error.message
          : "safe file update failed"
      }`
    );
    return 2;
  } finally {
    await inputHandle?.close().catch(() => {});
    await tempHandle?.close().catch(() => {});
    if (tempPath && tempStat) {
      await unlinkKnownPath(tempPath, tempStat).catch(() => {});
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const status = await sanitizePasskeyDotenv(process.argv.slice(2), {
    report: (message) => process.stderr.write(`${message}\n`),
  });
  process.exitCode = status;
}
