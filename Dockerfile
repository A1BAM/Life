# build the SPA
FROM node:22-slim AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm install
COPY web/ ./
RUN npm run build

# runtime
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY server/ ./server/
COPY --from=web /app/web/dist ./web/dist
ENV NODE_ENV=production
EXPOSE 3001
VOLUME /app/data
CMD ["node", "server/index.js"]
