# syntax=docker/dockerfile:1
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
COPY src ./src

# 以非 root 运行
USER node

EXPOSE 8000

HEALTHCHECK --interval=60s --timeout=5s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:${PORT:-8000}/ping || exit 1

CMD ["node", "src/server.js"]
