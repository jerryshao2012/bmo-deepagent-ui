# 🚀🧠 BMO Deep Agents UI

[Deep Agents](https://github.com/langchain-ai/deepagents) is a simple, open source agent harness that implements a few generally useful tools, including planning (prior to task execution), computer access (giving the able access to a shell and a filesystem), and sub-agent delegation (isolated task execution). This is a UI for interacting with deepagents.

## 🚀 Quickstart

**Install dependencies and run the app**

```bash
git clone https://github.com/jerryshao2012/bmo-deepagent-ui.git
cd bmo-deep-agents-ui
# Configure npm authentication for corporation network
npm config set "bin-links" true
npm config set "strict-ssl" false
npm config set registry https://bmostaging.jfrog.io/artifactory/api/npm/bmoai-npm-virtual/
# Choose SAML SSO
npm login --auth-type=web
# Add %AppData%\npm to PATH for Windows

# Enable package-manager shim included with Node.js 22
corepack enable

# For corporation network
yarn config set enableStrictSsl false
yarn config set npmRegistryServer https://bmostaging.jfrog.io/artifactory/api/npm/bmoai-npm-virtual/

yarn install --immutable
yarn dev
```

Please follow instructions in this page in corporate environment before `yarn install`:
https://bmo.atlassian.net/wiki/spaces/ARCAAI/pages/1205864484/How+to+Install+npm+Packages+from+our+Artifactory

```bash
npm login --auth-type=web
```

**Stop the server**

To stop the server running on port 3000, use one of the following commands:

```bash
# Find and kill the process using port 3000
lsof -ti:3000 | xargs kill -9

# Or use fuser to kill the process
fuser -k 3000/tcp

# Or kill all node processes
killall -9 node
```

**Setup OAuth**

OAuth authentication (Google & GitHub) is managed directly by the FastAPI backend server using Authlib. To configure client credentials and enable OAuth:

1. Refer to the [Backend OAuth Guide](https://github.com/jerryshao2012/deep-research/blob/main/README.md#-oauth-authentication).
2. Set up the OAuth client ID and secrets in your backend `.env` file.
3. Define the `FRONTEND_URL` in the backend `.env` (defaults to `http://localhost:3000` for local development) so the backend can redirect users back to the UI after successful login.

**Enable Passkeys (Optional)**

Passkeys remain disabled unless both UI and backend set `PASSKEY_ENABLED=true`.
OAuth recovery must stay configured: users enroll after Google or GitHub sign-in,
and the same provider is used for reauthentication and account recovery.

Configure the UI server with:

```env
PASSKEY_ENABLED=true
PASSKEY_ORIGIN=https://your-ui.example.com
PASSKEY_PROXY_ID=web-bff
PASSKEY_PROXY_SECRET=<at-least-32-random-bytes>
```

`PASSKEY_ORIGIN` must be the exact browser origin, with no path or trailing
slash. Configure the backend with the same `PASSKEY_PROXY_ID` and
`PASSKEY_PROXY_SECRET`; store the shared secret in Azure Key Vault. Never expose
it through a `NEXT_PUBLIC_*` variable. See backend passkey deployment section
for relying-party, OAuth, and durable SQLite settings.

See [Passkey Authentication](docs/passkey-authentication.md) for enrollment,
identifier-free sign-in, management/reauthentication sequence diagrams, trust
boundaries, and multi-domain RP behavior.

**Deploy a Deep Agent**

As an example, see our [Deep Agents quickstarts](https://github.com/langchain-ai/deepagents/tree/main/examples) for examples and run the `deep_research` example.

The `langgraph.json` file has the assistant ID as the key:

```
  "graphs": {
    "research": "./agent.py:agent"
  },
```

Kick off the local LangGraph deployment:

```bash
cd deepagents-quickstarts/deep_research
langgraph dev
```

You will see the local LangGraph deployment log to terminal:

```
╦  ┌─┐┌┐┌┌─┐╔═╗┬─┐┌─┐┌─┐┬ ┬
║  ├─┤││││ ┬║ ╦├┬┘├─┤├─┘├─┤
╩═╝┴ ┴┘└┘└─┘╚═╝┴└─┴ ┴┴  ┴ ┴

- 🚀 API: http://127.0.0.1:2024
- 🎨 Studio UI: https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024
- 📚 API Docs: http://127.0.0.1:2024/docs
...
```

You can get the Deployment URL and Assistant ID from the terminal output and `langgraph.json` file, respectively:

- Deployment URL: <http://127.0.1:2024>
- Assistant ID: `research`

**Open Deep Agents UI** at [http://localhost:3000](http://localhost:3000) and input the Deployment URL and Assistant ID:

- **Deployment URL**: The URL for the LangGraph deployment you are connecting to
- **Assistant ID**: The ID of the assistant or agent you want to use

**Note:** When deploying to production, the application uses a server-side API proxy that automatically adds the `X-API-Key` header from the `UPLOAD_API_KEY` environment variable. Health check endpoints (`/health`, `/ok`) bypass authentication.

**Usage**

You can interact with the deployment via the chat interface and can edit settings at any time by clicking on the Settings button in the header.

<img width="2039" alt="Screenshot 2025-11-17 at 1 11 27 PM" src="https://github.com/user-attachments/assets/50e1b5f3-a626-4461-9ad9-90347e471e8c" />

As the deepagent runs, you can see its files in LangGraph state.

<img width="2039" alt="Screenshot 2025-11-17 at 1 11 36 PM" src="https://github.com/user-attachments/assets/86cc6228-5414-4cf0-90f5-d206d30c005e" />

You can click on any file to view it.

<img width="2039" alt="Screenshot 2025-11-17 at 1 11 40 PM" src="https://github.com/user-attachments/assets/9883677f-e365-428d-b941-992bdbfa79dd" />

### Optional: Environment Variables

You can optionally set environment variables instead of using the settings dialog:

```env
# For production deployments - used by server-side API proxy
UPLOAD_API_KEY="your_api_key_here"
LANGCHAIN_API_KEY="lsv2_xxxx"

# For local development - optional fallback
NEXT_PUBLIC_LANGSMITH_API_KEY="lsv2_xxxx"
```

**Authentication Architecture:**

- **Production**: All API requests (except health checks) are proxied through `/api/proxy` which adds the `X-API-Key` header from `UPLOAD_API_KEY`
- **Health Checks**: Endpoints `/health` and `/ok` bypass authentication
- **Local Development**: Can optionally use `NEXT_PUBLIC_LANGSMITH_API_KEY` for direct client-side authentication

**Note:** LangSmith API keys are read from environment variables only.

### Usage

You can run your Deep Agents in Debug Mode, which will execute the agent step by step. This will allow you to re-run the specific steps of the agent. This is intended to be used alongside the optimizer.

You can also turn off Debug Mode to run the full agent end-to-end.

### 📚 Resources

If the term "Deep Agents" is new to you, check out these videos!
[What are Deep Agents?](https://www.youtube.com/watch?v=433SmtTc0TA)
[Implementing Deep Agents](https://www.youtube.com/watch?v=TTMYJAw5tiA&t=701s)

### Azure Deployment

**One-time Setup**

Before your first deployment, you need to register the `Microsoft.ContainerRegistry` provider for your Azure subscription. This is a one-time operation.

```bash
az provider register --namespace Microsoft.ContainerRegistry
```

You can monitor the registration progress with the following command. Wait for it to show "Registered".

```bash
az provider show --namespace Microsoft.ContainerRegistry --query "registrationState"
```
