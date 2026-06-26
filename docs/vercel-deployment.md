# Deploying bmo-deepagent-ui to Vercel

This guide provides step-by-step instructions for deploying the Next.js frontend UI to **Vercel** to achieve a completely free (zero-cost) frontend hosting setup.

---

## Prerequisites

1.  **GitHub Account**: The codebase must be pushed to a repository on GitHub.
2.  **Vercel Account**: Sign up at [vercel.com](https://vercel.com/) (recommend signing up with your GitHub account for easy integration).
3.  **Azure Backend Agent URL**: You need the public URL of your `deep-research-agent-0312` container app (e.g., `https://deep-research-agent-0312.canadacentral.azurecontainerapps.io`).

---

## Step 1: Push Code to GitHub

Ensure all your latest local changes are pushed to your GitHub repository:

```bash
git add .
git commit -m "Configure Docker Hub deployment and fix nested markdown links"
git push origin main
```

---

## Step 2: Import Project in Vercel

1.  Log in to the [Vercel Dashboard](https://vercel.com/dashboard).
2.  Click **Add New...** and select **Project**.
3.  Under **Import Git Repository**, find your `bmo-deepagent-ui` repository and click **Import**.

---

## Step 3: Configure Project Settings

In the **Configure Project** screen, configure the following:

1.  **Framework Preset**: Keep it as **Next.js** (Vercel automatically detects this).
2.  **Root Directory**: `./` (default).
3.  **Environment Variables**: Expand the environment variables section and add the following keys:

| Environment Variable | Value / Source | Description |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_LANGGRAPH_URL` | `https://deep-research-agent-0312.canadacentral.azurecontainerapps.io` | The URL of your Azure backend agent container app. |
| `NEXT_PUBLIC_ASSISTANT_ID` | `research` | The ID of your assistant. |
| `AUTH_SECRET` | *[Your Secret]* | A random secure string used for authentication encryption (you can copy this from your local `.env` or Key Vault). |
| `AUTH_TRUST_HOST` | `true` | Tells Auth.js to trust the Vercel hosting domain. |
| `LANGCHAIN_API_KEY` | *[YOUR_LANGCHAIN_API_KEY_HERE]* | Your Langchain API key for authentication. |

---

## Step 4: Deploy

Click the **Deploy** button. Vercel will build your Next.js application. The build takes about 1-2 minutes. 
Once successfully completed, Vercel will provide your live deployment URL (e.g., `https://bmo-deepagent-ui.vercel.app`).

---

## Step 5: Update Azure Backend Agent Redirects

Since you are using authentication (NextAuth/Auth.js), your backend agent needs to know the frontend's new URL to authorize redirect requests correctly:

1.  Copy your live Vercel URL (e.g., `https://bmo-deepagent-ui.vercel.app`).
2.  Update the environment variables on your backend agent container app (`deep-research-agent-0312`):

```bash
az containerapp update \
  --name deep-research-agent-0312 \
  --resource-group resource-group-deep-agents-0312 \
  --set-env-vars \
    AUTH_URL="https://your-vercel-domain.vercel.app" \
    NEXTAUTH_URL="https://your-vercel-domain.vercel.app"
```

---

## Benefits of Vercel Deployment

*   **100% Free**: No charges for bandwidth, builds, or server uptime under the Hobby Tier.
*   **Automatic Deployments**: Any future changes you push to your GitHub `main` branch will automatically trigger a new build and deployment on Vercel within seconds.
*   **No Docker Required**: Vercel compiles the Next.js code directly on its edge network, meaning you don't need to run Docker builds or manage Container Registries for the frontend.
