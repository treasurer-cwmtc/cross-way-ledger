# Build the React app, then serve it with nginx and proxy /api to the backend.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
# Vite inlines VITE_* env vars at build time, not runtime - must be passed
# as a build arg (see .github/workflows/deploy.yml / docs/DEPLOYMENT.md).
# VITE_API_BASE is only a fallback for local `npm run build` without Docker -
# the real per-environment value is set at container startup via the
# API_BASE env var (see docker/40-env-config.sh) so the same built image can
# be promoted from dev to prod without a rebuild.
ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_API_BASE
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/40-env-config.sh /docker-entrypoint.d/40-env-config.sh
RUN chmod +x /docker-entrypoint.d/40-env-config.sh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
