FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS builder
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN corepack enable
ARG NEXT_PUBLIC_LANGGRAPH_URL
ARG NEXT_PUBLIC_ASSISTANT_ID=research
ENV NEXT_PUBLIC_LANGGRAPH_URL=$NEXT_PUBLIC_LANGGRAPH_URL
ENV NEXT_PUBLIC_ASSISTANT_ID=$NEXT_PUBLIC_ASSISTANT_ID
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/releases ./.yarn/releases
#RUN sed -i 's|https://bmostaging.jfrog.io/artifactory/api/npm/bmoai-npm-virtual/|https://registry.npmjs.org/|g' yarn.lock
RUN yarn install --immutable && yarn cache clean --all
COPY . .
# Use webpack for the production image build path.
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV NEXT_PRIVATE_SKIP_CANARY_CHECK=1
# Disable SWC for cross-platform stability if needed, though swcMinify: false in next.config.ts is better.
# Some versions of Next.js also benefit from this:
ENV NEXT_DISABLE_SWC_MINIFY=1
RUN NEXT_TELEMETRY_DISABLED=1 yarn build && \
    rm -rf .next/cache && \
    touch /app/.builder-complete

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

# Copy package config and lock files
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/releases ./.yarn/releases
#RUN sed -i 's|https://bmostaging.jfrog.io/artifactory/api/npm/bmoai-npm-virtual/|https://registry.npmjs.org/|g' yarn.lock

# Install only production dependencies
COPY --from=builder /app/.builder-complete /tmp/.builder-complete
RUN yarn workspaces focus --all --production && \
    yarn cache clean --all && \
    rm /tmp/.builder-complete

# Copy pre-compiled production build and public files
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/server.cjs ./server.cjs
COPY --from=builder /app/runtime ./runtime

EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.cjs"]
