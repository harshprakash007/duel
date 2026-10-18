# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @duel/web... --ignore-scripts
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @duel/web build

# nginx serves the SPA and reverse-proxies /api and /socket.io (with WebSocket upgrade) to the API.
FROM nginx:1-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
