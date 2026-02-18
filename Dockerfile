# Usar imagen más ligera
FROM node:22-bullseye-slim

# Instalar solo dependencias críticas
RUN apt-get update && apt-get install -y \
    chromium \
    dumb-init \
    && rm -rf /var/lib/apt/lists/*

# Crear usuario no-root para seguridad (COMANDOS DEBIAN)
RUN groupadd -g 5002 appgroup && \
    useradd -r -u 5002 -g appgroup -m appuser

# Configurar variables de entorno optimizadas
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=350" \
    CHROME_BIN=/usr/bin/chromium \
    CHROMIUM_FLAGS="--no-sandbox --disable-dev-shm-usage --disable-gpu --disable-software-rasterizer --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --single-process"

WORKDIR /app

# Cambiar propiedad al usuario no-root
RUN chown -R appuser:appgroup /app

# Copiar archivos de dependencias con permisos correctos
COPY --chown=appuser:appgroup package*.json ./

# Cambiar a usuario no-root antes de instalar
USER appuser

# Generar package-lock.json si no existe, luego instalar
RUN if [ ! -f package-lock.json ]; then npm install --package-lock-only; fi && \
    npm ci --omit=dev --no-audit --no-fund && \
    npm cache clean --force

# Copiar código fuente
COPY --chown=appuser:appgroup . .

# Crear directorio para tokens con permisos
RUN mkdir -p tokens && chmod 777 tokens

# Usar dumb-init para manejo correcto de señales
ENTRYPOINT ["dumb-init", "--"]

# Comando optimizado
CMD ["node", "--max-old-space-size=350", "src/server.js"]