import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  link,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const sanitizerPath = path.join(
  repoRoot,
  "scripts/sanitize-passkey-dotenv.mjs"
);

const source = async (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

const extractPasskeysSection = (readme) =>
  readme.match(/^### Passkeys\b[\s\S]*?(?=^#{1,3}\s|(?![\s\S]))/m)?.[0];

const hasRequiredOAuthRecoveryGuidance = (section) => {
  if (!section) return false;

  const guidance = section.match(
    /\bOAuth\b\s+must\s+remain\s+available\b([^.!?]*\brecovery\b)/i
  );

  return (
    guidance !== null &&
    !/\b(?:no|not|never|without|except|unavailable)\b/i.test(guidance[1])
  );
};

const runSanitizer = (args) =>
  spawnSync(process.execPath, [sanitizerPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });

const withTempDir = async (callback) => {
  const root = await mkdtemp(path.join(tmpdir(), "ui-passkey-dotenv-test-"));
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test("passkey dotenv check accepts clean bytes and rejects every deployment-owned key without leakage", async () => {
  await withTempDir(async (root) => {
    const input = path.join(root, "private.env");
    const clean = Buffer.from("OTHER=kept\r\n# comment\r\nEMPTY=\r\n");
    await writeFile(input, clean);

    const accepted = runSanitizer(["--input", input, "--check"]);
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(accepted.stdout, "");
    assert.equal(accepted.stderr, "");
    assert.deepEqual(await readFile(input), clean);

    for (const key of [
      "PASSKEY_PROXY_SECRET",
      "PASSKEY_ORIGIN",
      "PASSKEY_PROXY_ID",
      "PASSKEY_ENABLED",
      "FRONTEND_URLS",
      "PASSKEY_ORIGINS",
      "PASSKEY_RP_ID",
      "PASSKEY_RP_IDS",
      "PASSKEY_DERIVE_FROM_FRONTEND_URLS",
    ]) {
      const canary = `never-print-${key.toLowerCase()}`;
      const original = Buffer.from(`${key}='${canary}'\nOTHER=ok\n`);
      await writeFile(input, original);
      const rejected = runSanitizer(["--input", input, "--check"]);
      assert.equal(rejected.status, 2, `${key}: ${rejected.stderr}`);
      assert.match(rejected.stderr, new RegExp(key));
      assert.doesNotMatch(
        `${rejected.stdout}${rejected.stderr}`,
        new RegExp(canary)
      );
      assert.deepEqual(await readFile(input), original);
    }
  });
});

test("passkey dotenv sanitize preserves unrelated bytes, newline style, mode, and cleans temp files", async () => {
  await withTempDir(async (root) => {
    const input = path.join(root, "private.env");
    const original = Buffer.from(
      "# private\r\nUNCHANGED = ' spaced # value ' # keep\r\nPASSKEY_ORIGIN=https://old.example\r\nPASSKEY_PROXY_SECRET=private-canary\r\nLAST=kept"
    );
    const expected = Buffer.from(
      "# private\r\nUNCHANGED = ' spaced # value ' # keep\r\nLAST=kept"
    );
    await writeFile(input, original);
    await chmod(input, 0o640);

    const result = runSanitizer(["--input", input, "--sanitize"]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.deepEqual(await readFile(input), expected);
    assert.equal((await stat(input)).mode & 0o777, 0o640);
    assert.deepEqual(
      (await readdir(root)).filter((name) => name.includes(".sanitize.")),
      []
    );
  });
});

test("passkey dotenv rejects duplicate, malformed, and ambiguous syntax without changing bytes", async () => {
  await withTempDir(async (root) => {
    const input = path.join(root, "private.env");
    for (const content of [
      "OTHER=one\nOTHER=two\n",
      "PASSKEY_PROXY_SECRET=one\nPASSKEY_PROXY_SECRET=two\n",
      "PASSKEY_ORIGIN\nOTHER=kept\n",
      "OTHER=$(unsafe-command)\n",
      "PASSKEY_ORIGIN=one\\\ntwo\n",
      'OTHER="unterminated\n',
    ]) {
      const original = Buffer.from(content);
      await writeFile(input, original);
      const result = runSanitizer(["--input", input, "--sanitize"]);
      assert.equal(
        result.status,
        2,
        `${JSON.stringify(content)}: ${result.stderr}`
      );
      assert.equal(result.stdout, "");
      assert.deepEqual(await readFile(input), original);
      assert.deepEqual(
        (await readdir(root)).filter((name) => name.includes(".sanitize.")),
        []
      );
    }
  });
});

test("passkey dotenv treats missing input as valid no-private-config state", async () => {
  await withTempDir(async (root) => {
    const input = path.join(root, "missing.env");

    for (const action of ["--check", "--sanitize"]) {
      const result = runSanitizer(["--input", input, action]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      await assert.rejects(lstat(input), { code: "ENOENT" });
      assert.deepEqual(await readdir(root), []);
    }
  });
});

test("passkey dotenv refuses symlink and hard-linked inputs", async () => {
  await withTempDir(async (root) => {
    const input = path.join(root, "private.env");
    const alias = path.join(root, "alias.env");
    const linked = path.join(root, "linked.env");
    const original = Buffer.from("PASSKEY_ORIGIN=https://old.example\n");
    await writeFile(input, original);
    await symlink(input, alias);

    const symlinkResult = runSanitizer(["--input", alias, "--sanitize"]);
    assert.equal(symlinkResult.status, 2);
    await link(input, linked);
    const hardlinkResult = runSanitizer(["--input", input, "--sanitize"]);
    assert.equal(hardlinkResult.status, 2);
    assert.deepEqual(await readFile(input), original);
    assert.deepEqual(await readFile(linked), original);
    assert.equal((await lstat(alias)).isSymbolicLink(), true);
  });
});

test("passkey dotenv injected move failure preserves bytes with no residue", async () => {
  const { sanitizePasskeyDotenv } = await import(sanitizerPath);
  await withTempDir(async (root) => {
    const input = path.join(root, "private.env");
    const original = Buffer.from(
      "PASSKEY_PROXY_SECRET=private-canary\nOTHER=old\n"
    );
    await writeFile(input, original);

    const failed = await sanitizePasskeyDotenv(
      ["--input", input, "--sanitize"],
      {
        moveOriginal: async () => {
          const error = new Error("injected move failure");
          error.code = "EIO";
          throw error;
        },
      }
    );
    assert.equal(failed, 2);
    assert.deepEqual(await readFile(input), original);
    assert.deepEqual(
      (await readdir(root)).filter((name) => name.includes(".sanitize")),
      []
    );
  });
});

test("passkey dotenv replacement after final check is restored and never overwritten", async () => {
  const { sanitizePasskeyDotenv } = await import(sanitizerPath);
  await withTempDir(async (root) => {
    const input = path.join(root, "private.env");
    const original = Buffer.from(
      "PASSKEY_PROXY_SECRET=private-canary\nOTHER=old\n"
    );
    const replacement = Buffer.from("OTHER=new-after-check\n");
    await writeFile(input, original);

    const raced = await sanitizePasskeyDotenv(
      ["--input", input, "--sanitize"],
      {
        afterCheckBeforeMove: async () => {
          const concurrent = path.join(root, "concurrent.env");
          await writeFile(concurrent, replacement);
          await rename(concurrent, input);
        },
      }
    );
    assert.equal(raced, 2);
    assert.deepEqual(await readFile(input), replacement);
    assert.deepEqual(
      (await readdir(root)).filter((name) => name.includes(".sanitize")),
      []
    );
  });
});

test("passkey dotenv newer pathname wins while prior original remains recoverable", async () => {
  const { sanitizePasskeyDotenv } = await import(sanitizerPath);
  await withTempDir(async (root) => {
    const input = path.join(root, "private.env");
    const original = Buffer.from(
      "PASSKEY_PROXY_SECRET=private-canary\nOTHER=old\n"
    );
    const replacement = Buffer.from("OTHER=new-after-move\n");
    await writeFile(input, original);
    await chmod(input, 0o640);
    const diagnostics = [];

    const raced = await sanitizePasskeyDotenv(
      ["--input", input, "--sanitize"],
      {
        afterOriginalMove: async () => {
          await writeFile(input, replacement, { mode: 0o600 });
        },
        report: (message) => diagnostics.push(message),
      }
    );

    assert.equal(raced, 2);
    assert.deepEqual(await readFile(input), replacement);
    assert.equal((await stat(input)).mode & 0o777, 0o600);
    assert.equal(diagnostics.length, 1);
    assert.doesNotMatch(diagnostics[0], /private-canary/);
    const recoveryPath = diagnostics[0].match(/Recovery backup: (.+)$/m)?.[1];
    assert.ok(recoveryPath, diagnostics[0]);
    assert.deepEqual(await readFile(recoveryPath), original);
    assert.equal((await stat(recoveryPath)).mode & 0o777, 0o640);
    assert.match(diagnostics[0], /newer input pathname.*preserved/i);
    assert.deepEqual(
      (await readdir(root)).filter((name) => name.includes(".sanitize.")),
      []
    );
    assert.equal(
      (await readdir(root)).filter((name) => name.includes(".sanitize-backup."))
        .length,
      1
    );
  });
});

test("passkey dotenv install-link failure atomically restores original with bytes and mode", async () => {
  const { sanitizePasskeyDotenv } = await import(sanitizerPath);
  await withTempDir(async (root) => {
    const input = path.join(root, "private.env");
    const original = Buffer.from(
      "PASSKEY_PROXY_SECRET=private-canary\nOTHER=old\n"
    );
    await writeFile(input, original);
    await chmod(input, 0o640);
    let linkAttempts = 0;

    const failed = await sanitizePasskeyDotenv(
      ["--input", input, "--sanitize"],
      {
        exclusiveLink: async (source, destination) => {
          linkAttempts += 1;
          if (linkAttempts === 1) {
            const error = new Error("injected install link failure");
            error.code = "EPERM";
            throw error;
          }
          await link(source, destination);
        },
      }
    );

    assert.equal(failed, 2);
    assert.deepEqual(await readFile(input), original);
    assert.equal((await stat(input)).mode & 0o777, 0o640);
    assert.deepEqual(
      (await readdir(root)).filter((name) => name.includes(".sanitize")),
      []
    );
  });
});

test("passkey dotenv persistent install and restore failure retains exact recovery backup safely", async () => {
  const { sanitizePasskeyDotenv } = await import(sanitizerPath);
  await withTempDir(async (root) => {
    const input = path.join(root, "private.env");
    const original = Buffer.from(
      "PASSKEY_PROXY_SECRET=never-print-private-canary\nOTHER=old\n"
    );
    const diagnostics = [];
    await writeFile(input, original);
    await chmod(input, 0o640);

    const failed = await sanitizePasskeyDotenv(
      ["--input", input, "--sanitize"],
      {
        exclusiveLink: async () => {
          const error = new Error("injected persistent link failure");
          error.code = "EPERM";
          throw error;
        },
        report: (message) => diagnostics.push(message),
      }
    );

    assert.equal(failed, 2);
    await assert.rejects(lstat(input), { code: "ENOENT" });
    assert.equal(diagnostics.length, 1);
    assert.doesNotMatch(diagnostics[0], /never-print-private-canary/);
    const recoveryPath = diagnostics[0].match(/Recovery backup: (.+)$/m)?.[1];
    assert.ok(recoveryPath, diagnostics[0]);
    assert.equal(path.dirname(path.dirname(recoveryPath)), root);
    assert.deepEqual(await readFile(recoveryPath), original);
    assert.equal((await stat(recoveryPath)).mode & 0o777, 0o640);
    assert.match(diagnostics[0], /move it back to/i);
    assert.deepEqual(
      (await readdir(root)).filter((name) => name.includes(".sanitize.")),
      []
    );
    assert.equal(
      (await readdir(root)).filter((name) => name.includes(".sanitize-backup."))
        .length,
      1
    );
  });
});

test("passkey dotenv persistent link failure preserves newer input and prior backup", async () => {
  const { sanitizePasskeyDotenv } = await import(sanitizerPath);
  await withTempDir(async (root) => {
    const input = path.join(root, "private.env");
    const original = Buffer.from(
      "PASSKEY_PROXY_SECRET=private-canary\nOTHER=old\n"
    );
    const replacement = Buffer.from("OTHER=newer-wins\n");
    const diagnostics = [];
    await writeFile(input, original);

    const failed = await sanitizePasskeyDotenv(
      ["--input", input, "--sanitize"],
      {
        afterOriginalMove: async () => {
          await writeFile(input, replacement);
        },
        exclusiveLink: async () => {
          const error = new Error("injected persistent link failure");
          error.code = "EPERM";
          throw error;
        },
        report: (message) => diagnostics.push(message),
      }
    );

    assert.equal(failed, 2);
    assert.deepEqual(await readFile(input), replacement);
    const recoveryPath = diagnostics[0].match(/Recovery backup: (.+)$/m)?.[1];
    assert.ok(recoveryPath, diagnostics[0]);
    assert.deepEqual(await readFile(recoveryPath), original);
    assert.deepEqual(
      (await readdir(root)).filter((name) => name.includes(".sanitize.")),
      []
    );
  });
});

test("App Service deployment script has valid Bash syntax", () => {
  const result = spawnSync("bash", ["-n", "deploy.sh"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
});

test("container image never embeds local environment files", async () => {
  const [dockerfile, dockerignore] = await Promise.all([
    source("Dockerfile"),
    source(".dockerignore"),
  ]);

  assert.doesNotMatch(dockerfile, /COPY\s+["']?\.env(?:\.docker)?["']?/);
  assert.match(dockerignore, /^\.env\*$/m);
});

test("container image includes custom server runtime modules", async () => {
  const dockerfile = await source("Dockerfile");

  assert.match(
    dockerfile,
    /COPY\s+--from=builder\s+\/app\/runtime\s+\.\/runtime/
  );
});

test("deployment never exposes server API keys through NEXT_PUBLIC variables", async () => {
  const deployScript = await source("deploy.sh");

  assert.doesNotMatch(
    deployScript,
    /NEXT_PUBLIC_LANGSMITH_API_KEY\s*=\s*\$LANGCHAIN_API_KEY/
  );
});

test("private dotenv example delegates production passkeys to runtime deployment", async () => {
  const [envExample, readme] = await Promise.all([
    source(".env.docker.example"),
    source("README.md"),
  ]);
  const passkeysSection = extractPasskeysSection(readme);

  for (const setting of [
    "PASSKEY_ENABLED",
    "PASSKEY_ORIGIN",
    "PASSKEY_PROXY_ID",
    "PASSKEY_PROXY_SECRET",
  ]) {
    assert.doesNotMatch(envExample, new RegExp(`^${setting}=`, "m"));
    assert.match(readme, new RegExp(setting));
  }
  assert.match(
    envExample,
    /production passkey settings.*runtime deployment.*Key Vault/is
  );
  assert.match(readme, /same.*PASSKEY_PROXY_(?:ID|SECRET)/is);
  assert.ok(passkeysSection, "README must include a Passkeys section");
  assert.ok(
    hasRequiredOAuthRecoveryGuidance(passkeysSection),
    "Passkeys section must require OAuth to remain available for recovery"
  );
});

test("Passkeys recovery guidance excludes content after a following H1", () => {
  const readme = `### Passkeys
No recovery guidance here.
# Unrelated
OAuth must remain available for recovery.`;
  const passkeysSection = extractPasskeysSection(readme);

  assert.ok(passkeysSection);
  assert.doesNotMatch(passkeysSection, /^# Unrelated$/m);
  assert.equal(hasRequiredOAuthRecoveryGuidance(passkeysSection), false);
});

test("Passkeys recovery guidance rejects negated OAuth availability", () => {
  const readme = `### Passkeys
OAuth is not available for recovery.
## Next section`;
  const passkeysSection = extractPasskeysSection(readme);

  assert.ok(passkeysSection);
  assert.equal(hasRequiredOAuthRecoveryGuidance(passkeysSection), false);
});

test("Passkeys recovery guidance rejects recovery exclusion", () => {
  for (const sentence of [
    "OAuth must remain available, but not for recovery.",
    "OAuth must remain available, but never for recovery.",
    "OAuth must remain available without support for recovery.",
    "OAuth must remain available except for recovery.",
    "OAuth must remain available while unavailable for recovery.",
  ]) {
    const passkeysSection = extractPasskeysSection(`### Passkeys
${sentence}
## Next section`);

    assert.ok(passkeysSection, sentence);
    assert.equal(
      hasRequiredOAuthRecoveryGuidance(passkeysSection),
      false,
      sentence
    );
  }
});

test("custom server supports writable storage outside a read-only package", async () => {
  const server = await source("server.cjs");

  assert.match(
    server,
    /process\.env\.MARKDOWN_STORAGE_DIR\s*\|\|\s*path\.join\(__dirname,\s*"data",\s*"markdown_threads"\)/
  );
});

test("custom server listens on the platform network interface", async () => {
  const server = await source("server.cjs");

  assert.match(
    server,
    /const hostname = process\.env\.HOST \|\| "0\.0\.0\.0";/
  );
});

test("custom server closes and exits on App Service termination", async () => {
  const server = await source("server.cjs");

  assert.match(server, /process\.once\("SIGTERM", shutdown\)/);
  assert.match(server, /server\.close\(\(\) => process\.exit\(0\)\)/);
  assert.match(
    server,
    /setTimeout\(\(\) => process\.exit\(1\), 10_000\)\.unref\(\)/
  );
  assert.doesNotMatch(server, /process\.on\("SIGTERM"/);
});

test("production build uses standalone output for constrained hosting tiers", async () => {
  const nextConfig = await source("next.config.ts");

  assert.match(nextConfig, /output:\s*"standalone"/);
});

test("local container build uses a clean staged context", async () => {
  const [buildScript, dockerignore] = await Promise.all([
    source("build.sh"),
    source(".dockerignore"),
  ]);

  assert.match(buildScript, /mktemp -d ["']?\.container-build-context\./);
  assert.match(
    buildScript,
    /rsync[\s\S]*--exclude-from=["']?\.dockerignore["']?/
  );
  assert.match(buildScript, /--exclude=["']\.deployment-build\.json["']/);
  assert.match(buildScript, /container_cli_build[\s\S]*"\$BUILD_CONTEXT_DIR"/);
  assert.match(buildScript, /trap cleanup EXIT/);
  assert.match(buildScript, /rm -rf -- "\$BUILD_CONTEXT_DIR"/);
  assert.match(dockerignore, /^\.container-build-context\.\*\/$/m);
  assert.match(dockerignore, /^\.mcp\.json$/m);
});

test("local container build provisions enough builder memory", async () => {
  const [buildScript, runtimeHelper] = await Promise.all([
    source("build.sh"),
    source("scripts/container-runtime.sh"),
  ]);

  assert.match(runtimeHelper, /MIN_CONTAINER_BUILDER_MEMORY_BYTES=8589934592/);
  assert.match(runtimeHelper, /container builder status --format json/);
  assert.match(runtimeHelper, /container builder start --memory 8G/);
  assert.match(buildScript, /ensure_container_cli_build_ready/);
  assert.doesNotMatch(buildScript, /container builder/);
});

test("Docker Hub build owns image production without Azure access", async () => {
  const [buildScript, gitignore] = await Promise.all([
    source("build.sh"),
    source(".gitignore"),
  ]);

  assert.match(buildScript, /container_cli_build/);
  assert.match(buildScript, /container_cli_login/);
  assert.match(buildScript, /container_cli_push/);
  assert.match(
    buildScript,
    /docker\.io\/\$DOCKER_HUB_USERNAME\/deepagent-ui:latest/
  );
  assert.match(buildScript, /\.deployment-build\.json/);
  assert.doesNotMatch(buildScript, /\baz\s/);
  assert.match(gitignore, /^\.deployment-build\.json$/m);
});

test("Container Apps deployment consumes manifest without image-production dependencies", async () => {
  const deployScript = await source("deploy-azure-container-app.sh");

  assert.match(deployScript, /\.deployment-build\.json/);
  assert.doesNotMatch(
    deployScript,
    /container-runtime\.sh|select_container_cli|container_cli_(?:build|login|push)|\brsync\b|az acr login/
  );
  assert.doesNotMatch(
    deployScript,
    /az containerapp (?:create|registry set|registry remove|identity assign|ingress|revision set-mode)/
  );
});

test("App Service deployment uses a prebuilt standalone zip", async () => {
  const deployScript = await source("deploy.sh");

  assert.match(deployScript, /WEBAPP_NAME=.*bmo-deepagent-ui-\$SEED/);
  assert.match(deployScript, /az webapp show/);
  assert.match(deployScript, /\.next\/standalone/);
  assert.match(deployScript, /\.next\/static/);
  assert.match(deployScript, /cp -R public/);
  assert.match(deployScript, /cp -R node_modules\/ws/);
  assert.match(
    deployScript,
    /cp -R node_modules\/next\/\. "\$PACKAGE_ROOT\/node_modules\/next\/"/
  );
  assert.match(deployScript, /cp server\.cjs/);
  assert.match(
    deployScript,
    /find "\$PACKAGE_ROOT" -maxdepth 1 -type f -name '\.env\*' -delete/
  );
  assert.match(deployScript, /az webapp deploy[\s\S]*--type zip/);
  assert.doesNotMatch(
    deployScript,
    /az containerapp (?:show|update|create)[\s\S]*--name deepagent-ui/
  );
  assert.doesNotMatch(deployScript, /DOCKER_HUB_(?:USERNAME|PAT)/);
});

test("App Service package includes custom server runtime modules", async () => {
  const deployScript = await source("deploy.sh");

  assert.match(deployScript, /cp -R runtime "\$PACKAGE_ROOT\/runtime"/);
});

test("App Service health check verifies the new deployment marker", async () => {
  const deployScript = await source("deploy.sh");

  assert.match(deployScript, /DEPLOYMENT_MARKER=/);
  assert.match(deployScript, /public\/deployment-version\.txt/);
  assert.match(deployScript, /"\$DEPLOYED_MARKER" = "\$DEPLOYMENT_MARKER"/);
});

test("App Service deployment preserves runtime and Key Vault settings", async () => {
  const deployScript = await source("deploy.sh");

  assert.match(deployScript, /--linux-fx-version "NODE\|22-lts"/);
  assert.match(deployScript, /--startup-file "node server\.cjs"/);
  assert.match(deployScript, /--web-sockets-enabled true/);
  assert.match(deployScript, /SCM_DO_BUILD_DURING_DEPLOYMENT=false/);
  assert.match(
    deployScript,
    /UPLOAD_API_KEY=@Microsoft\.KeyVault\(VaultName=\$\{KV_NAME\};SecretName=UPLOAD-API-KEY\)/
  );
  assert.match(
    deployScript,
    /MARKDOWN_STORAGE_DIR=\/home\/data\/markdown_threads/
  );
});

test("App Service deployment fails fast when Azure reports exhausted quota", async () => {
  const deployScript = await source("deploy.sh");
  const quotaCheck = deployScript.indexOf("fail_if_webapp_quota_exceeded");
  const build = deployScript.indexOf("yarn install --immutable");

  assert.match(deployScript, /--query "join\('\|', \[state, usageState\]\)"/);
  assert.match(deployScript, /\$webapp_usage_state" = "Exceeded"/);
  assert.match(deployScript, /App Service F1 quota is exceeded/);
  assert.ok(quotaCheck >= 0 && quotaCheck < build);
});

test("App Service deployment starts from clean installed dependencies", async () => {
  const deployScript = await source("deploy.sh");
  const cleanDependencies = deployScript.indexOf("rm -rf -- node_modules");
  const installDependencies = deployScript.indexOf("yarn install --immutable");

  assert.ok(cleanDependencies >= 0);
  assert.ok(cleanDependencies < installDependencies);
});

test("App Service deployment owns startup polling so quota changes fail fast", async () => {
  const deployScript = await source("deploy.sh");
  const deployment = deployScript.indexOf("az webapp deploy");
  const verification = deployScript.indexOf(
    'echo "🩺 Verifying deployed site..."'
  );
  const lastQuotaCheck = deployScript.lastIndexOf(
    "fail_if_webapp_quota_exceeded"
  );

  assert.match(deployScript, /--track-status false/);
  assert.ok(deployment >= 0 && deployment < verification);
  assert.ok(lastQuotaCheck > verification);
});

test("App Service deployment skips unchanged settings to preserve F1 stop quota", async () => {
  const deployScript = await source("deploy.sh");

  assert.match(
    deployScript,
    /current_runtime_config=\$\(az webapp config show[\s\S]*expected_runtime_config=/
  );
  assert.match(
    deployScript,
    /if \[ "\$current_runtime_config" != "\$expected_runtime_config" \]; then[\s\S]*az webapp config set/
  );
  assert.match(
    deployScript,
    /current_app_settings=\$\(az webapp config appsettings list/
  );
  assert.match(
    deployScript,
    /if \$app_settings_changed; then[\s\S]*az webapp config appsettings set/
  );
});

test("all-in-one deployment runs the App Service deploy flow", async () => {
  const allScript = await source("all.sh");

  assert.match(allScript, /^#!\/bin\/bash\nset -e\n/);
  assert.match(allScript, /\.\/deploy\.sh\n$/);
  assert.doesNotMatch(allScript, /\.\/build\.sh/);
});
