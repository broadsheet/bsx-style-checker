# Build stage: compile the Vite client and bundle the Express server
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage: run the bundled server with production dependencies only
FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY firebase-applet-config.json ./

RUN chown -R node:node /app
USER node

EXPOSE 3000

CMD ["node", "dist/server.cjs"]
