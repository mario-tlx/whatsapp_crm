FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV DATA_ROOT=/data

RUN mkdir -p /data

WORKDIR /app

ARG RAILWAY_GIT_COMMIT_SHA=
ENV DEPLOY_GIT_SHA=${RAILWAY_GIT_COMMIT_SHA}

COPY package.json package-lock.json* ./
RUN npm ci 2>/dev/null || npm install

COPY . .

EXPOSE 3000

CMD ["node", "src/index.js"]
