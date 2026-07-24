#!/bin/sh
# Generates env-config.js from the API_BASE env var at container startup -
# runs before nginx starts (nginx:alpine's docker-entrypoint.sh executes
# every executable script in /docker-entrypoint.d/ in name order). This is
# what lets the same built image be promoted across environments (dev/prod)
# without a rebuild: API_BASE is set per Cloud Run service, not baked in.
set -eu

cat > /usr/share/nginx/html/env-config.js <<EOF
window.__ENV__ = { API_BASE: "${API_BASE:-}" };
EOF
