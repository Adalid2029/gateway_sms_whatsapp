FROM node:22-alpine

# Usar una versión específica de Alpine que tenga Chromium estable
# Alpine 3.19 tenía Chromium más estable
FROM node:22-alpine3.19

# Instalar dependencias necesarias para Puppeteer/Chromium
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    nodejs \
    yarn \
    bash

# Configurar variables de entorno para Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    NODE_ENV=production

# Crear directorio de la aplicación
WORKDIR /app

# Copiar package.json y package-lock.json
COPY package*.json ./

# Instalar dependencias
RUN npm install --omit=dev

# Copiar el código fuente
COPY . .

# Crear directorio para tokens de WhatsApp
RUN mkdir -p tokens && chmod 777 tokens

# Puerto (si decidimos exponer algún servicio web en el futuro)
EXPOSE 4000

# Comando para iniciar la aplicación
CMD ["node", "src/server.js"]
