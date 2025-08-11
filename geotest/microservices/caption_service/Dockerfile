FROM python:3.11-slim

WORKDIR /app

# Install system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Python requirements from the microservices context (we expect requirements.txt at the context root)
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copy the entire microservices directory into /app so shared 'common' package is available
COPY . /app

# Keep working directory at /app so sibling packages (common, caption_service) are importable
WORKDIR /app

ENV PYTHONUNBUFFERED=1
ENV PORT=8001

EXPOSE 8001

# Run the FastAPI app by referencing the package module so imports (common) resolve correctly
CMD ["uvicorn", "caption_service.main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1"]
