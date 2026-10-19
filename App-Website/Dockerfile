FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY scripts/ ./scripts/
RUN npm ci
COPY . .
RUN npm run build:server

FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATABASE_PATH=/data/greenbiz.sqlite
WORKDIR /app
COPY package*.json ./
COPY scripts/ ./scripts/
RUN npm ci --omit=dev && mkdir /data && chown node:node /data
COPY --from=build /app/server-dist ./server-dist
USER node
VOLUME ["/data"]
EXPOSE 8787
CMD ["node","server-dist/index.js"]
