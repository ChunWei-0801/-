# syntax=docker/dockerfile:1
# Official PostgreSQL 18.6, Debian bookworm, multi-architecture. The Windows launcher
# runs this locally; it never publishes the isolated restore database's port.
FROM postgres:18-bookworm@sha256:bbf83594798e144bff365a9c191c5d779f181fb3135902064ab8ff11918020fc

# Optional session CA is used only while building in a managed environment.
# A normal Windows build needs no extra secret or proxy configuration.
RUN --mount=type=secret,id=proxy_ca,required=false \
    if [ -s /run/secrets/proxy_ca ]; then \
      export SSL_CERT_FILE=/run/secrets/proxy_ca; \
      export REQUESTS_CA_BUNDLE=/run/secrets/proxy_ca; \
    fi; \
    # PostgreSQL binaries are already in the pinned base image. Only Debian's
    # signed Python/CA packages are needed; do not contact the extra PG feed.
    rm -f /etc/apt/sources.list.d/pgdg.list /etc/apt/sources.list.d/pgdg.sources && \
    apt-get update && \
    apt-get install --no-install-recommends -y python3 python3-psycopg openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backup_restore.py windows_backup.py /app/
RUN chmod 0555 /app/*.py && python3 -c "import psycopg" && \
    pg_dump --version && pg_restore --version
ENTRYPOINT []
CMD ["sleep", "infinity"]
