# Multi-Runtime Build Scripts Design

## Goal

Allow `build.sh` and `build-aws.sh` to build and push images with Apple's `container`
CLI, daemonless Podman, or Docker CLI. Preserve existing Apple `container` behavior
and make runtime selection automatic, with an explicit override for deterministic
automation.

## Runtime selection

Add a shared Bash helper at `scripts/container-runtime.sh`. Both build scripts source
it and call one selection function before invoking a container runtime.

Selection order:

1. When `CONTAINER_CLI` is present, accept only `container`, `podman`, or `docker` and
   require that command on `PATH`. A present but empty value is invalid rather than
   triggering automatic selection.
2. Otherwise, select `container` when available.
3. Otherwise, select `podman` when available.
4. Otherwise, select `docker` when available.
5. If no supported command exists, stop with an error that names all three tools and
   explains the `CONTAINER_CLI` override.

This preserves Apple `container` as default where multiple tools are installed, gives
daemonless Podman priority over Docker, and lets CI or operators force any supported
runtime, for example `CONTAINER_CLI=podman`.

## Shared runtime interface

The helper provides focused functions for operations whose CLI syntax or lifecycle
differs:

- readiness: retain `container system status` and automatic
  `container system start --disable-kernel-install`; for Podman, require successful
  `podman info` without starting or managing a daemon or Podman machine; for Docker,
  require successful `docker info` and report that Docker daemon must be started when
  unavailable;
- image build: pass common build arguments through because all three CLIs accept the
  `build`, `--platform`, `--build-arg`, `-f`, and `-t` forms used here; preserve
  `--progress plain` for Apple and Docker in the AWS build, but omit it for Podman
  because Podman's stable build command does not support that option;
- registry login: use `container registry login` for Apple, `podman login` for Podman,
  and `docker login` for Docker;
- push: use `container image push` for Apple, `podman push` for Podman, and
  `docker push` for Docker.

Functions execute argument arrays directly, without string evaluation. Credentials
continue to flow through standard input for ECR login and are never added to command
arguments or logs.

## Script integration

### `build.sh`

Use shared selection, readiness, build, and push functions. Keep clean staged build
context, `linux/amd64` target, build arguments, image name, and Docker Hub flow
unchanged.

Apple's builder-status and 8 GiB memory configuration remains in `build.sh`, guarded
so it runs only when selected runtime is `container`. Podman and Docker manage their
own build resources, so neither path attempts equivalent memory reconfiguration.

### `build-aws.sh`

Use shared selection, readiness, build, ECR login, and push functions. Keep AWS
authentication, ECR repository creation, `Dockerfile-aws`, `linux/amd64` target,
mutable `latest` tag, and timing output unchanged.

The AWS build passes `--progress plain` only for selected runtimes that support it:
Apple `container` and Docker. Podman receives otherwise-identical build inputs without
that option.

## Failure behavior

- Invalid `CONTAINER_CLI` value fails before any build or push.
- Requested but missing runtime fails with named command.
- Podman command present but unusable fails at `podman info`; script does not start a
  service or Podman machine because Podman support is intentionally daemonless.
- Docker command present but daemon unavailable fails before image build.
- Apple runtime retains current automatic service startup.
- Build, login, or push failures remain fatal under script error handling.

No fallback occurs after an explicitly selected or auto-selected runtime fails. This
avoids silently changing runtime midway through an authenticated build.

## Tests

Extend deployment-focused Node tests with temporary fake runtime executables to verify
observable Bash helper behavior:

- automatic selection prefers `container` when all three commands exist;
- automatic selection chooses Podman before Docker when Apple `container` is absent;
- automatic selection chooses Docker when it is the only supported runtime;
- explicit overrides win regardless of automatic priority;
- empty, invalid, or unavailable explicit override fails clearly;
- Podman readiness calls `podman info` and never attempts service or machine startup;
- Docker readiness calls `docker info` and does not attempt Apple startup;
- Apple readiness retains status/start commands;
- ECR login and push map to runtime-specific command forms;
- AWS build omits `--progress plain` only for Podman.

Add integration assertions that both build scripts source and use shared helper, and
that Apple-only builder-memory setup in `build.sh` is runtime-gated. Existing
deployment security tests continue to cover clean staged context and minimum Apple
builder memory.

Run focused deployment tests first, then repository lint and production build.

## Documentation

Update `documents/deployment/aws-ecs-fargate.md` so local prerequisites and build flow
describe auto-detection, Apple preference, daemonless Podman, Docker support, and
`CONTAINER_CLI` override.
Update any other active documentation that still states build scripts require Apple
`container` exclusively.

Podman behavior is based on current official documentation for its
[daemonless CLI](https://docs.podman.io/en/latest/markdown/podman.1.html),
[`build`](https://docs.podman.io/en/stable/markdown/podman-build.1.html),
[`login`](https://docs.podman.io/en/stable/markdown/podman-login.1.html), and
[`push`](https://docs.podman.io/en/stable/markdown/podman-push.1.html) commands.

## Out of scope

- Replacing Apple `container` support.
- Starting, initializing, or managing a Podman machine or service.
- Automatically installing or starting Docker Desktop/daemon.
- Changing image tags, registries, cloud resources, or deployment scripts.
- Refactoring provider environment loaders or secret handling.
- Adding other runtimes beyond Apple `container`, Podman, and Docker.
