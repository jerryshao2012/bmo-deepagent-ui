# 🚀🧠 BMO Deep Agents UI

[Deep Agents](https://github.com/langchain-ai/deepagents) is a simple, open source agent harness that implements a few generally useful tools, including planning (prior to task execution), computer access (giving the able access to a shell and a filesystem), and sub-agent delegation (isolated task execution). This is a UI for interacting with deepagents.

## 🚀 Quickstart

**Install dependencies and run the app**

```bash
git clone https://github.com/langchain-ai/deep-agents-ui.git
cd deep-agents-ui
yarn install
yarn dev
```

**Setup OAuth**

1. Set up GitHub OAuth
    1. Go to your [GitHub Developer Settings](https://github.com/settings/developers).
    2. Click on **OAuth Apps** in the left sidebar, then click **New OAuth App**.
    3. Fill in the application details:
        * **Application name**: BMO Deep Agent Local (or any name you prefer)
        * **Homepage URL**: http://localhost:3000
        * **Authorization callback URL**: http://localhost:3000/api/auth/callback/github
    4. Click **Register application**.
    5. On the next page, you will see your **Client ID**. Copy this.
    6. Click **Generate a new client secret** and copy the generated secret.
    7. Do same for .env.docker:
        * **Application name**: BMO Deep Agent (or any name you prefer)
        * **Homepage URL**: https://<your-app-fqdn>
          * Such as https://deepagent-ui.calmsmoke-0bc2dc70.canadacentral.azurecontainerapps.io
        * **Authorization callback URL**: https://<your-app-fqdn>/api/auth/callback/github
          * Such as https://deepagent-ui.calmsmoke-0bc2dc70.canadacentral.azurecontainerapps.io/api/auth/callback/github
2. Set up Google OAuth
    1. Go to [Google Cloud Console](https://console.cloud.google.com/home/dashboard).
    2. Click the project dropdown at the top and click **New Project** (or use an existing one). Give it a name and create it.
    3. Once the project is created, select it. Go to **APIs & Services > OAuth consent screen** from the left sidebar.
    4. Select **External** (or **Internal** if you have a Google Workspace) and click **Create**.
    5. Fill out the required fields (**App name**, **User support email**, **Developer contact information**) and click **Save and Continue** through the rest of the steps.
    6. Now go to **APIs & Services > Credentials**.
    7. Click **+ Create Credentials** at the top and select **OAuth client ID**.
    8. Set the **Application type** to **Web application**.
    9. Add a name (e.g., BMO Deep Agent).
    10. Under **Authorized redirect URIs**, click **+ Add URI** and enter: http://localhost:3000/api/auth/callback/google
        * Also add this URL: https://<your-app-fqdn>/api/auth/callback/google
          * Such as https://deepagent-ui.calmsmoke-0bc2dc70.canadacentral.azurecontainerapps.io/api/auth/callback/google
    11. Click **Create**.
    12. A modal will pop up with your **Client ID** and **Client Secret**. Copy both of these.
3. Update the .env file
Open the .env file in the root of your project and add the following keys with the values you copied from GitHub and Google. You also need to add an AUTH_SECRET (a random string used to encrypt cookies).

```env
# LangSmith API Key (required for connecting to deployed LangGraph server)
# Get your key at: https://smith.langchain.com/settings
# This key is used by the API proxy to authenticate requests to LangGraph
LANGCHAIN_API_KEY="lsv2_pt_xxxx"

# LangGraph Server URL (Server-side - required for API proxy)
LANGGRAPH_URL="https://your-langgraph-server-url"

# LangGraph Server URL (Client-side - exposed to browser)
NEXT_PUBLIC_LANGGRAPH_URL="https://your-langgraph-server-url"

# Assistant ID
NEXT_PUBLIC_ASSISTANT_ID="research"

# A random secret used by NextAuth to encrypt the session
AUTH_SECRET="generate-a-random-secret-string-here"
# GitHub OAuth
AUTH_GITHUB_ID="your_github_client_id_here"
AUTH_GITHUB_SECRET="your_github_client_secret_here"
# Google OAuth
AUTH_GOOGLE_ID="your_google_client_id_here"
AUTH_GOOGLE_SECRET="your_google_client_secret_here"
```
> Tip: You can generate a good random string for `AUTH_SECRET` by running `openssl rand -base64 32` in your terminal.

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
