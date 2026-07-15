#!/bin/sh
set -e

echo "window.__ENV__ = { VITE_TENANT_SLUG: \"${TENANT_SLUG:-}\" };" > /usr/share/nginx/html/env-config.js
