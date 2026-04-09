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
RUN mkdir -p logs inputs JE consolidated qbo Mapping

EXPOSE 8000

# Production: gunicorn with uvicorn workers (single worker = SQLite safe)
# Set WORKERS > 1 only if you migrate to PostgreSQL.
CMD ["gunicorn", "app_api:app", \
     "--workers", "1", \
     "--worker-class", "uvicorn.workers.UvicornWorker", \
     "--bind", "0.0.0.0:8000", \
     "--timeout", "120", \
     "--access-logfile", "-", \
     "--error-logfile", "-"]
