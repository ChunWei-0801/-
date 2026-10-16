FROM python:3.12-slim

WORKDIR /app/backend

# 先裝相依，讓這一層可以被快取
COPY backend/requirements.lock .
RUN --mount=type=secret,id=pip_ca_bundle,required=false \
    if [ -f /run/secrets/pip_ca_bundle ]; then \
      PIP_CERT=/run/secrets/pip_ca_bundle pip install --no-cache-dir -r requirements.lock; \
    else \
      pip install --no-cache-dir -r requirements.lock; \
    fi

COPY backend/ .
COPY frontend/ /app/frontend/

EXPOSE 8000
# 先把資料表升到最新版再啟動（alembic/versions/）
CMD ["sh", "-c", "alembic upgrade head && python -m app.cli init-db && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
