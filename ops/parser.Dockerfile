# Build on the isolated ingestion host and deploy by immutable image digest.
# Only package metadata and parser code enter this image; no corpus or secrets.
FROM node:26-bookworm-slim
WORKDIR /opt/parser
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src/lib/ingestion/parser-worker.mjs ./parser-worker.mjs
USER 10001:10001
ENTRYPOINT ["node", "/opt/parser/parser-worker.mjs"]
