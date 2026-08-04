# BMO Deep Agents UI

Web interface for interacting with [Deep Agents](https://github.com/langchain-ai/deepagents)
and LangGraph deployments. UI supports streaming chat, run controls, generated
files, document viewers, authentication, and configurable backend connections.

## Features

- Connect to local or hosted LangGraph deployments.
- Stream agent runs and handle interrupts from chat interface.
- Browse, preview, and download files produced by agents.
- Run agents step by step in Debug Mode.
- Authenticate with Google, GitHub, or optional passkeys.
- Deploy with repository scripts or Vercel.

## Prerequisites

- Node.js 22
- Corepack
- Access to compatible LangGraph or Deep Agents backend
- Yarn version bundled with repository

## Quick start

```bash
git clone https://github.com/jerryshao2012/bmo-deepagent-ui.git
cd bmo-deepagent-ui
corepack enable
yarn install --immutable
yarn dev
```

Open [http://localhost:3000](http://localhost:3000). Enter backend deployment URL
and assistant ID in Settings, or configure defaults through environment variables.

Stop development server with `Ctrl+C`. If another process already owns port 3000,
identify it before stopping it:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
kill <PID>
```

### BMO corporate registry

In corporate environment, follow
[internal Artifactory setup guide](https://bmo.atlassian.net/wiki/spaces/ARCAAI/pages/1205864484/How+to+Install+npm+Packages+from+our+Artifactory)
before `yarn install`.

If required by that guide, configure registry and authenticate with SAML SSO:

```bash
npm config set bin-links true
npm config set registry https://bmostaging.jfrog.io/artifactory/api/npm/bmoai-npm-virtual/
npm login --auth-type=web
yarn config set npmRegistryServer https://bmostaging.jfrog.io/artifactory/api/npm/bmoai-npm-virtual/
```

Avoid disabling TLS verification unless corporate instructions explicitly require
it for managed environment. Restore normal TLS validation when no longer needed.

## Configuration

Settings dialog stores backend connection in browser. Environment variables provide
deployment defaults and server-side credentials.

| Variable                        | Purpose                                                       |
| ------------------------------- | ------------------------------------------------------------- |
| `NEXT_PUBLIC_LANGGRAPH_URL`     | Default LangGraph backend URL exposed to browser.             |
| `NEXT_PUBLIC_ASSISTANT_ID`      | Default assistant ID, commonly `research`.                    |
| `BACKEND_API_URL`               | Server-side backend override for proxy and media routes.      |
| `UPLOAD_API_KEY`                | Server-side API key forwarded to protected backend routes.    |
| `NEXT_PUBLIC_LANGSMITH_API_KEY` | Optional client-side key for local development only.          |
| `MARKDOWN_STORAGE_DIR`          | Server-side storage directory for synchronized Markdown data. |

Never expose production secrets through `NEXT_PUBLIC_*` variables. Container
deployments can start from [`.env.docker.example`](.env.docker.example); keep real
environment files and secrets out of version control.

## Authentication

### OAuth

The FastAPI backend manages Google and GitHub OAuth with Authlib. To enable OAuth:

1. Follow [backend OAuth guide](https://github.com/jerryshao2012/deep-research/blob/main/README.md#-oauth-authentication).
2. Configure provider client IDs and secrets in backend environment.
3. Set backend `FRONTEND_URL` to UI origin so callbacks return users correctly.

### Passkeys

Passkeys are disabled unless UI and backend both set `PASSKEY_ENABLED=true`.
OAuth must remain available for initial enrollment, reauthentication, and recovery.

Configure UI server:

```env
PASSKEY_ENABLED=true
PASSKEY_ORIGIN=https://your-ui.example.com
PASSKEY_PROXY_ID=web-bff
PASSKEY_PROXY_SECRET=<at-least-32-random-bytes>
```

`PASSKEY_ORIGIN` must be exact browser origin without path or trailing slash.
Configure backend with matching proxy ID and secret. Store secret in managed secret
store and never expose it through `NEXT_PUBLIC_*` variable.

See [Passkey authentication](documents/authentication/passkey-authentication.md)
for enrollment, identifier-free sign-in, trust boundaries, management flows, and
multi-domain relying-party configuration.

## Connect an agent

Use [Deep Agents quickstarts](https://github.com/langchain-ai/deepagents/tree/main/examples)
to run a compatible agent. The assistant ID is the graph key in `langgraph.json`:

```json
{
  "graphs": {
    "research": "./agent.py:agent"
  }
}
```

Start local LangGraph deployment, then copy API URL and assistant ID into UI
Settings:

```bash
cd deepagents-quickstarts/deep_research
langgraph dev
```

Typical local values:

- Deployment URL: `http://127.0.0.1:2024`
- Assistant ID: `research`

## Usage

Use chat interface to start runs and update connection settings. Debug Mode executes
run step by step and allows selected steps to be repeated; disable it for continuous
end-to-end execution.

Generated files appear while agent runs:

<img width="2039" alt="Chat interface showing an agent run" src="https://github.com/user-attachments/assets/50e1b5f3-a626-4461-9ad9-90347e471e8c" />

Browse files stored in LangGraph state:

<img width="2039" alt="Generated files in LangGraph state" src="https://github.com/user-attachments/assets/86cc6228-5414-4cf0-90f5-d206d30c005e" />

Select a supported file to open its viewer:

<img width="2039" alt="Generated file viewer" src="https://github.com/user-attachments/assets/9883677f-e365-428d-b941-992bdbfa79dd" />

## Deployment

- [`deploy.sh` - Azure App Service](documents/deployment/azure-app-service.md)
- [`deploy-aws.sh` - AWS ECS Fargate](documents/deployment/aws-ecs-fargate.md)
- [`deploy-oracle.sh` - Oracle AMD VM](documents/deployment/oracle-vm.md)
- [Vercel deployment guide](documents/deployment/vercel.md): Git-based Vercel setup.

Deployment scripts require provider-specific prerequisites and environment files.
Inspect each script and its example secret files before running it.

## Documentation

Start with [documentation index](documents/README.md) for architecture,
authentication, deployment, plans, and specifications.

Developer-specific repository instructions remain in `AGENTS.md` and `CLAUDE.md`
because tools discover those files from repository root.

## Resources

- [Deep Agents repository](https://github.com/langchain-ai/deepagents)
- [What are Deep Agents?](https://www.youtube.com/watch?v=433SmtTc0TA)
- [Implementing Deep Agents](https://www.youtube.com/watch?v=TTMYJAw5tiA&t=701s)
