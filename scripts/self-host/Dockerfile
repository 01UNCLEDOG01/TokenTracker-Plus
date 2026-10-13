# Local TokenTracker backend, packaged for a low-power always-on host - an
# iStoreOS / OpenWrt soft-router (J1900 class), a NAS, a small VPS.
#
# Build the context first, then build the image from it:
#
#   node scripts/self-host/package-image.cjs
#   cd dist/local-backend-image
#   docker build -t tokentracker-local-backend .
#   docker run -d --name tt-backend -p 17681:17681 -v tt-backend-data:/data tokentracker-local-backend
#
# The handler bundles are prebuilt by the packager, so esbuild is neither
# installed nor run here. The image is Node + PGlite only: PGlite supplies
# PostgreSQL as WASM inside the Node process, so there is no database server and
# no second container.
FROM node:20-alpine

WORKDIR /app

# PGlite is the only runtime dependency.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# manifest.cjs resolves the repo root two levels above scripts/self-host and
# reads the migration SQL from <root>/migrations, so keep the same layout here.
COPY migrations/ ./migrations/
COPY scripts/self-host/ ./scripts/self-host/
COPY prebuilt/ ./prebuilt/

# Bind 0.0.0.0 inside the container: with `-p 17681:17681` the published port
# only reaches a socket bound to all interfaces, not one bound to loopback.
ENV TOKENTRACKER_LOCAL_BACKEND_DIR=/data \
    TOKENTRACKER_LOCAL_BACKEND_BUNDLES=/app/prebuilt \
    TOKENTRACKER_LOCAL_BACKEND_PORT=17681 \
    TOKENTRACKER_LOCAL_BACKEND_BIND=0.0.0.0

# /data holds the PGlite database, the JWT secret and the adopted bundles.
# Mount a volume (or a path on the router's external storage) so an image
# upgrade does not discard the account and usage history.
VOLUME ["/data"]
EXPOSE 17681

CMD ["node", "scripts/self-host/local-backend.cjs"]
