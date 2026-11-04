# syntax=docker/dockerfile:1

FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma:generate
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Claude Code CLI for the voice ordering assistant (VOICE_AI_ENGINE=claude-cli).
# Auth comes from CLAUDE_CODE_OAUTH_TOKEN at runtime (`claude setup-token`); never baked into the image.
# Build with --build-arg INSTALL_CLAUDE_CLI=false to skip it (voice then uses the built-in rules bot).
ARG INSTALL_CLAUDE_CLI=true
ARG CLAUDE_CLI_VERSION=2.1.318
ENV DISABLE_AUTOUPDATER=1
RUN if [ "$INSTALL_CLAUDE_CLI" = "true" ]; then \
      npm install -g --allow-scripts=@anthropic-ai/claude-code "@anthropic-ai/claude-code@${CLAUDE_CLI_VERSION}" \
      && npm cache clean --force \
      && claude --version; \
    fi
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/fonts ./fonts
COPY package.json ./
RUN mkdir -p uploads
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 4100
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
