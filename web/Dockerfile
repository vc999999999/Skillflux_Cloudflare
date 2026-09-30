FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY mcp/package.json ./mcp/package.json
COPY web/package.json ./web/package.json
RUN npm ci

COPY web ./web
COPY mcp/src ./mcp/src

ARG PUBLIC_REGISTRY_URL=/
ARG SITE_URL=http://localhost
ENV PUBLIC_REGISTRY_URL=${PUBLIC_REGISTRY_URL}
ENV SITE_URL=${SITE_URL}

RUN npm run build --workspace @skillflux/web

FROM nginx:stable-alpine

COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
COPY --from=build /app/web/dist/_nginx-redirects.conf /etc/nginx/skillflux-redirects.conf
COPY --from=build /app/web/dist/_nginx-pagination.conf /etc/nginx/skillflux-pagination.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
