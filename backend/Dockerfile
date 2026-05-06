FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install torch==2.5.1+cpu \
    --index-url https://download.pytorch.org/whl/cpu

COPY . .

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=30s --start-period=120s --retries=5 \
  CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--timeout-keep-alive", "75", "--workers", "1"]
