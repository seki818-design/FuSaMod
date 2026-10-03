# FuSaMod: Web UI + サーバー(+ 公式 SysML 実装用の Java 21)。
# ビルド: docker build -t fusamod .   起動: docker run -p 8787:8787 -e HOST=0.0.0.0 -e FUSAMOD_TOKENS=... -v fusamod-data:/data fusamod
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @fusamod/web build && pnpm --filter @fusamod/server build \
    && pnpm --filter @fusamod/server --prod deploy --legacy /deploy

FROM eclipse-temurin:21-jdk-jammy
# Node 22(公式 SysML 実装の取得・コンパイルに必要な unzip / python3 / curl も入れる)
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
RUN apt-get update && apt-get install -y --no-install-recommends unzip python3 python3-pip zstd curl ca-certificates npm \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 FUSAMOD_PROJECTS=/data FUSAMOD_WEB_DIST=/app/apps/web/dist FUSAMOD_SYSML_CACHE=/data/.sysml-cache
COPY --from=build /app/apps/server/dist/server.mjs ./apps/server/dist/server.mjs
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/tools/sysml-check ./tools/sysml-check
COPY --from=build /app/libs ./libs
COPY --from=build /deploy/node_modules ./apps/server/node_modules
COPY pnpm-workspace.yaml ./
RUN mkdir -p /data && chown -R 1000:1000 /data /app
USER 1000
VOLUME /data
EXPOSE 8787
# 認証なしで外部公開しない: HOST=0.0.0.0 のときは FUSAMOD_TOKENS を必ず設定する(docs/operations.md)
HEALTHCHECK --interval=30s --timeout=3s CMD curl -fs http://127.0.0.1:8787/api/health || exit 1
CMD ["node", "apps/server/dist/server.mjs"]
