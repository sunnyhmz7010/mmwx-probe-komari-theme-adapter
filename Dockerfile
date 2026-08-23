FROM node:22-bookworm-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY static-assets ./static-assets
COPY test ./test
RUN npm run build

FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl unzip \
  && rm -rf /var/lib/apt/lists/* \
  && export BUN_INSTALL=/usr/local/bun \
  && curl -fsSL https://bun.com/install | bash -s "bun-v1.3.14" \
  && useradd --create-home --uid 10001 adapter \
  && mkdir -p /data \
  && chown adapter:adapter /data

ENV BUN_INSTALL=/usr/local/bun
ENV PATH=/usr/local/bun/bin:$PATH

WORKDIR /app
COPY --chown=adapter:adapter --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=adapter:adapter --from=build /app/dist ./dist
COPY --chown=adapter:adapter --from=build /app/static-assets ./static-assets

USER adapter
EXPOSE 8080
CMD ["node", "dist/src/main.js"]
