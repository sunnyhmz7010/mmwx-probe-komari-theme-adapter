FROM node:22-bookworm-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY test ./test
RUN npm run build

FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 10001 adapter

WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown -R adapter:adapter /app /data

USER adapter
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "dist/src/main.js"]
