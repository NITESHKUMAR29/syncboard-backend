# syntax=docker/dockerfile:1

# ---- build ----------------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src

# Generates the Prisma client into src/generated, then compiles everything to dist/.
RUN npx prisma generate && npx tsc -p tsconfig.build.json

# ---- production dependencies ---------------------------------------------
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime --------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json prisma.config.ts ./
COPY prisma ./prisma

USER node
EXPOSE 8080

# Migrations run before the server starts (Part B §8). A deployed container talks to a
# real PostgreSQL server, so the Prisma CLI applies them; the embedded PGlite driver is a
# development convenience and migrates itself through `npm run db:migrate`.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
