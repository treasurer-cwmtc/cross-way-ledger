# Build the React app, then serve it with nginx and proxy /api to the backend.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
# Vite inlines VITE_* env vars at build time, not runtime - must be passed
# as a build arg (see .github/workflows/deploy.yml / docs/DEPLOYMENT.md).
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
