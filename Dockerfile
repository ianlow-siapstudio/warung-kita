FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
# PORT is a default — Railway (and most hosts) inject their own. The database lives on a mounted volume
# at /data: a Railway volume mounted there, or `./data:/data` in docker-compose (Railway rejects the Docker instruction for it).
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 DATABASE_PATH=/data/warung-kita.db
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# better-sqlite3's native binding isn't always traced into standalone — copy it explicitly.
COPY --from=deps /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
EXPOSE 3000
CMD ["node", "server.js"]
