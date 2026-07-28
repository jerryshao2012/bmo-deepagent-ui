import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = async (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("container image never embeds local environment files", async () => {
  const [dockerfile, dockerignore] = await Promise.all([
    source("Dockerfile"),
    source(".dockerignore"),
  ]);

  assert.doesNotMatch(dockerfile, /COPY\s+["']?\.env(?:\.docker)?["']?/);
  assert.match(dockerignore, /^\.env\*$/m);
});

test("deployment never exposes server API keys through NEXT_PUBLIC variables", async () => {
  const deployScript = await source("deploy.sh");

  assert.doesNotMatch(
    deployScript,
    /NEXT_PUBLIC_LANGSMITH_API_KEY\s*=\s*\$LANGCHAIN_API_KEY/,
  );
});

test("custom server supports writable storage outside a read-only package", async () => {
  const server = await source("server.cjs");

  assert.match(
    server,
    /process\.env\.MARKDOWN_STORAGE_DIR\s*\|\|\s*path\.join\(__dirname,\s*"data",\s*"markdown_threads"\)/,
  );
});

test("custom server listens on the platform network interface", async () => {
  const server = await source("server.cjs");

  assert.match(server, /const hostname = process\.env\.HOST \|\| "0\.0\.0\.0";/);
});

test("custom server closes and exits on App Service termination", async () => {
  const server = await source("server.cjs");

  assert.match(server, /process\.once\("SIGTERM", shutdown\)/);
  assert.match(server, /server\.close\(\(\) => process\.exit\(0\)\)/);
  assert.match(server, /setTimeout\(\(\) => process\.exit\(1\), 10_000\)\.unref\(\)/);
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
  assert.match(buildScript, /rsync[\s\S]*--exclude-from=["']?\.dockerignore["']?/);
  assert.match(buildScript, /container build[\s\S]*"\$BUILD_CONTEXT_DIR"/);
  assert.match(buildScript, /trap ['"]rm -rf "\$BUILD_CONTEXT_DIR"['"] EXIT/);
  assert.match(dockerignore, /^\.container-build-context\.\*\/$/m);
  assert.match(dockerignore, /^\.mcp\.json$/m);
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
    /cp -R node_modules\/next\/\. "\$PACKAGE_ROOT\/node_modules\/next\/"/,
  );
  assert.match(deployScript, /cp server\.cjs/);
  assert.match(
    deployScript,
    /find "\$PACKAGE_ROOT" -maxdepth 1 -type f -name '\.env\*' -delete/,
  );
  assert.match(deployScript, /az webapp deploy[\s\S]*--type zip/);
  assert.doesNotMatch(
    deployScript,
    /az containerapp (?:show|update|create)[\s\S]*--name deepagent-ui/,
  );
  assert.doesNotMatch(deployScript, /DOCKER_HUB_(?:USERNAME|PAT)/);
});

test("App Service deployment preserves runtime and Key Vault settings", async () => {
  const deployScript = await source("deploy.sh");

  assert.match(deployScript, /--linux-fx-version "NODE\|22-lts"/);
  assert.match(deployScript, /--startup-file "node server\.cjs"/);
  assert.match(deployScript, /--web-sockets-enabled true/);
  assert.match(deployScript, /SCM_DO_BUILD_DURING_DEPLOYMENT=false/);
  assert.match(
    deployScript,
    /UPLOAD_API_KEY=@Microsoft\.KeyVault\(VaultName=\$\{KV_NAME\};SecretName=UPLOAD-API-KEY\)/,
  );
  assert.match(
    deployScript,
    /MARKDOWN_STORAGE_DIR=\/home\/data\/markdown_threads/,
  );
});

test("App Service deployment fails fast when Azure reports exhausted quota", async () => {
  const deployScript = await source("deploy.sh");
  const quotaCheck = deployScript.indexOf("fail_if_webapp_quota_exceeded");
  const build = deployScript.indexOf("yarn install --frozen-lockfile");

  assert.match(deployScript, /--query "join\('\|', \[state, usageState\]\)"/);
  assert.match(deployScript, /\$webapp_usage_state" = "Exceeded"/);
  assert.match(deployScript, /App Service F1 quota is exceeded/);
  assert.ok(quotaCheck >= 0 && quotaCheck < build);
});

test("App Service deployment owns startup polling so quota changes fail fast", async () => {
  const deployScript = await source("deploy.sh");
  const deployment = deployScript.indexOf("az webapp deploy");
  const verification = deployScript.indexOf('echo "🩺 Verifying deployed site..."');
  const lastQuotaCheck = deployScript.lastIndexOf(
    "fail_if_webapp_quota_exceeded",
  );

  assert.match(deployScript, /--track-status false/);
  assert.ok(deployment >= 0 && deployment < verification);
  assert.ok(lastQuotaCheck > verification);
});

test("App Service deployment skips unchanged settings to preserve F1 stop quota", async () => {
  const deployScript = await source("deploy.sh");

  assert.match(
    deployScript,
    /current_runtime_config=\$\(az webapp config show[\s\S]*expected_runtime_config=/,
  );
  assert.match(
    deployScript,
    /if \[ "\$current_runtime_config" != "\$expected_runtime_config" \]; then[\s\S]*az webapp config set/,
  );
  assert.match(
    deployScript,
    /current_app_settings=\$\(az webapp config appsettings list/,
  );
  assert.match(
    deployScript,
    /if \$app_settings_changed; then[\s\S]*az webapp config appsettings set/,
  );
});

test("all-in-one deployment runs the App Service deploy flow", async () => {
  const allScript = await source("all.sh");

  assert.match(allScript, /^#!\/bin\/bash\nset -e\n/);
  assert.match(allScript, /\.\/deploy\.sh\n$/);
  assert.doesNotMatch(allScript, /\.\/build\.sh/);
});
