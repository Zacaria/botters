FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY online ./online
COPY sim.js build-id.json ./
COPY sim/pkg ./sim/pkg
COPY scripts/live-server.js ./scripts/live-server.js
USER node
EXPOSE 2567
CMD ["node", "--max-old-space-size=576", "scripts/live-server.js"]
