# syntax=docker/dockerfile:1.7
# FMS API image — one image, three process modes (MODE=api|worker|ingest) plus migrations.

ARG NODE_IMAGE=node:22-bookworm-slim
# Runtime is distroless (see below); the build stage uses the regular Node image.

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
# Optional: behind a TLS-intercepting corporate proxy, pass its CA bundle with
#   --secret id=extra_ca,src=/path/to/ca.crt
# Node prints a harmless warning when the secret is absent.
ENV NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca
# The build stage has no libssl, so tell Prisma which engines the (distroless, OpenSSL 3) runtime needs.
ENV PRISMA_CLI_BINARY_TARGETS=debian-openssl-3.0.x
RUN corepack enable
RUN --mount=type=secret,id=extra_ca,required=false corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN --mount=type=secret,id=extra_ca,required=false \
    --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @fms/api...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @fms/shared build && pnpm --filter @fms/api build
# Self-contained production node_modules for the API only.
RUN --mount=type=secret,id=extra_ca,required=false \
    --mount=type=cache,id=pnpm,target=/pnpm/store pnpm --filter @fms/api deploy --prod --legacy /out \
 && cp -r apps/api/dist apps/api/dist-seed apps/api/scripts /out/ \
 && cd /out \
 && ENGINES=$(ls -d node_modules/.pnpm/@prisma+engines@*/node_modules/@prisma/engines) \
 && node "$ENGINES/scripts/postinstall.js" \
 && node node_modules/prisma/build/index.js generate \
 && ls "$ENGINES"/schema-engine-debian-openssl-3.0.x \
 && mkdir -p /out/.data/files

# Distroless: no shell or package manager, ships libssl3 + CA certificates, runs as non-root (uid 65532).
FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime
ENV NODE_ENV=production PORT=3000 MODE=api
WORKDIR /app
COPY --from=build --chown=65532:65532 /out ./
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD ["/nodejs/bin/node", "-e", \
  "if(process.env.MODE!=='api')process.exit(0);fetch('http://127.0.0.1:'+process.env.PORT+'/api/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# The distroless entrypoint is node; migrations: CMD ["scripts/migrate.js"]
CMD ["dist/main.js"]
