# Cloud Deployment Guides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Execution constraint:** Work inline in current dirty `main` worktree. Override
> referenced skill steps that create branch/worktree, stage, or commit. Existing index
> state belongs to user and must remain byte-for-byte unchanged.

**Goal:** Add accurate active operator guides for Azure App Service, AWS ECS Fargate, and Oracle AMD VM deployment paths supported by repository scripts.

**Architecture:** Use one provider-specific Markdown guide per deployment script with consistent operator flow: boundaries, prerequisites, configuration, secrets, preflight, deployment, verification, rollback, troubleshooting, and security/cost notes. Derive behavior from tracked scripts/examples and link only current official provider references.

All guides describe repository deployment automation, not complete production
hardening. Operators own provider-resource lifecycle and cleanup unless script states
otherwise.

**Tech Stack:** Markdown, Bash deployment scripts, Azure CLI, AWS CLI, Apple `container`, Docker, SSH/SCP, Yarn/Prettier, Node.js test runner

---

### Task 1: Preserve worktree state and audit sources

**Files:**

- Read: `deploy.sh`
- Read: `env.sh`
- Read: `secrets.sh.example`
- Read: `.env.docker.example`
- Read: `deploy-aws.sh`
- Read: `build-aws.sh`
- Read: `env-aws.sh`
- Read: `secrets-aws.sh.example`
- Read: `deploy-oracle.sh`
- Read: `tests/deployment-security.test.mjs`
- Read: `tests/deploy-oracle.test.mjs`
- Read: `documents/history/plans/2026-07-27-oracle-amd-deployment.md`
- Read: `documents/history/specifications/2026-07-27-oracle-amd-deployment-design.md`
- Read: `documents/history/specifications/2026-08-03-cloud-deployment-guides-design.md`

- [x] **Step 1: Snapshot protected state**

Run:

```bash
git diff --cached --binary | shasum -a 256
git diff --binary -- .dockerignore src/generated/backend-api.ts | shasum -a 256
shasum -a 256 .dockerignore src/generated/backend-api.ts
```

Save all four hashes for final comparison.

- [x] **Step 2: Record provider contracts**

Extract exact script options, commands, sourced files, variables, resources, health
criteria, and failure behavior with targeted `rg`/`sed`. Do not read secret values from
ignored `.env`, `.env.docker`, or provider credential files.

- [x] **Step 3: Verify current provider references**

Use only official Azure, AWS, Oracle, Docker, and Apple documentation. Prefer stable
service/concept pages over mutable pricing claims. Record page URLs directly in guides.

### Task 2: Write Azure App Service guide

**Files:**

- Create: `documents/deployment/azure-app-service.md`

- [x] **Step 1: Document boundaries and prerequisites**

State UI deploys as standalone ZIP to existing Linux App Service; backend Container
App, resource group, Key Vault, App Service identity authorization, and sibling
`../deep-research/env.sh` must already exist. List required local tools from
`deploy.sh` and explain `env.sh` contains environment-specific defaults. Local `.env`
is mandatory because `env.sh` sources it unconditionally. Explain required Azure
resource providers must already be registered; script does not register them.

- [x] **Step 2: Document configuration and secrets**

Reference tracked `.env.docker.example` and `secrets.sh.example`. Explain `env.sh`
sources `.env`, sources sibling backend config, and mutates ignored `.env.docker` when
present. Use sanitized placeholder snippets only. Warn current Azure CLI principal
secret access does not prove App Service managed identity can resolve Key Vault
reference.

- [x] **Step 3: Document deployment behavior**

Describe Node.js 22 App Service settings, HTTPS-only, backend discovery, standalone
build/package, `az webapp deploy --clean`, deployment marker polling, F1 quota checks,
and persistent `/home/data/markdown_threads` storage.
Document reruns: unchanged App Service settings are skipped, but application package
is rebuilt and deployed with clean replacement.

- [x] **Step 4: Document operations and recovery**

Cover functional verification, common missing App Service/backend/secret/quota errors,
manual rollback by rebuilding/redeploying known revision, backups, possible interruption,
and cost/availability caveats. Do not claim automatic rollback.
Assign cleanup of App Service, Key Vault, backend resources, and persistent data to
operator; `deploy.sh` does not remove them.

### Task 3: Write AWS ECS Fargate guide

**Files:**

- Create: `documents/deployment/aws-ecs-fargate.md`

- [x] **Step 1: Document architecture and prerequisites**

Describe ECR image → ECS Fargate service → ALB HTTP origin → CloudFront HTTPS public
URL. Require AWS CLI auth, default VPC, at least two subnets in different Availability
Zones, Secrets Manager, required IAM permissions, and Apple's `container` CLI for
`build-aws.sh`. Require existing ECR `latest` image or prior successful
`build-aws.sh` execution.

- [x] **Step 2: Document configuration and secret flow**

Reference tracked `.env.docker.example`, `env-aws.sh`, and
`secrets-aws.sh.example`. Explain ignored `.env.docker`, mandatory sibling
`../deep-research/env-aws.sh`, optional `.env`, environment-specific defaults, and
mutation of `.env.docker`.
Use sanitized placeholders; never copy repository `SEED`, account IDs, region-specific
resource names, or other `env-aws.sh` defaults into operator commands.

- [x] **Step 3: Document both deployment modes exactly**

Full mode validates/creates Secrets Manager integration, IAM roles/policies, security
groups, ALB/target group/listener, CloudFront, log group, ECS cluster, task definition,
and service. Clarify it optionally runs local `secrets-aws.sh`, then validates an
existing Secrets Manager secret; it does not create secret by itself.
`--skip-infra-setup` skips infrastructure checks but still registers task definition
and updates or creates service using discovered resources.

- [x] **Step 4: Add mandatory known-risk callout**

State current task definition sets `VERIFY_SSL=false` and maps Secrets Manager
`LANGCHAIN-API-KEY` to browser-visible `NEXT_PUBLIC_LANGSMITH_API_KEY`, conflicting
with production secret policy. Recommend script remediation before production. Also
document public task IP, HTTP ALB origin, broad IAM needs, mutable `latest`, resource
charges, and cleanup ownership.

- [x] **Step 5: Document verification and manual rollback**

Explain service-stability wait, CloudFront propagation, 403-accepting health loop, and
zero exit after health timeout. Require functional chat/auth/upload checks. Explain
manual rollback to prior immutable image/task-definition revision; no automatic
rollback exists.
State script-created service runs one task and provides no persistent volume. Warn of
interruption and loss of container-local Markdown data; require external persistence or
backup strategy for state that must survive task replacement.

### Task 4: Write Oracle VM guide

**Files:**

- Create: `documents/deployment/oracle-vm.md`

- [x] **Step 1: Document responsibilities and configuration**

State script deploys existing `linux/amd64` Docker Hub image to already-provisioned
VM. Document required `ORACLE_HOST`, `ORACLE_SSH_KEY`, `DOCKER_HUB_USERNAME`; optional
variables from `--help`; optional `env-oracle.sh` (currently absent from repository);
readable `ORACLE_ENV_FILE` with default ignored `.env.docker`; and required `ssh`,
`scp`, `curl`. Use shared sanitized placeholders rather than environment-specific
hostnames, usernames, or keys.

- [x] **Step 2: Document deployment behavior**

Explain SSH/Docker preflight, remote `0700` directory, `.env.docker` mode `0600`, image
pull, removal/replacement of named container, restart policy, port mapping, persistent
data mount, Auth.js URL overrides, and bounded health polling/log capture.

- [x] **Step 3: Document missing infrastructure and recovery**

Make VM creation, Docker install, DNS, TLS, Oracle network rules, backend deployment,
and private-registry login operator responsibilities. Warn of brief downtime, manual
rollback, need for immutable previous image tag, and remote data backup. Link historical
Oracle plan/design as background only.
Warn default public HTTP endpoint lacks TLS, single VM/container has no high
availability, and VM/network/registry resources may incur provider charges.
Assign VM, network, image, remote deployment directory, and backup cleanup to operator;
script does not deprovision them.

### Task 5: Update navigation

**Files:**

- Modify: `README.md`
- Modify: `documents/README.md`

- [x] **Step 1: Link provider guides from root README**

Retain script names and change Azure/AWS/Oracle deployment bullets into links to new
active guides.

- [x] **Step 2: Expand documentation index**

List Azure, AWS, Oracle, and Vercel active guides under Deployment. Add cloud deployment
guide design to History → Specifications and this implementation plan to History →
Plans.

### Task 6: Verify guides

**Files:**

- Verify: `README.md`
- Verify: `documents/README.md`
- Verify: `documents/deployment/azure-app-service.md`
- Verify: `documents/deployment/aws-ecs-fargate.md`
- Verify: `documents/deployment/oracle-vm.md`
- Verify: `documents/history/plans/2026-08-04-cloud-deployment-guides.md`

- [x] **Step 1: Validate scripts without deploying**

```bash
bash -n deploy.sh deploy-aws.sh deploy-oracle.sh
./deploy-aws.sh --help
./deploy-oracle.sh --help
```

Expected: syntax and help commands exit zero; no cloud mutation occurs.

- [x] **Step 2: Run deployment-focused tests**

```bash
node --test --test-name-pattern='^(App Service|container image|deployment never|custom server|production build|local container build|all-in-one deployment)' tests/deployment-security.test.mjs
node --test tests/deploy-oracle.test.mjs
```

Expected: 18 Azure/deployment checks and 5 Oracle checks pass. Known unrelated passkey
README test remains out of scope.

- [x] **Step 3: Format only changed Markdown**

Run:

```bash
yarn prettier --write README.md documents/README.md documents/deployment/azure-app-service.md documents/deployment/aws-ecs-fargate.md documents/deployment/oracle-vm.md documents/history/plans/2026-08-04-cloud-deployment-guides.md
yarn prettier --check README.md documents/README.md documents/deployment/azure-app-service.md documents/deployment/aws-ecs-fargate.md documents/deployment/oracle-vm.md documents/history/plans/2026-08-04-cloud-deployment-guides.md
```

Expected: explicit changed files use repository style; no unrelated file is formatted.

- [x] **Step 4: Check local links and whitespace**

Run:

```bash
node --input-type=module <<'NODE'
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const files = execFileSync("rg", ["--files", "-g", "*.md", "-g", "*.mdx", "-g", "!node_modules/**", "-g", "!.git/**"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
const anchors = new Map();
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const seen = new Map();
  const ids = new Set();
  for (const match of text.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = match[1].replace(/<[^>]+>/g, "").replace(/[`*_~]/g, "").trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    ids.add(count ? `${base}-${count}` : base);
  }
  anchors.set(path.resolve(file), ids);
}
const errors = [];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = match[1].trim().replace(/^<|>$/g, "");
    if (!raw || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(raw)) continue;
    const [targetPart, fragment = ""] = raw.split("#", 2);
    const target = path.resolve(path.dirname(file), decodeURIComponent(targetPart || path.basename(file)));
    if (!fs.existsSync(target)) errors.push(`${file}: missing ${raw}`);
    else if (fragment && anchors.has(target) && !anchors.get(target).has(decodeURIComponent(fragment).toLowerCase())) errors.push(`${file}: missing fragment ${raw}`);
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`Checked ${files.length} Markdown files.`);
NODE

git diff --check
set +e
rg -n '[[:blank:]]+$' README.md documents --glob '*.md'
whitespace_status=$?
set -e
if [ "$whitespace_status" -eq 0 ]; then
  echo "Trailing whitespace found" >&2
  exit 1
elif [ "$whitespace_status" -ne 1 ]; then
  exit "$whitespace_status"
fi
```

Expected: no broken local links or whitespace errors.

- [x] **Step 5: Run repository verification**

```bash
yarn lint
yarn build
```

Expected: both pass. If environment or pre-existing worktree changes cause failure,
capture exact output and separate it from deployment-guide work.

- [x] **Step 6: Compare protected state**

Repeat Task 1 hashes and confirm exact match. Inspect `git status --short` and
documentation-focused diff. Do not stage or commit implementation changes. Skip
`threadroot score latest` because `threadroot prep` failed with `EPERM` before run was
recorded.
