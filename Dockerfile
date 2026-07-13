# ============================================
# OctupusZap - Dockerfile (Next.js standalone)
# ============================================

# Stage 1: Install ALL dependencies (including dev for build)
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# Copy prisma schema before npm install (postinstall runs prisma generate)
COPY prisma ./prisma
# npm install (not ci) because package-lock.json may be out of sync with bun.lock
# --ignore-scripts skips postinstall (prisma generate) — we run it explicitly in builder
RUN npm install --ignore-scripts

# Stage 2: Build the application
# This stage IS used by the "migrate" container in docker-compose.
FROM node:20-alpine AS builder
WORKDIR /app

# Copy all dependencies (including dev)
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client (must run before next build)
RUN npx prisma generate

# Build Next.js (standalone output)
# NOTE: prisma db push in the build script will fail here (no DB)
# and the || fallback will continue — that's expected.
RUN npm run build

# Stage 3: Production (standalone output — minimal image)
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install Docker CLI + git for self-deploy capability
# The Docker socket is mounted from the host in docker-compose.yml
RUN apk add --no-cache docker-cli docker-compose git

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone build output (includes node_modules with only production deps)
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# CRITICAL: Copy Prisma engine files that Next.js standalone misses
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma ./prisma

# Copy scripts/ for one-off admin tasks (e.g. setup-all-webhooks, seed-users)
COPY --from=builder /app/scripts ./scripts
# tsx is needed to run .ts scripts — install as global
RUN npm install -g tsx

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
