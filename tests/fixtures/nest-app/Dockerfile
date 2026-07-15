FROM node:22-alpine AS dependencies
WORKDIR /app

FROM dependencies AS build
WORKDIR /app

FROM node:22-alpine AS runtime
WORKDIR /app
USER node
EXPOSE 3000
HEALTHCHECK CMD wget -q -O- http://localhost:3000/health || exit 1
CMD ["node", "dist/main.js"]

