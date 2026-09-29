FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY mcp/package.json mcp/package.json
COPY web/package.json web/package.json
RUN npm ci --workspace @skillflux/mcp --include-workspace-root=false
COPY mcp mcp
RUN npm run build --workspace @skillflux/mcp

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY mcp/package.json mcp/package.json
COPY web/package.json web/package.json
RUN npm ci --omit=dev --workspace @skillflux/mcp --include-workspace-root=false && npm cache clean --force
COPY --from=build /app/mcp/dist mcp/dist
COPY mcp/catalog mcp/catalog
COPY mcp/skills mcp/skills
RUN mkdir -p /data && chown node:node /data
USER node
ENV SKILLFLUX_DATA_DIR=/data SKILLFLUX_HOST=0.0.0.0 SKILLFLUX_PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "mcp/dist/cli.js", "registry"]
