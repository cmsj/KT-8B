# Pinned by digest so builds are reproducible; Dependabot bumps it when a new 26-slim image is published.
FROM node:26-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# Config is mounted at /config/config.json; state lives in /data.
ENV KT_CONFIG=/config/config.json
RUN mkdir /data && chown node:node /data
VOLUME /data
USER node

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "src/main.ts"]
