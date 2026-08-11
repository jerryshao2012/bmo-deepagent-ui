import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const helperPath = path.join(repoRoot, "scripts/azure-subscription.sh");
const defaultSubscriptionId = "subscription-default";
const requestedSubscriptionId = "subscription-requested";
const uuidPattern = /\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/i;
const fixedAcrTokenUsername = "00000000-0000-0000-0000-000000000000";

const runSubscriptionGuard = async (options = {}) => {
  const subscriptionId = Object.prototype.hasOwnProperty.call(
    options,
    "subscriptionId"
  )
    ? options.subscriptionId
    : defaultSubscriptionId;
  const activeId = Object.prototype.hasOwnProperty.call(options, "activeId")
    ? options.activeId
    : subscriptionId;
  const {
    accountShowStatus = 0,
    accountSetStatus = 0,
    confirmStatus = 0,
    body = "select_azure_subscription",
  } = options;
  const tempRoot = await mkdtemp(
    path.join(tmpdir(), "azure-subscription-test-")
  );

  try {
    const binDir = path.join(tempRoot, "bin");
    const azPath = path.join(binDir, "az");
    const logPath = path.join(tempRoot, "az-arguments.log");
    const callCountPath = path.join(tempRoot, "az-call-count");
    await mkdir(binDir);
    await writeFile(
      azPath,
      `#!/bin/bash
set -u
{
  printf 'az'
  printf ' <%s>' "$@"
  printf '\\n'
} >> "$AZ_ARGUMENT_LOG"

case "\${1:-}:\${2:-}" in
  "account:show")
    show_count=0
    if [ -f "$AZ_CALL_COUNT" ]; then
      IFS= read -r show_count < "$AZ_CALL_COUNT"
    fi
    show_count=$((show_count + 1))
    printf '%s\\n' "$show_count" > "$AZ_CALL_COUNT"
    if [ "$show_count" -eq 1 ]; then
      [ "$#" -eq 6 ] || exit 64
      [ "$3" = "--query" ] && [ "$4" = "id" ] || exit 64
      [ "$5" = "-o" ] && [ "$6" = "tsv" ] || exit 64
      [ "$ACCOUNT_SHOW_STATUS" -eq 0 ] || exit "$ACCOUNT_SHOW_STATUS"
    else
      [ "$#" -eq 6 ] || exit 64
      [ "$3" = "--query" ] && [ "$4" = "id" ] || exit 64
      [ "$5" = "-o" ] && [ "$6" = "tsv" ] || exit 64
      [ "$CONFIRM_STATUS" -eq 0 ] || exit "$CONFIRM_STATUS"
    fi
    printf '%s\\n' "$ACTIVE_ID"
    ;;
  "account:set")
    [ "$#" -eq 4 ] || exit 64
    [ "$3" = "--subscription" ] || exit 64
    [ "$4" = "$EXPECTED_SUBSCRIPTION_ID" ] || exit 64
    exit "$ACCOUNT_SET_STATUS"
    ;;
  *) exit 64 ;;
esac
`
    );
    await chmod(azPath, 0o755);

    const env = {
      PATH: binDir,
      HELPER_PATH: helperPath,
      AZ_ARGUMENT_LOG: logPath,
      AZ_CALL_COUNT: callCountPath,
      ACCOUNT_SHOW_STATUS: String(accountShowStatus),
      ACCOUNT_SET_STATUS: String(accountSetStatus),
      CONFIRM_STATUS: String(confirmStatus),
      ACTIVE_ID: activeId ?? "",
      EXPECTED_SUBSCRIPTION_ID: subscriptionId ?? "",
    };
    if (subscriptionId !== undefined) {
      env.AZURE_SUBSCRIPTION_ID = subscriptionId;
    }

    const result = spawnSync(
      "/bin/bash",
      ["--noprofile", "--norc", "-c", `source "$HELPER_PATH"; ${body}`],
      { cwd: repoRoot, encoding: "utf8", env }
    );
    const log = await readFile(logPath, "utf8").catch(() => "");

    return { result, log };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

test("sourcing the helper has no side effects", async () => {
  const { result, log } = await runSubscriptionGuard({ body: ":" });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.equal(log, "");
});

test("missing Azure subscription fails before account access", async () => {
  const { result, log } = await runSubscriptionGuard({
    subscriptionId: undefined,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AZURE_SUBSCRIPTION_ID.*required/i);
  assert.equal(log, "");
});

test("unauthenticated Azure CLI fails clearly", async () => {
  const { result, log } = await runSubscriptionGuard({ accountShowStatus: 7 });

  assert.equal(result.status, 7);
  assert.match(result.stderr, /az login/i);
  assert.equal(log, "az <account> <show> <--query> <id> <-o> <tsv>\n");
});

test("account selection failure propagates", async () => {
  const { result, log } = await runSubscriptionGuard({ accountSetStatus: 23 });

  assert.equal(result.status, 23);
  assert.match(result.stderr, /could not select Azure subscription/i);
  assert.equal(
    log,
    "az <account> <show> <--query> <id> <-o> <tsv>\n" +
      `az <account> <set> <--subscription> <${defaultSubscriptionId}>\n`
  );
});

test("confirmation failure propagates", async () => {
  const { result, log } = await runSubscriptionGuard({ confirmStatus: 29 });

  assert.equal(result.status, 29);
  assert.match(result.stderr, /could not confirm active Azure subscription/i);
  assert.equal(
    log,
    "az <account> <show> <--query> <id> <-o> <tsv>\n" +
      `az <account> <set> <--subscription> <${defaultSubscriptionId}>\n` +
      "az <account> <show> <--query> <id> <-o> <tsv>\n"
  );
});

test("active subscription mismatch fails", async () => {
  const { result } = await runSubscriptionGuard({
    activeId: "wrong-subscription",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /active subscription.*does not match/i);
});

test("selects and confirms exact subscription", async () => {
  const { result, log } = await runSubscriptionGuard({
    subscriptionId: requestedSubscriptionId,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    log,
    "az <account> <show> <--query> <id> <-o> <tsv>\n" +
      `az <account> <set> <--subscription> <${requestedSubscriptionId}>\n` +
      "az <account> <show> <--query> <id> <-o> <tsv>\n"
  );
});

test("deploy.sh rejects subscription override from .env.docker before Azure access", async () => {
  const tempRoot = await mkdtemp(
    path.join(tmpdir(), "app-service-subscription-test-")
  );

  try {
    const binDir = path.join(tempRoot, "bin");
    const scriptsDir = path.join(tempRoot, "scripts");
    const azLog = path.join(tempRoot, "az.log");
    await mkdir(binDir);
    await mkdir(scriptsDir);
    await Promise.all([
      writeFile(
        path.join(tempRoot, "deploy.sh"),
        await readFile(path.join(repoRoot, "deploy.sh"), "utf8")
      ),
      writeFile(
        path.join(scriptsDir, "azure-subscription.sh"),
        await readFile(helperPath, "utf8")
      ),
      writeFile(
        path.join(tempRoot, "env.sh"),
        'export AZURE_SUBSCRIPTION_ID="trusted-subscription"\n'
      ),
      writeFile(
        path.join(tempRoot, ".env.docker"),
        'AZURE_SUBSCRIPTION_ID="redirected-subscription"\n'
      ),
    ]);

    await writeFile(
      path.join(binDir, "az"),
      `#!/bin/bash
printf 'az' >> "$AZ_LOG"
printf ' <%s>' "$@" >> "$AZ_LOG"
printf '\\n' >> "$AZ_LOG"
exit 97
`
    );
    await chmod(path.join(binDir, "az"), 0o755);
    for (const command of ["yarn", "zip", "curl", "grep"]) {
      const commandPath = path.join(binDir, command);
      await writeFile(commandPath, "#!/bin/bash\nexit 0\n");
      await chmod(commandPath, 0o755);
    }

    const result = spawnSync(
      "/bin/bash",
      ["--noprofile", "--norc", path.join(tempRoot, "deploy.sh")],
      {
        cwd: tempRoot,
        encoding: "utf8",
        env: { PATH: binDir, AZ_LOG: azLog },
      }
    );
    const log = await readFile(azLog, "utf8").catch(() => "");

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(
      result.stderr,
      /.env.docker.*line 1.*AZURE_SUBSCRIPTION_ID.*protected/i
    );
    assert.equal(log, "");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("subscription fixtures use opaque values", () => {
  assert.doesNotMatch(defaultSubscriptionId, uuidPattern);
  assert.doesNotMatch(requestedSubscriptionId, uuidPattern);
});

test("tracked Azure scripts do not hardcode subscription UUIDs", async () => {
  const azureFacingShellFiles = [
    "scripts/azure-subscription.sh",
    "build.sh",
    "deploy.sh",
    "deploy-azure-container-app.sh",
    "secrets.sh.example",
  ];

  for (const file of azureFacingShellFiles) {
    const contents = await readFile(path.join(repoRoot, file), "utf8");
    const withoutDocumentedAcrUsername = contents
      .split(fixedAcrTokenUsername)
      .join("");
    assert.doesNotMatch(withoutDocumentedAcrUsername, uuidPattern, file);
  }
});

const scriptContracts = [
  ["build.sh", "az group show"],
  ["deploy.sh", "az webapp show"],
  ["secrets.sh.example", "az keyvault secret set"],
];

for (const [script, firstResourceCall] of scriptContracts) {
  test(`${script} selects configured subscription before Azure resources`, async () => {
    const contents = await readFile(path.join(repoRoot, script), "utf8");
    const sourceEnvironment = contents.indexOf("source ./env.sh");
    const sourceHelper = contents.indexOf("scripts/azure-subscription.sh");
    const select = contents.indexOf("select_azure_subscription");
    const resource = contents.indexOf(firstResourceCall);
    const exitsOnSelectionFailure =
      contents.slice(0, select).includes("set -e") ||
      contents.indexOf("select_azure_subscription || exit $?") === select;

    assert.ok(sourceEnvironment >= 0 && sourceEnvironment < sourceHelper);
    assert.ok(sourceHelper >= 0 && sourceHelper < select);
    assert.ok(select >= 0 && select < resource);
    assert.ok(exitsOnSelectionFailure);
  });
}

test("env.sh provides an overridable Container App name", async () => {
  const envSource = await readFile(path.join(repoRoot, "env.sh"), "utf8");

  assert.match(
    envSource,
    /export CONTAINER_APP_NAME="\$\{CONTAINER_APP_NAME:-bmo-deepagent-ui-\$SEED\}"/
  );
});
