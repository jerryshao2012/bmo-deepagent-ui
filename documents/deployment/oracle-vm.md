# Deploy to an Oracle VM

Deploy existing `linux/amd64` Docker Hub image to already-provisioned Oracle AMD VM by
running [`deploy-oracle.sh`](../../deploy-oracle.sh).

> This guide documents repository deployment automation, not VM provisioning or
> complete production hardening. Operator owns compute, networking, Docker, DNS, TLS,
> secrets, backups, availability, cost management, rollback, and cleanup.

## Architecture

```text
local workstation
  └─ deploy-oracle.sh
       ├─ SSH/SCP with private key
       ├─ copies runtime env as mode 0600
       └─ runs Docker directly or through passwordless sudo

Oracle AMD VM
  └─ deepagent-ui container
       ├─ public port -> container port 3000
       ├─ restart policy: unless-stopped
       └─ ~/deepagent-ui/data -> /app/data/markdown_threads
```

Script does not create VM, install Docker, open Oracle network rules, configure DNS or
TLS, deploy backend, or authenticate private Docker registry.

## Prerequisites

### Oracle and VM

- Existing `linux/amd64` Oracle VM.
- Network path from workstation to SSH port.
- Public/reachable application port permitted by Oracle Network Security Group or
  security list and host firewall.
- SSH public-key login for deployment user.
- Docker Engine usable directly or through passwordless `sudo docker`.
- Docker Hub authentication already configured on VM when image is private.
- Existing public backend URL configured in runtime environment.

Oracle documents instance/public-IP behavior in
[Create a Compute instance](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/launchinginstance.htm)
and shared security responsibility in
[Securing Compute](https://docs.oracle.com/en-us/iaas/Content/Security/Reference/compute_security.htm).
Install Docker using supported distribution instructions from
[Docker Engine documentation](https://docs.docker.com/engine/install/).

### Local tools and files

- Bash, `ssh`, `scp`, and `curl`.
- Readable SSH private key.
- Readable `ORACLE_ENV_FILE`; default is ignored `.env.docker` beside script.
- Existing `linux/amd64` image in Docker Hub.

## Configuration

### Required variables

| Variable              | Purpose                                                                     |
| --------------------- | --------------------------------------------------------------------------- |
| `ORACLE_HOST`         | VM DNS name or public IP; only letters, digits, dots, and hyphens accepted. |
| `ORACLE_SSH_KEY`      | Path to readable SSH private key.                                           |
| `DOCKER_HUB_USERNAME` | Default Docker Hub image owner.                                             |

### Optional variables

| Variable                | Default                                    | Purpose                                                       |
| ----------------------- | ------------------------------------------ | ------------------------------------------------------------- |
| `ORACLE_USER`           | `opc`                                      | SSH user.                                                     |
| `ORACLE_SSH_PORT`       | `22`                                       | SSH port, 1-65535.                                            |
| `ORACLE_HTTP_PORT`      | `80`                                       | Public host port mapped to container port 3000.               |
| `ORACLE_CONTAINER_NAME` | `deepagent-ui`                             | Remote Docker container name.                                 |
| `ORACLE_IMAGE`          | `docker.io/<username>/deepagent-ui:latest` | Image to pull and run. Prefer immutable version tag.          |
| `ORACLE_PUBLIC_URL`     | `http://<host>[:port]`                     | Canonical UI URL used for Auth.js settings and health checks. |
| `ORACLE_ENV_FILE`       | `.env.docker`                              | Local runtime environment copied to VM.                       |

Script optionally sources `env-oracle.sh` beside it. File is not currently tracked.
Create it only with sanitized environment-specific values and keep it out of version
control:

```bash
export ORACLE_HOST="ui.example.com"
export ORACLE_SSH_KEY="/secure/path/oracle-ui.key"
export DOCKER_HUB_USERNAME="your-registry-user"
export ORACLE_PUBLIC_URL="https://ui.example.com"
export ORACLE_IMAGE="docker.io/your-registry-user/deepagent-ui:release-2026-08-04"
```

Do not copy sample hostnames, usernames, keys, or image tags into another environment.

## Prepare runtime environment

Start from tracked example:

```bash
cp .env.docker.example .env.docker
chmod 600 .env.docker
```

Replace placeholders and configure backend URL, assistant ID, API keys, and optional
passkey values. `ORACLE_ENV_FILE` must be readable or script exits before remote action.

Environment file contains plaintext runtime secrets. Script copies it to
`~/deepagent-ui/.env.docker` and sets mode `0600`; deployment user and privileged VM
administrators can still read it. Use appropriate host access control and secret
rotation.

## Preflight

Show exact supported options:

```bash
./deploy-oracle.sh --help
```

Validate local inputs without printing secrets:

```bash
test -r "$ORACLE_SSH_KEY"
test -r "${ORACLE_ENV_FILE:-.env.docker}"
command -v ssh scp curl
```

Validate SSH and Docker before maintenance window:

```bash
ssh -i "$ORACLE_SSH_KEY" -p "${ORACLE_SSH_PORT:-22}" \
  "${ORACLE_USER:-opc}@$ORACLE_HOST" 'docker version || sudo -n docker version'
```

Confirm remote Docker can pull chosen private image before replacing running container.

## Deploy

```bash
./deploy-oracle.sh
```

Script:

1. validates variable syntax, ports, public URL, readable key/env file, and local tools;
2. verifies batch-mode SSH;
3. selects direct Docker or passwordless `sudo docker`;
4. creates `~/deepagent-ui/data` and locks deployment directory to `0700`;
5. copies runtime env to remote path with mode `0600`;
6. pulls configured image;
7. removes existing named container;
8. starts replacement with `--restart unless-stopped`, port mapping, env file,
   Auth.js URL overrides, and persistent Markdown data mount;
9. polls public URL up to 12 times;
10. prints last 100 container log lines and exits nonzero if verification fails.

Health accepts HTTP `200`, `301`, `302`, `303`, `307`, or `308`. Each attempt uses
10-second connection timeout and 30-second total timeout, with five-second delay between
attempts.

## Verify

Script health success confirms accepted HTTP status only. Also verify:

- Public URL uses intended scheme/domain and TLS certificate.
- UI loads and settings point to correct backend/assistant.
- Chat starts and streams a run.
- Upload and file-view routes authenticate.
- OAuth returns to exact `ORACLE_PUBLIC_URL`.
- Passkeys use exact configured origin/RP ID.
- Container runs expected immutable image.
- `~/deepagent-ui/data` persists Markdown data after container restart.
- VM reboot returns container through `unless-stopped` policy.

## Update and rollback

Container replacement briefly interrupts traffic. Script removes current container
before replacement starts and provides no automatic rollback. If new container fails,
service remains unavailable until operator restores working image/configuration.

Before update:

- use immutable `ORACLE_IMAGE`, not `latest`;
- record current image digest and environment-file checksum without exposing contents;
- back up `~/deepagent-ui/data` and protected runtime environment;
- verify previous image remains available to VM;
- schedule maintenance window.

To roll back, set `ORACLE_IMAGE` to known-good immutable tag, restore compatible env/data
when needed, rerun script, and repeat functional verification.

## Troubleshooting

| Symptom                  | Check                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| SSH fails                | Host, port, user, key permissions, Oracle network rules, host firewall, and authorized keys. |
| Docker unavailable       | Docker daemon, deployment-user access, or passwordless `sudo docker`.                        |
| Image pull fails         | Image name/tag, AMD64 compatibility, registry reachability, and remote registry login.       |
| Environment rejected     | `ORACLE_ENV_FILE` path/readability and shell-safe contents.                                  |
| Container exits          | `docker logs`, runtime variables, port conflict, and backend reachability.                   |
| Health redirects forever | `ORACLE_PUBLIC_URL`, DNS, reverse proxy/TLS, and Auth.js URL settings.                       |
| Markdown data missing    | Remote `~/deepagent-ui/data`, mount, ownership, and backup.                                  |

## Security, availability, cost, and cleanup

- Default public URL is HTTP. Put trusted TLS terminator/reverse proxy in front or use
  approved HTTPS configuration before handling credentials.
- Restrict SSH by source network, use public-key auth, and review authorized keys.
- Docker-published ports can interact with host firewall rules; validate effective
  exposure.
- One VM and one container provide no high availability or zero-downtime update.
- VM, public IP, network egress, DNS, backups, and registry usage may incur charges.
- Operator deprovisions VM/network, remote image/container, `~/deepagent-ui`, backups,
  and credentials when environment is retired; script never cleans them up.

## Historical context

- [Oracle deployment design](../history/specifications/2026-07-27-oracle-amd-deployment-design.md)
- [Oracle deployment implementation plan](../history/plans/2026-07-27-oracle-amd-deployment.md)

Historical records describe implementation decisions at time written. Use this guide
for current operations.

Return to [deployment documentation](../README.md#deployment).
