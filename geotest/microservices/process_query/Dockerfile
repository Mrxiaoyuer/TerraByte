FROM python:3.11-slim

WORKDIR /app

# Install system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install (uses the microservice requirements if present)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . .

ENV PYTHONUNBUFFERED=1
ENV PORT=8000

EXPOSE 8000

# Run the FastAPI app with Uvicorn
CMD ["uvicorn", "process_query.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
