# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/cf-client/package.json packages/cf-client/
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/
COPY apps/api/src/lib/dotenv.ts apps/api/src/lib/
RUN pnpm install --frozen-lockfile --filter @duel/api...
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @duel/api exec prisma generate && pnpm --filter @duel/api build
RUN pnpm --filter @duel/api deploy --prod --legacy /out && cp -r apps/api/dist /out/dist && cp -r apps/api/prisma /out/prisma && cp apps/api/prisma.config.ts /out/

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
COPY --from=build /repo/apps/api/src/generated ./src/generated
USER node
EXPOSE 4000
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/main.js"]
