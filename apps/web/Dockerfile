# ── Production Dockerfile for TaxPro Web ──
# Multi-stage build: 1) build static assets, 2) serve via nginx

# ── Stage 1: Build ──
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/tax-engine/package.json packages/tax-engine/package.json
RUN npm ci --include=dev

# Copy source
COPY tsconfig.base.json ./
COPY apps/web apps/web
COPY packages/tax-engine packages/tax-engine

# Build tax-engine (needed for references), then web
RUN npm run build -w packages/tax-engine
RUN npm run build -w apps/web

# ── Stage 2: nginx ──
FROM nginx:1.27-alpine

# Copy built static assets
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Copy custom nginx config
COPY infrastructure/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
