# Lotus workers (prize sender, inventory sync, crate expiry) as one always-on process.
# Build context MUST be the repo root (the folder holding server/ and workers/):
#   docker build -f deploy/workers.Dockerfile -t lotus-workers .
# workers depends on server via file:../server, so both folders go into the image.
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

# server first: workers resolves @lotus/server through a symlink to /app/server
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --include=dev

COPY workers/package.json workers/package-lock.json ./workers/
RUN cd workers && npm ci --include=dev

COPY server ./server
COPY workers ./workers

WORKDIR /app/workers
# tsx runs the TypeScript directly; no build step. Runs as a non-root user.
USER node
CMD ["npx", "tsx", "src/main.ts", "all"]
