# Build and Deployment Command Argument Design

## Build runtime scope

Add the same command-line runtime override to the frontend and backend
`../../../build.sh` scripts without removing either repository's existing environment
override. Frontend currently exposes `CONTAINER_CLI`; backend currently exposes
the legacy name `CONTAINER_RUNTIME` and will also accept `CONTAINER_CLI` as the
new cross-repository name.

Supported forms:

```bash
./build.sh --container-cli podman
./build.sh --container-cli=podman
./build.sh -c podman
```

Supported runtime values remain `container`, `podman`, and `docker`.

## Precedence and validation

An explicit command-line value takes precedence over environment overrides. When
no argument is supplied, frontend uses `CONTAINER_CLI` and then automatic Apple
Container → Podman → Docker selection. Backend uses this order:

1. `CONTAINER_CLI`;
2. legacy `CONTAINER_RUNTIME`; and
3. automatic Apple Container → Podman → Docker selection.

If both backend environment aliases are set to different values and no CLI
argument resolves the choice, the build fails before side effects. Setting both
aliases to the same supported value is accepted. Existing
`CONTAINER_RUNTIME=podman ./build.sh` backend invocations remain compatible.

Argument parsing runs before configuration loading, version mutation, container
runtime startup, build or push commands, and Azure access. The scripts fail
closed for:

- a missing option value;
- an unsupported runtime;
- duplicate or conflicting runtime options;
- unknown arguments; and
- a selected runtime that is unavailable.

`--help` and `-h` print usage without performing configuration, build, registry,
or Azure operations. Existing `CONTAINER_CLI=podman ./build.sh` invocations stay
compatible in both repositories.

## Implementation boundary

Each repository gets a small Bash 3.2-compatible parser at the start of
`../../../build.sh`. The parser records the CLI override separately, then supplies it to
the existing runtime-selection adapter. Backend normalizes the selected public
option or environment alias into its existing internal `CONTAINER_RUNTIME`
variable. This build-runtime option does not alter deployment behavior. Secrets,
dotenv parsing, build manifests, backend version transactions, runtime readiness,
and image naming remain unchanged.

## Verification

Black-box tests in both repositories cover all three accepted forms, argument
precedence, environment fallback, backend legacy `CONTAINER_RUNTIME`
compatibility, matching and conflicting backend aliases, automatic selection,
help, invalid or missing values, duplicate/conflicting flags, unknown arguments,
unavailable runtimes, and proof that failures occur before side effects.
Existing runtime, build, deployment, passkey, lint, formatting, Bash syntax, and
diff checks remain green.

## OAuth deployment confirmation

Both Azure deployment scripts accept a dedicated boolean confirmation flag:

```bash
./deploy.sh --oauth-redirects-confirmed
./deploy-azure-container-app.sh --oauth-redirects-confirmed
```

The flag is equivalent to the existing process-local
`OAUTH_REDIRECTS_CONFIRMED=true` override. Existing environment-based commands
remain compatible, while the explicit flag takes precedence and supplies only
the exact value `true`. Confirmation is never written to dotenv, `../../../env.sh`, build
metadata, endpoint metadata, or Azure configuration.

The flag accepts no value. Duplicate occurrences, value-bearing variants such as
`--oauth-redirects-confirmed=false`, and unknown arguments fail before Azure
access or application mutation. No short option is provided because OAuth
provider confirmation is a security-sensitive operator assertion that should be
explicit at the call site.

Confirmation remains conditional: deployment requires it only when the endpoint
resolver reports changed OAuth URLs. An unchanged deployment continues normally
without the flag. Supplying the flag on an unchanged deployment is harmless and
does not alter configuration.

Each deployment script documents the option in side-effect-free `--help` and
`-h` output. Black-box tests cover both scripts, environment compatibility, CLI
precedence, changed and unchanged endpoint flows, duplicate/value-bearing/unknown
argument rejection, help output, and proof that argument failures occur before
configuration, Azure, or deployment operations.
