FROM python:3.11-slim

WORKDIR /app

# System deps needed by pandas / openpyxl
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies first (layer-cached unless requirements change)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source
COPY . .

# Pre-create directories the app will write to at runtime.
# These paths are overridden by Docker volume mounts in production.
RUN mkdir -p logs inputs JE consolidated qbo Mapping sessions

EXPOSE 8000

# WORKERS defaults to 2 (set in docker-compose.yml via the WORKERS env var).
# Requires PostgreSQL (set DATABASE_URL in .env). SQLite only supports 1 worker.
# Set TOKEN_ENCRYPTION_KEY in .env — the app will refuse to start without it.
CMD ["sh", "-c", \
     "gunicorn app_api:app \
      --workers ${WORKERS:-2} \
      --worker-class uvicorn.workers.UvicornWorker \
      --bind 0.0.0.0:8000 \
      --timeout 120 \
      --access-logfile - \
      --error-logfile -"]
