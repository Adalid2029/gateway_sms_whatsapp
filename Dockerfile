# Imagen ligera - Baileys no necesita Chromium
FROM node:22-bullseye-slim

RUN apt-get update && apt-get install -y dumb-init && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 5002 appgroup && \
    useradd -r -u 5002 -g appgroup -m appuser

ENV NODE_ENV=production

WORKDIR /app

RUN chown -R appuser:appgroup /app

COPY --chown=appuser:appgroup package*.json ./

USER appuser

RUN if [ ! -f package-lock.json ]; then npm install --package-lock-only; fi && \
    npm ci --omit=dev --no-audit --no-fund && \
    npm cache clean --force

COPY --chown=appuser:appgroup . .

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
