#!/usr/bin/env bash
# Start the two microservices used by the frontend (process_query and caption_service)
# Usage:
#   chmod +x geotest/start_microservices.sh
#   ./geotest/start_microservices.sh
#
# This script:
#  - cd's into geotest/microservices
#  - installs Python deps (pip) if needed
#  - launches both services with uvicorn in the background, writing logs to files
#
# Notes:
#  - Use the foreground uvicorn commands (uncomment) if you prefer to run each service
#    in its own terminal and see live logs.
#  - --reload is included for convenience during development so the services restart on code changes.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
MICRO_DIR="$ROOT_DIR/microservices"

echo "Starting microservices from: $MICRO_DIR"
cd "$MICRO_DIR"

# Install dependencies if a virtualenv isn't used (safe to skip if already installed)
if [ -f "requirements.txt" ]; then
  echo "Installing Python requirements (requirements.txt)..."
  pip install -r requirements.txt || echo "pip install failed or already satisfied — continuing"
fi

# Start process_query (port 8000)
echo "Launching process_query (uvicorn process_query.main:app -> port 8000)"
PYTHONUNBUFFERED=1 nohup uvicorn process_query.main:app --host 127.0.0.1 --port 8000 --reload > process_query.log 2>&1 &

# Start caption_service (port 8001)
echo "Launching caption_service (uvicorn caption_service.main:app -> port 8001)"
PYTHONUNBUFFERED=1 nohup uvicorn caption_service.main:app --host 127.0.0.1 --port 8001 --reload > caption_service.log 2>&1 &

echo "Microservices started in background."
echo "Logs: $MICRO_DIR/process_query.log and $MICRO_DIR/caption_service.log"
echo "To run in foreground (see logs live), open new terminals and run:"
echo "  cd $MICRO_DIR && uvicorn process_query.main:app --host 127.0.0.1 --port 8000 --reload"
echo "  cd $MICRO_DIR && uvicorn caption_service.main:app --host 127.0.0.1 --port 8001 --reload"
