# syntax=docker/dockerfile:1.7

# Build the application from the application directory so standalone tracing
# cannot pull in sibling workspaces or their runtime state.
FROM node:22-bookworm-slim AS deps

WORKDIR /app/bi-worker/chat-bi

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM deps AS builder

COPY . .
RUN --mount=type=cache,target=/root/.npm \
  --mount=type=cache,target=/root/.cache/next-swc \
  --mount=type=cache,target=/app/bi-worker/chat-bi/.next/cache \
  npm run build

FROM node:22-bookworm-slim AS runner

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git gosu procps python3 python3-requests \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

WORKDIR /app/bi-worker/chat-bi

# Next.js standalone output is rooted at the application directory.
COPY --from=builder --chown=node:node /app/bi-worker/chat-bi/.next/standalone/ ./
COPY --from=builder --chown=node:node /app/bi-worker/chat-bi/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/bi-worker/chat-bi/public ./public

# Standalone tracing can omit DuckDB's platform-specific optional package.
# Copy the Linux bindings from the Linux dependency stage explicitly.
COPY --from=deps --chown=node:node /app/bi-worker/chat-bi/node_modules/@duckdb ./node_modules/@duckdb

# These directories are read at runtime and are not part of the standalone server.
COPY --from=builder --chown=node:node /app/bi-worker/chat-bi/config/config.yaml ./config/config.yaml
COPY --from=builder --chown=node:node /app/bi-worker/chat-bi/scripts ./scripts
COPY --from=builder --chown=node:node /app/bi-worker/chat-bi/templates ./templates
COPY --from=builder --chown=node:node /app/bi-worker/chat-bi/skills ./skills
COPY --from=builder --chown=node:node /app/bi-worker/chat-bi/runtime-managed ./runtime-managed
# The integrated runtime uses the host proxy skill. Keep the legacy direct
# CLI skill out of the production image so it cannot be loaded accidentally.
RUN rm -rf ./skills/byted-web-search
COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x ./docker-entrypoint.sh

USER root

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
