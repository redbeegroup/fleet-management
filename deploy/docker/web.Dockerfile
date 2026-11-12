# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
# Optional: behind a TLS-intercepting corporate proxy, pass its CA bundle with
#   --secret id=extra_ca,src=/path/to/ca.crt
# Node prints a harmless warning when the secret is absent.
ENV NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca
RUN corepack enable
RUN --mount=type=secret,id=extra_ca,required=false corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN --mount=type=secret,id=extra_ca,required=false \
    --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @fms/web...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
ARG VITE_MAP_TILE_URL
ENV VITE_MAP_TILE_URL=${VITE_MAP_TILE_URL}
RUN pnpm --filter @fms/shared build && pnpm --filter @fms/web build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
# API_UPSTREAM is substituted into the template at container start.
ENV API_UPSTREAM=http://api:3000
COPY deploy/docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
