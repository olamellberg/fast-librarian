#!/bin/sh
# Run as PUID:PGID (linuxserver.io convention) so files in /config and the CWA ingest
# folder get the same owner as the rest of the media stack.
set -e
umask "${UMASK:-002}"
mkdir -p "$FL_CONFIG_DIR"

if [ "$(id -u)" = "0" ]; then
    chown -R "${PUID}:${PGID}" "$FL_CONFIG_DIR"
    exec setpriv --reuid="${PUID}" --regid="${PGID}" --clear-groups \
        /app/.venv/bin/python -m fastlibrarian.main
fi
exec /app/.venv/bin/python -m fastlibrarian.main
