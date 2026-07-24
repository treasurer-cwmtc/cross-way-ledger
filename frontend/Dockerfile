# Build the React app, then serve it with nginx and proxy /api to the backend.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
# Vite inlines VITE_* env vars at build time, not runtime - must be passed
# as a build arg (see .github/workflows/deploy.yml / docs/DEPLOYMENT.md).
# VITE_API_BASE is only needed when the frontend can't rely on nginx's /api
# proxy_pass (e.g. Cloud Run, where backend/frontend are separate services
# with no shared Docker network) - empty/unset keeps the existing
# same-origin-proxy behavior for Portainer.
ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_API_BASE
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
