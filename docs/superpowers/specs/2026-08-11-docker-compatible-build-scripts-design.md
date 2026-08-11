# Docker-Compatible Build Scripts Design

## Goal

Allow `build.sh` and `build-aws.sh` to build and push images with either Apple's
`container` CLI or Docker CLI. Preserve existing Apple `container` behavior and make
runtime selection automatic, with an explicit override for deterministic automation.

## Runtime selection

Add a shared Bash helper at `scripts/container-runtime.sh`. Both build scripts source
it and call one selection function before invoking a container runtime.

Selection order:

1. When `CONTAINER_CLI` is present, accept only `container` or `docker` and require
   that command on `PATH`. A present but empty value is invalid rather than triggering
   automatic selection.
2. Otherwise, select `container` when available.
3. Otherwise, select `docker` when available.
4. If neither command exists, stop with an error that names both supported tools and
   explains the `CONTAINER_CLI` override.

This preserves Apple `container` as default on machines where both tools are installed
while allowing CI and operator environments to force Docker with
`CONTAINER_CLI=docker`.

## Shared runtime interface

The helper provides focused functions for operations whose CLI syntax or lifecycle
differs:

- readiness: retain `container system status` and automatic
  `container system start --disable-kernel-install`; for Docker, require successful
  `docker info` and report that Docker daemon must be started when unavailable;
- image build: pass build arguments through to selected CLI because both accept
  `build`, `--platform`, `--build-arg`, `-f`, and `-t` forms used here;
- registry login: use `container registry login` for Apple and `docker login` for
  Docker;
- push: use `container image push` for Apple and `docker push` for Docker.

Functions execute argument arrays directly, without string evaluation. Credentials
continue to flow through standard input for ECR login and are never added to command
arguments or logs.

## Script integration

### `build.sh`

Use shared selection, readiness, build, and push functions. Keep clean staged build
context, `linux/amd64` target, build arguments, image name, and Docker Hub flow
unchanged.

Apple's builder-status and 8 GiB memory configuration remains in `build.sh`, guarded
so it runs only when selected runtime is `container`. Docker manages its own builder,
so Docker path does not attempt equivalent daemon or memory reconfiguration.

### `build-aws.sh`

Use shared selection, readiness, build, ECR login, and push functions. Keep AWS
authentication, ECR repository creation, `Dockerfile-aws`, `linux/amd64` target,
mutable `latest` tag, and timing output unchanged.

## Failure behavior

- Invalid `CONTAINER_CLI` value fails before any build or push.
- Requested but missing runtime fails with named command.
- Docker command present but daemon unavailable fails before image build.
- Apple runtime retains current automatic service startup.
- Build, login, or push failures remain fatal under script error handling.

No fallback occurs after an explicitly selected or auto-selected runtime fails. This
avoids silently changing runtime midway through an authenticated build.

## Tests

Extend deployment-focused Node tests with temporary fake runtime executables to verify
observable Bash helper behavior:

- automatic selection prefers `container` when both commands exist;
- automatic selection chooses Docker when only Docker exists;
- explicit Docker override wins when both exist;
- empty, invalid, or unavailable explicit override fails clearly;
- Docker readiness calls `docker info` and does not attempt Apple startup;
- Apple readiness retains status/start commands;
- ECR login and push map to runtime-specific command forms.

Add integration assertions that both build scripts source and use shared helper, and
that Apple-only builder-memory setup in `build.sh` is runtime-gated. Existing
deployment security tests continue to cover clean staged context and minimum Apple
builder memory.

Run focused deployment tests first, then repository lint and production build.

## Documentation

Update `documents/deployment/aws-ecs-fargate.md` so local prerequisites and build flow
describe auto-detection, Apple preference, Docker support, and `CONTAINER_CLI` override.
Update any other active documentation that still states build scripts require Apple
`container` exclusively.

## Out of scope

- Replacing Apple `container` support.
- Automatically installing or starting Docker Desktop/daemon.
- Changing image tags, registries, cloud resources, or deployment scripts.
- Refactoring provider environment loaders or secret handling.
- Adding other runtimes such as Podman.
