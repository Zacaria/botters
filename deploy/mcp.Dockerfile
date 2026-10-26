FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY web-mcp.js mcp-oauth.js client.js tools.js DOCTRINE.md ./
COPY deploy/mcp-entry.js ./deploy/mcp-entry.js
ARG REVISION
LABEL org.opencontainers.image.revision=$REVISION
USER node
EXPOSE 8798
CMD ["node", "--max-old-space-size=128", "deploy/mcp-entry.js"]
