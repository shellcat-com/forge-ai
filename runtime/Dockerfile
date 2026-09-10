FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e
LABEL forge.stack="next-postgres-v1"
ENV NEXT_TELEMETRY_DISABLED=1 NPM_CONFIG_CACHE=/opt/npm-cache
WORKDIR /opt/template
COPY templates/next-app/package*.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund && chmod -R a+rX /opt/npm-cache
COPY templates/next-app/ ./
COPY runtime/*.mjs /opt/forge/
WORKDIR /workspace
USER node
CMD ["node", "/opt/forge/run.mjs"]
