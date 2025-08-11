#!/usr/bin/env bash
# Start the docker-compose stack for this repository (build + run)
# Usage:
#   chmod +x start_docker_compose.sh
#   ./start_docker_compose.sh
#
# Behavior:
# - Detects whether to use "docker compose" or "docker-compose".
# - Checks access to the Docker socket and will automatically fallback to sudo if needed.
# - Runs build + up in detached mode, then saves recent logs to docker_logs.txt.
# - Use careful non-destructive commands. You will be prompted before using sudo.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
LOG_FILE="$ROOT_DIR/docker_logs.txt"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Error: docker-compose.yml not found in $ROOT_DIR"
  exit 1
fi

# Choose docker compose command
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  DOCKER_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_CMD="docker-compose"
else
  echo "Error: neither 'docker compose' nor 'docker-compose' is available on PATH."
  exit 1
fi

echo "Using compose command: $DOCKER_CMD"

# Check socket access
DOCKER_SOCK="/var/run/docker.sock"
NEED_SUDO=0
if [ ! -e "$DOCKER_SOCK" ]; then
  echo "Warning: Docker socket ($DOCKER_SOCK) does not exist. Ensure Docker is running on this host."
fi

if [ -e "$DOCKER_SOCK" ] && [ ! -w "$DOCKER_SOCK" ]; then
  echo "Current user may not have permission to access the Docker socket ($DOCKER_SOCK)."
  echo "Attempting a no-op docker command to test access..."
  if ! $DOCKER_CMD ps >/dev/null 2>&1; then
    NEED_SUDO=1
    echo "Docker command failed without sudo. Will attempt to run with sudo."
  else
    echo "Docker command succeeded without sudo."
  fi
else
  echo "Docker socket writable or not present; attempting without sudo."
fi

# Build & start
UP_CMD="$DOCKER_CMD -f \"$COMPOSE_FILE\" up -d --build --remove-orphans"

if [ "$NEED_SUDO" -eq 1 ]; then
  echo
  read -r -p "Sudo is required to run docker-compose on this host. Run with sudo now? [y/N] " yn
  case "$yn" in
    [Yy]* ) echo "Running with sudo..."; sudo bash -c "$UP_CMD";;
    * ) echo "Aborting. Please fix Docker permissions or run this script with an account that can access Docker."; exit 1;;
  esac
else
  echo "Running: $UP_CMD"
  bash -c "$UP_CMD"
fi

# Wait a bit for containers to start
sleep 2

# Save recent logs for diagnostics
echo "Saving recent compose ps and logs to $LOG_FILE"
{
  echo "=== docker compose ps ==="
  $DOCKER_CMD ps --all
  echo
  echo "=== docker compose logs (tail 200 lines) ==="
  $DOCKER_CMD logs --no-color --tail 200 || true
} > "$LOG_FILE" 2>&1

echo "Compose started. Logs saved to $LOG_FILE"
echo "To follow logs interactively, run:"
echo "  $DOCKER_CMD logs -f"
