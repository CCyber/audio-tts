# ── Stage 1: Build ──────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source and build backend
COPY tsconfig.json tsconfig.frontend.json ./
COPY src/ ./src/

RUN npm run build

# Compile frontend TypeScript to JavaScript
RUN npx tsc --project tsconfig.frontend.json

# ── Stage 2: Production ────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Install production dependencies only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled backend
COPY --from=builder /app/dist ./dist

# Copy static frontend assets
COPY src/public/index.html ./dist/public/
COPY src/public/style.css ./dist/public/

# Copy compiled frontend JS
COPY --from=builder /app/dist/public/app.js ./dist/public/

# Create tmp directory for generated audio files
RUN mkdir -p /app/tmp && chown -R appuser:appgroup /app/tmp

USER appuser

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "dist/server.js"]
