FROM node:20-bookworm-slim AS builder
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY package.json yarn.lock* ./
RUN sed -i 's|https://bmostaging.jfrog.io/artifactory/api/npm/bmoai-npm-virtual/|https://registry.npmjs.org/|g' yarn.lock
RUN (yarn install --frozen-lockfile || yarn install)
COPY . .
# Use webpack for the production image build path.
RUN NEXT_TELEMETRY_DISABLED=1 yarn build --webpack

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
