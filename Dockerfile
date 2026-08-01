# ── TaxPro Monolith Dockerfile (Railway/Render deploy) ──
# Multi-stage: 1) build all workspaces, 2) production runtime

FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/tax-engine/package.json packages/tax-engine/package.json
COPY tsconfig.base.json ./

RUN npm ci --include=dev

COPY apps/api apps/api
COPY apps/web apps/web
COPY packages/tax-engine packages/tax-engine

RUN npm run build -w packages/tax-engine
RUN npm run build -w apps/api
RUN npm run build -w apps/web

FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY packages/tax-engine/package.json packages/tax-engine/package.json

RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/apps/api/dist /app/apps/api/dist
COPY --from=builder /app/packages/tax-engine/dist /app/packages/tax-engine/dist
COPY --from=builder /app/packages/tax-engine/package.json /app/packages/tax-engine/package.json
COPY --from=builder /app/apps/web/dist /app/apps/web/dist

COPY apps/api/src/db/migrations apps/api/src/db/migrations

RUN addgroup -S taxpro && adduser -S taxpro -G taxpro && chown -R taxpro:taxpro /app
USER taxpro

EXPOSE 3001

CMD ["sh", "-c", "\
  if [ \"$RUN_MIGRATIONS\" != \"false\" ]; then \
    echo 'Running migrations...' && \
    node apps/api/dist/db/migrate.js; \
  fi; \
  if [ \"$RUN_SEED\" = \"true\" ]; then \
    echo 'Running seed...' && \
    node apps/api/dist/db/seed.js; \
  fi; \
  if [ \"$RUN_WORKERS\" = \"true\" ]; then \
    echo 'Starting workers...' && \
    node apps/api/dist/worker-entry.js; \
  else \
    echo 'Starting API...' && \
    node apps/api/dist/index.js; \
  fi; \
"]
