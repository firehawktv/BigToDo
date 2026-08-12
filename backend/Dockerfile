# Stage 1: install dependencies and build TypeScript
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Stage 2: production runtime — only what's needed to run the built output
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# `npm run migrate` runs src/db/migrate.ts directly via tsx (see package.json),
# not the compiled dist/ output — it reads its .sql files by path relative to
# its own source file, and pulls in sibling .ts modules (pool.ts, config.ts,
# ../env.ts) via relative imports. All of that needs the real TypeScript
# source present in the image, not just the migrations/*.sql files, and tsx
# itself must be a production dependency (see package.json) so
# `npm ci --omit=dev` above doesn't strip it.
COPY src ./src
COPY scripts ./scripts

# Runs as a non-root user — the base image's built-in 'node' user, not root,
# limits the blast radius if the Node process is ever compromised.
USER node

EXPOSE 3000
CMD ["node", "dist/src/server.js"]
