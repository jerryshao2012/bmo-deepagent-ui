# 🚀🧠 BMO Deep Agents UI

[Deep Agents](https://github.com/langchain-ai/deepagents) is a simple, open source agent harness that implements a few generally useful tools, including planning (prior to task execution), computer access (giving the able access to a shell and a filesystem), and sub-agent delegation (isolated task execution). This is a UI for interacting with deepagents.

## 🚀 Quickstart

**Install dependencies and run the app**

```bash
git clone https://github.com/jerryshao2012/bmo-deepagent-ui.git
cd bmo-deep-agents-ui
# Install yarn
npm config set "bin-links" true
npm config set "strict-ssl" false
npm config set registry https://bmostaging.jfrog.io/artifactory/api/npm/bmoai-npm-virtual/
# Choose SAML SSO
npm login --auth-type=web
npm install -g yarn
# Add %AppData%\npm to PATH for Windows

# For corporation network
yarn config set "strict-ssl" false
# Get configuration from npm config list
yarn config set registry https://bmostaging.jfrog.io/artifactory/api/npm/bmoai-npm-virtual/

# Update yarn.lock
# Replace https://registry.npmjs.org/ with https://bmostaging.jfrog.io/artifactory/api/npm/bmoai-npm-virtual/
# Replace https://registry.yarnpkg.com/ with https://bmostaging.jfrog.io/artifactory/api/npm/bmoai-npm-virtual/
yarn install
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
```

**Setup OAuth**

OAuth authentication (Google & GitHub) is managed directly by the FastAPI backend server using Authlib. To configure client credentials and enable OAuth:
1. Refer to the [Backend OAuth Guide](../deepagents-demo/deep_research/README.md#oauth-authentication).
2. Set up the OAuth client ID and secrets in your backend `.env` file.
3. Define the `FRONTEND_URL` in the backend `.env` (defaults to `http://localhost:3000` for local development) so the backend can redirect users back to the UI after successful login.

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
- [Optional] **LangSmith API Key**: Your LangSmith API key (format: `lsv2_pt_...`). This may be required for accessing deployed LangGraph applications. You can also provide this via the `LANGCHAIN_API_KEY` environment variable.

**Note:** When deploying to production, the application uses a server-side API proxy that automatically adds the `X-API-Key` header from the `LANGCHAIN_API_KEY` environment variable. Health check endpoints (`/health`, `/ok`) bypass authentication.

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
LANGCHAIN_API_KEY="lsv2_xxxx"

# For local development - optional fallback
NEXT_PUBLIC_LANGSMITH_API_KEY="lsv2_xxxx"
```

**Authentication Architecture:**
- **Production**: All API requests (except health checks) are proxied through `/api/proxy` which adds the `X-API-Key` header from `LANGCHAIN_API_KEY`
- **Health Checks**: Endpoints `/health` and `/ok` bypass authentication
- **Local Development**: Can optionally use `NEXT_PUBLIC_LANGSMITH_API_KEY` for direct client-side authentication

**Note:** Settings configured in the UI take precedence over environment variables.

### Usage

You can run your Deep Agents in Debug Mode, which will execute the agent step by step. This will allow you to re-run the specific steps of the agent. This is intended to be used alongside the optimizer.

You can also turn off Debug Mode to run the full agent end-to-end.

### 📚 Resources

If the term "Deep Agents" is new to you, check out these videos!
[What are Deep Agents?](https://www.youtube.com/watch?v=433SmtTc0TA)
[Implementing Deep Agents](https://www.youtube.com/watch?v=TTMYJAw5tiA&t=701s)
