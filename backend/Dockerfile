# ==============================================================================
# Multi-Stage Production Dockerfile for ApexTrade Core Backend
# Stage 1: Build Dependencies (Node 22 LTS with build tools for native addons)
# Stage 2: Minimalist Lightweight Production Image
# ==============================================================================

FROM node:22-alpine AS builder
WORKDIR /app

# Install native compilation dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

# ------------------------------------------------------------------------------
# Production Runtime Stage
# ------------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

# Ensure C++ runtime libraries and wget for healthchecks are present
RUN apk add --no-cache libstdc++ wget

# Security: Run as non-root user
RUN addgroup -S apextrade && adduser -S apexuser -G apextrade

ENV NODE_ENV=production
ENV PORT=10000

COPY --from=builder /app/node_modules ./node_modules
COPY . .

RUN mkdir -p /app/data && chown -R apexuser:apextrade /app

USER apexuser

EXPOSE 10000

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:${PORT:-10000}/api/v1/health || exit 1

CMD ["node", "src/server.js"]

