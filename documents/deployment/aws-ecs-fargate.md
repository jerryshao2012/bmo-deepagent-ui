# Deploy to AWS ECS Fargate

Build UI image with [`build-aws.sh`](../../build-aws.sh), push it to Amazon ECR, and
deploy it with [`deploy-aws.sh`](../../deploy-aws.sh) to ECS Fargate behind Application
Load Balancer and CloudFront.

> **Production blockers:** Current task definition sets `VERIFY_SSL=false` and injects
> Secrets Manager `LANGCHAIN-API-KEY` as browser-visible
> `NEXT_PUBLIC_LANGSMITH_API_KEY`. Remediate both in `deploy-aws.sh` before production.
> This guide documents existing automation; it does not endorse those defaults or
> provide complete production hardening.

Operator owns AWS account security, provider-resource lifecycle, backups, availability,
cost management, rollback, and cleanup.

## Architecture

```text
generic local build host
  └─ build-aws.sh
       └─ runtime priority: Apple container → Podman → Docker ──> Amazon ECR :latest

operator
  └─ deploy-aws.sh
       ├─ IAM execution/task roles
       ├─ default VPC security groups
       ├─ internet-facing ALB (HTTP origin)
       ├─ CloudFront distribution (HTTPS viewer endpoint)
       ├─ CloudWatch log group
       ├─ ECS cluster and task definition
       └─ ECS Fargate service (desired count: 1, public task IP)
```

CloudFront redirects viewers to HTTPS, but current distribution connects to ALB over
HTTP. ECS task receives a public IP. Service runs one task and has no persistent volume.

## Prerequisites

### Local tools

- AWS CLI authenticated to intended account and region.
- Bash, Node.js, `curl`, `grep`, `sed`, and standard Unix tools.
- One supported image-build CLI: Apple [`container`](https://github.com/apple/container),
  [Podman](https://docs.podman.io/en/latest/markdown/podman.1.html), or Docker. Automatic
  selection priority is exactly Apple `container` → Podman → Docker. Set
  `CONTAINER_CLI=container|podman|docker` to force a deterministic choice.
- Selected runtime and host must support building a `linux/amd64` image. Apple
  `container` requires its supported macOS and hardware; Podman or Docker hosts do not
  require Apple silicon.
- Repository-local ignored `.env.docker`, typically copied from
  [`.env.docker.example`](../../.env.docker.example).
- Sibling backend repository with readable `../deep-research/env-aws.sh` exporting
  `DEEP_RESEARCH_AGENT_URL`.

Apple documents current platform support and CLI behavior in
[`container` project](https://github.com/apple/container) and
[command reference](https://github.com/apple/container/blob/main/docs/command-reference.md).
Podman documents its CLI in the [Podman manual](https://docs.podman.io/en/latest/markdown/podman.1.html)
and build behavior in [`podman build`](https://docs.podman.io/en/stable/markdown/podman-build.1.html).

Runtime readiness differs by selection:

- Apple path starts its container system when needed.
- Podman path checks `podman info`. Script never starts or manages a daemon, service,
  or Podman machine. On platforms that require a Podman machine, operator must start it.
- Docker path checks `docker info`. Docker daemon must already be running; script does
  not start it.

### Existing AWS capabilities

- Default VPC in selected region.
- At least two subnets in different Availability Zones.
- Permissions for STS, ECR, IAM, EC2 security groups, ELBv2, CloudFront, CloudWatch
  Logs, ECS, and Secrets Manager.
- Secrets Manager JSON secret expected by `SECRETS_MANAGER_NAME`, or reviewed local
  `secrets-aws.sh` that creates/updates it.

The script discovers default VPC; it does not create VPC or subnets.

## Configure deployment

### 1. Review tracked environment loader

[`env-aws.sh`](../../env-aws.sh) contains environment-specific defaults. It:

1. sources mandatory `../deep-research/env-aws.sh`;
2. sets backend URL and AWS resource-name inputs;
3. updates `NEXT_PUBLIC_LANGGRAPH_URL` in `.env.docker` when file exists;
4. optionally sources `.env` last.

Use sanitized overrides in ignored `.env` or an environment-specific reviewed copy.
Never copy repository `SEED`, account IDs, region, or resource names blindly:

```env
SEED="your-suffix"
APP_NAME="your-ui-name"
AWS_REGION="your-region"
ECR_REPO_NAME="your-ecr-repository"
SECRETS_MANAGER_NAME="your-secret-name"
NEXT_PUBLIC_ASSISTANT_ID="research"
```

### 2. Prepare ignored runtime environment

```bash
cp .env.docker.example .env.docker
```

Replace placeholders. `env-aws.sh` mutates backend URL in this file. Do not commit
`.env`, `.env.docker`, copied secret scripts, AWS credentials, or account identifiers.

### 3. Prepare Secrets Manager values

Tracked [`secrets-aws.sh.example`](../../secrets-aws.sh.example) is template. Copy it,
replace every placeholder, inspect target account/region/secret, and protect file:

```bash
cp secrets-aws.sh.example secrets-aws.sh
chmod 700 secrets-aws.sh
```

During full deployment, `deploy-aws.sh` runs local `secrets-aws.sh` when present, then
validates secret exists. Without copied helper, secret must already exist. Secret JSON
keys expected by task definition include:

- `UPLOAD-API-KEY`
- `LANGCHAIN-API-KEY`
- `AUTH-SECRET`
- Google and GitHub OAuth client IDs/secrets

AWS notes secrets injected as ECS environment variables are available to container and
are not refreshed until new task starts. See
[ECS Secrets Manager environment variables](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html).

## Build and push image

```bash
./build-aws.sh
CONTAINER_CLI=podman ./build-aws.sh
CONTAINER_CLI=docker ./build-aws.sh
```

Build script:

1. selects and checks runtime readiness;
2. authenticates with AWS;
3. creates ECR repository when absent;
4. builds `Dockerfile-aws` for `linux/amd64`;
5. logs selected runtime in to ECR with password over standard input;
6. pushes mutable `latest` tag.

Adapter retains `--progress plain` for Apple `container` and Docker builds and omits it
for Podman.

Deployment fails when ECR `latest` is missing. For production, change automation to
publish immutable version tag or digest in addition to convenience tag. AWS ECR image
workflow: [Push image to ECR](https://docs.aws.amazon.com/AmazonECR/latest/userguide/docker-push-ecr-image.html).

## Deploy

### Full mode

```bash
./deploy-aws.sh
```

Full mode validates or creates/configures:

- Secrets Manager integration (secret itself only through optional copied helper);
- ECS task execution role and task role;
- secret-read inline policy;
- ALB and ECS security groups in default VPC;
- target group with IP targets and `/` health path;
- internet-facing ALB and HTTP listener on port 80;
- CloudFront distribution with HTTPS viewer redirect and HTTP-only ALB origin;
- CloudWatch log group;
- ECS cluster;
- task definition and one-task Fargate service.

ALB use with ECS/Fargate: [ECS load balancing](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-load-balancing.html).
CloudFront custom origin behavior: [CloudFront origin settings](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesOrigin.html).

### Fast update mode

```bash
./deploy-aws.sh --skip-infra-setup
```

This skips creation checks but still looks up roles, secret, default VPC/subnets,
security group, target group, ALB, and CloudFront. It then registers new task definition
and updates or creates ECS service. Use only after full infrastructure exists and names
match current configuration.

## Current security and reliability risks

Resolve these before production:

| Risk                      | Current behavior                                             | Required direction                                                        |
| ------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| TLS verification disabled | Task sets `VERIFY_SSL=false`.                                | Remove override and configure valid backend trust chain.                  |
| Secret exposed to browser | `LANGCHAIN-API-KEY` becomes `NEXT_PUBLIC_LANGSMITH_API_KEY`. | Keep key server-side; remove browser-visible mapping.                     |
| HTTP origin               | CloudFront connects to ALB with `http-only`.                 | Configure TLS from CloudFront to origin or approved private/VPC origin.   |
| Public task address       | ECS service uses `assignPublicIp=ENABLED`.                   | Prefer private subnets/NAT or VPC endpoints and restricted routing.       |
| Mutable image             | Task definition references `:latest`.                        | Use immutable image tag/digest and record release mapping.                |
| No deployment rollback    | Script does not enable ECS circuit breaker/alarms.           | Configure failure detection and tested rollback policy.                   |
| One task                  | Service uses desired count 1.                                | Set availability target, autoscaling, and multi-AZ capacity strategy.     |
| Ephemeral Markdown data   | No volume or external storage configured.                    | Use external persistent store or back up disposable container-local data. |

AWS Fargate networking details:
[ECS task networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html).
AWS supports circuit-breaker rollback, but repository script does not configure it:
[ECS deployment circuit breaker](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html).

## Verify

Script waits for ECS service stability, then polls CloudFront URL. Current health loop
treats `200`, `302`, `307`, and `403` as success and still exits zero after all retries
without a valid response. Therefore script exit status is not sufficient.

Perform functional checks:

- ECS service has intended task definition and running task count.
- Target group reports healthy target.
- CloudFront distribution is deployed.
- UI loads over HTTPS without 403.
- Chat reaches intended backend and streams run.
- Upload/file-view routes authenticate.
- OAuth callback returns to CloudFront domain.
- CloudWatch logs show no secret-resolution or TLS errors.
- Replacement task does not lose state that must persist.

## Update and rollback

No automatic rollback exists in script. Current update registers new task definition,
forces service deployment, and references mutable `latest`.

Before update:

- publish immutable image tag/digest;
- record current task-definition ARN and resolved image digest;
- export or externalize state;
- validate rollback IAM and networking permissions;
- schedule for one-task interruption risk.

For manual rollback, update service to known-good task-definition revision/image and
wait for stability, then rerun functional checks. AWS documents rolling deployment and
rollback options in [ECS rolling deployments](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-ecs.html).

## Troubleshooting

| Symptom                      | Check                                                                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AWS authentication fails     | Active profile, account, region, and STS permissions.                                                                                                                                          |
| Selected runtime unavailable | Runtime is on `PATH`, supports `linux/amd64`, and passes readiness check. Start Apple container system, Docker daemon, or required Podman machine; script manages only Apple container system. |
| `latest` missing             | Reviewed `build-aws.sh` completed with selected runtime; verify runtime readiness, ECR login/auth store, repository, tag, and AWS region.                                                      |
| Podman readiness fails       | Run `podman info`. On platforms requiring a Podman machine, operator must start it; script never manages Podman daemon, service, or machine.                                                   |
| Secret missing               | `SECRETS_MANAGER_NAME`, optional copied helper, region, and IAM permissions.                                                                                                                   |
| Default VPC/subnets missing  | Region default VPC and at least two AZ subnets; script cannot use arbitrary VPC without changes.                                                                                               |
| ALB target unhealthy         | Target security group, target type `ip`, port 3000, task logs, and `/` response.                                                                                                               |
| CloudFront returns 403       | Distribution state, origin reachability, policies, app auth, and current false-positive health behavior.                                                                                       |
| Task cannot read secret      | Execution-role policy, secret ARN/JSON keys, and Fargate platform support.                                                                                                                     |
| New task loses files         | No persistent volume is configured; restore from backup or external store.                                                                                                                     |

## Cost and cleanup

ECS Fargate, ALB, public IPv4, CloudFront, ECR, CloudWatch Logs, and Secrets Manager may
all incur charges. Review current provider pricing and budgets before creating them.

`deploy-aws.sh` does not deprovision resources. Operator must inventory and remove ECS
service/cluster, task definitions, CloudFront distribution, ALB/listener/target group,
security groups, IAM roles/policies, ECR repository/images, log group, Secrets Manager
secret, and retained data when environment is retired. Preserve anything needed for
audit or recovery first.

Return to [deployment documentation](../README.md#deployment).
