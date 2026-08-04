# Cloud Deployment Guides Design

## Goal

Add active operator guides for every repository-supported deployment path that
currently lacks one: Azure App Service, AWS ECS Fargate, and Oracle AMD VM.

## Audience and source of truth

Guides target operators deploying existing application to an owned cloud account.
Repository scripts, example configuration, and security tests define supported
workflow. Provider documentation supplies links for account-level prerequisites and
service behavior, but guide must not invent automation absent from scripts.

Each guide must clearly distinguish:

- resources script creates or changes;
- resources operator must provision first;
- required and optional configuration;
- secrets that must remain outside version control;
- verification that is safe without production credentials;
- cloud actions that can incur cost or expose public endpoints.

## Shared structure

Create three focused documents under `documents/deployment/`:

```text
documents/deployment/
├── azure-app-service.md
├── aws-ecs-fargate.md
├── oracle-vm.md
└── vercel.md
```

Every new guide uses same operator flow:

1. Overview and deployment architecture.
2. Prerequisites and responsibility boundary.
3. Configuration and secret preparation.
4. Preflight checks.
5. Deployment command and script behavior.
6. Post-deployment verification.
7. Update, rollback, and troubleshooting guidance.
8. Security, availability, and cost notes.
9. Links to related active documentation and exact repository scripts.

Commands use placeholders, never account IDs, hostnames, keys, or resource names from
one developer's environment. Destructive or billable operations receive explicit
warnings. Guides do not promise free hosting or fixed deployment time.

No script provides automatic rollback. Each guide must describe manual recovery,
expected interruption, immutable image/revision pinning where supported, data backup,
and provider-resource cleanup ownership. Deployment commands must not be presented as
production hardening.

## Azure App Service guide

Document `deploy.sh` as standalone Next.js ZIP deployment to existing Linux App
Service. Explain dependencies on `env.sh`, optional `.env.docker`, existing backend
Azure Container App, Azure Key Vault upload secret, Node.js 22 runtime, persistent
`/home/data/markdown_threads`, and F1 quota behavior.

Cover tracked `env.sh`, `secrets.sh.example`, and `.env.docker.example`; Azure CLI
authentication; provider registration when relevant; build/package flow; deployment
marker health check; rerun behavior; and common missing resource/quota/secret
failures. State that `env.sh` contains environment-specific defaults, sources mandatory
`../deep-research/env.sh`, sources local `.env`, and mutates `.env.docker` when it
exists. Use inline sanitized placeholders rather than referring to nonexistent
`env.sh.example`.

State that App Service managed identity must already have permission to resolve Key
Vault reference; script validates secret availability to current CLI principal but
does not grant runtime identity access. Explain `az webapp deploy --clean` replacement,
manual rollback by rebuilding/redeploying known revision, and backup expectations for
persistent Markdown data. Do not document backend provisioning as part of UI script.

## AWS ECS Fargate guide

Document `deploy-aws.sh` as ECR-backed ECS Fargate deployment with Application Load
Balancer and CloudFront. Explain full infrastructure mode versus
`--skip-infra-setup`, required AWS CLI session, existing ECR `latest` image,
Secrets Manager JSON, VPC and at least two subnets in different Availability Zones,
IAM roles, security groups, task definition, service stabilization, and public health
verification.

Reference tracked `env-aws.sh`, `secrets-aws.sh.example`, `.env.docker.example`,
`build-aws.sh`, and script `--help`. Explain operator copies tracked example to ignored
`.env.docker`. State that `env-aws.sh` contains environment-specific defaults, sources
mandatory `../deep-research/env-aws.sh`, optionally sources `.env`, and mutates
`.env.docker` when present. Use sanitized inline placeholders rather than nonexistent
`env-aws.sh.example` or `.env-aws.docker`.

Include warnings for public IP assignment, HTTP ALB origin, CloudFront propagation,
IAM permissions, resource charges, and cleanup responsibility. Document current known
security risks explicitly: task definition sets `VERIFY_SSL=false`, and injects
Secrets Manager `LANGCHAIN-API-KEY` as browser-visible
`NEXT_PUBLIC_LANGSMITH_API_KEY`. Guide must recommend remediating script before
production use rather than endorsing those defaults.

State that full mode discovers default VPC and its subnets rather than creating VPC;
at least two Availability Zones are required. `--skip-infra-setup` still registers a
new task definition and updates or creates ECS service. `build-aws.sh` specifically
requires Apple's `container` CLI. Health loop accepts HTTP 403 and exits successfully
even after all retries, so operators must perform functional verification. Mutable
`latest` deployment has no automatic rollback; recommend immutable image tags and
manual task-definition rollback before production use.

## Oracle VM guide

Document `deploy-oracle.sh` as deployment of existing `linux/amd64` Docker Hub image
to already-provisioned Oracle AMD VM. Explain SSH key and host inputs, optional
`env-oracle.sh`, `.env.docker`, Docker or passwordless `sudo docker`, remote file
permissions, persistent data directory, container replacement, port mapping, and
bounded health checks.

Make explicit that VM creation, Docker installation, DNS, TLS termination, Oracle
network rules, backend deployment, and private-registry login are operator work.
Reference historical Oracle plan/design only as background, not active instructions.
State that script removes current named container before starting replacement, causing
brief interruption and no automatic rollback. Recommend preserving previous immutable
image tag, backing up remote data directory, and defining manual recovery before run.

## Navigation updates

Update `documents/README.md` deployment section with all four active deployment
guides. Update root `README.md` deployment bullets so Azure, AWS, and Oracle entries
link to guides while retaining script names.

Add this cloud-deployment specification to `documents/README.md` History →
Specifications.

## Verification

- Compare every documented option, variable, resource, and command with current
  scripts and example files.
- Check `bash -n deploy.sh deploy-aws.sh deploy-oracle.sh`.
- Run `./deploy-aws.sh --help` and `./deploy-oracle.sh --help`; do not execute a live
  deployment.
- Run deployment-specific checks with
  `node --test --test-name-pattern='^(App Service|container image|deployment never|custom server|production build|local container build|all-in-one deployment)' tests/deployment-security.test.mjs`
  and `node --test tests/deploy-oracle.test.mjs`. Positive pattern excludes known
  unrelated passkey README wording test rather than changing authentication
  documentation for this task.
- Format only explicitly changed Markdown paths with repository Prettier
  configuration.
- Resolve local Markdown files and fragments.
- Run `git diff --check` and inspect documentation-only scope.
- Preserve existing Git index plus unrelated `.dockerignore` and generated API
  changes exactly.
- Inspect `threadroot score latest` only when `threadroot prep` successfully records a
  run. Record prep failure when optimizer cannot write its local index.
