# syntax=docker/dockerfile:1
FROM oven/bun:1.3.14-slim

WORKDIR /app

# Dependencies first so the layer stays cached while only source changes.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

# Run as uid 1000 so the bind-mounted ./data stays owned by the host user.
USER bun

EXPOSE 47865

CMD ["bun", "src/index.ts"]
