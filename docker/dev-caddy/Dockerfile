# Dev-only variant of the prod Caddy setup: same reverse-proxy shape
# (see ../../Caddyfile), but `tls internal` since dev has no public domain
# for Let's Encrypt to validate - self-signed, browser will warn once.
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
