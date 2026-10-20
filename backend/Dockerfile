# ==============================================================================
# Multi-Stage Production Dockerfile for ApexTrade Core Backend (#7 Docker)
# Stage 1: Build & Prune Dependencies
# Stage 2: Minimalist Lightweight Production Image
# ==============================================================================

FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# ------------------------------------------------------------------------------
# Production Runtime Stage
# ------------------------------------------------------------------------------
FROM node:24-alpine AS runner
WORKDIR /app

# Security: Run as non-root user (#68 IAM, #72 Security)
RUN addgroup -S apextrade && adduser -S apexuser -G apextrade

ENV NODE_ENV=production
ENV PORT=4000
ENV WS_PORT=4001

COPY --from=builder /app/node_modules ./node_modules
COPY . .

RUN mkdir -p /app/data && chown -R apexuser:apextrade /app

USER apexuser

EXPOSE 4000 4001

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:4000/api/v1/health || exit 1

CMD ["node", "src/server.js"]
