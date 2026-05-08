# --- frontend build stage ----------------------------------------------
FROM node:26-alpine AS frontend

WORKDIR /app

COPY scaffold/package.json scaffold/package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
      npm ci --no-audit --no-fund --loglevel=error; \
    else \
      npm install --no-audit --no-fund --loglevel=error; \
    fi

COPY scaffold/ ./
COPY status_tracker.jsx ./src/StatusTracker.jsx
COPY lib ./src/lib
COPY components ./src/components

RUN npm run build

# --- server deps stage -------------------------------------------------
# Debian-slim picks up better-sqlite3 prebuilt binaries reliably; alpine
# sometimes triggers a native rebuild that needs python+make+g++.
FROM node:26-slim AS server-deps

WORKDIR /srv

COPY server/package.json server/package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --no-audit --no-fund --loglevel=error; \
    else \
      npm install --omit=dev --no-audit --no-fund --loglevel=error; \
    fi

# --- prod runtime ------------------------------------------------------
FROM node:26-slim AS prod

WORKDIR /srv

# the `node` user already exists in node:slim with UID 1000
RUN mkdir -p /data \
 && chown -R node:node /data /srv

COPY --chown=node:node --from=frontend /app/dist /srv/dist
COPY --chown=node:node --from=server-deps /srv/node_modules /srv/server/node_modules
COPY --chown=node:node server/server.js /srv/server/server.js
COPY --chown=node:node server/notify.js /srv/server/notify.js
COPY --chown=node:node server/package.json /srv/server/package.json
COPY --chown=node:node server/scripts /srv/server/scripts
COPY --chown=node:node lib /srv/lib

USER node

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/tracker.db
ENV STATIC_DIR=/srv/dist

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/server.js"]
