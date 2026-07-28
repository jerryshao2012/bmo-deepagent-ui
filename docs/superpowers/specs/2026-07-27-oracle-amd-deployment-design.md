# Oracle AMD VM Deployment Design

## Goal

Deploy existing `linux/amd64` Deep Agent UI container image to Oracle Cloud
Always Free AMD micro VM. Reuse image produced by `build.sh`; do not add
`build-oracle.sh`.

## Scope

Add one executable repository-root script: `deploy-oracle.sh`.

Script deploys UI container to an already-provisioned Oracle VM. VM creation,
Docker installation, DNS, TLS termination, Oracle security-list configuration,
and backend deployment remain operator responsibilities.

## Configuration

Script optionally sources `env-oracle.sh` when present, then validates:

- `ORACLE_HOST`: VM public IP address or DNS name.
- `ORACLE_SSH_KEY`: local SSH private-key path.
- `DOCKER_HUB_USERNAME`: owner of existing
  `docker.io/<owner>/deepagent-ui:latest` image.

Optional settings:

- `ORACLE_USER`, default `opc`.
- `ORACLE_SSH_PORT`, default `22`.
- `ORACLE_HTTP_PORT`, default `80`.
- `ORACLE_CONTAINER_NAME`, default `deepagent-ui`.
- `ORACLE_IMAGE`, default
  `docker.io/$DOCKER_HUB_USERNAME/deepagent-ui:latest`.
- `ORACLE_PUBLIC_URL`, default `http://$ORACLE_HOST`, including configured
  host port when it is not `80`.

Local `.env.docker` is required because container needs runtime application
configuration. Script copies it through SSH to VM deployment directory and
sets remote permissions to `0600`. Docker Hub credentials are not copied;
private repositories must already be authenticated on VM.

## Deployment Flow

1. Enable strict Bash failure handling and resolve repository root from script
   location.
2. Load optional `env-oracle.sh`.
3. Validate required local commands, configuration, SSH key, and `.env.docker`.
4. Verify SSH access and availability of either directly usable Docker or
   passwordless `sudo docker`.
5. Create `~/deepagent-ui/data` and secure remote deployment directory.
6. Copy `.env.docker` to `~/deepagent-ui/.env.docker` and apply mode `0600`.
7. Pull configured AMD64 image.
8. Remove existing named container when present.
9. Start replacement container with:
   - `--restart unless-stopped`;
   - host `$ORACLE_HTTP_PORT` mapped to container port `3000`;
   - copied environment file;
   - `AUTH_URL`, `NEXTAUTH_URL`, and `AUTH_TRUST_HOST` runtime overrides;
   - persistent `~/deepagent-ui/data` volume mounted at
     `/app/data/markdown_threads`.
10. Poll `$ORACLE_PUBLIC_URL` for a successful HTTP or redirect response.
11. On failed health verification, print recent remote container logs and exit
    nonzero.

Deployment briefly interrupts traffic while named container is replaced.

## Build Compatibility

`build.sh` already produces and pushes
`docker.io/$DOCKER_HUB_USERNAME/deepagent-ui:latest` for `linux/amd64`, matching
Oracle AMD micro VM. No Oracle-specific build is needed.

`NEXT_PUBLIC_*` values are embedded during Next.js image build. Operator must
rerun `build.sh` before deployment when public backend URL or assistant ID
changes; `deploy-oracle.sh` only deploys existing image.

## Error Handling and Security

- Never print `.env.docker` contents or secret values.
- Use quoted configuration values and SSH arguments.
- Reject missing commands, unreadable SSH key, missing environment file, failed
  SSH connection, missing Docker, pull failure, container start failure, and
  failed health check.
- Avoid installing packages or changing Oracle firewall rules automatically.
- Keep application data on VM-owned persistent directory.

## Verification

Add Node test coverage that executes script against stubbed `ssh`, `scp`, and
`curl` commands. Verify:

- `--help` exits without deployment.
- Missing required configuration fails before SSH.
- Deployment uses existing AMD64 Docker Hub image, secure environment copy,
  restart policy, expected port mapping, and persistent data mount.
- Health-check failure exits nonzero and requests recent container logs.

Run deployment test, repository deployment-security tests, `bash -n
deploy-oracle.sh`, and `yarn lint`. Full production deployment is not run
without Oracle credentials and explicit production authorization.
