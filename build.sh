#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REGISTRY="${REGISTRY:-registry.alenfive.top}"
IMAGE_NAME="${IMAGE_NAME:-datatalk}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
DOCKERFILE="${DOCKERFILE:-${SCRIPT_DIR}/Dockerfile}"
DOCKER_PLATFORM="${DOCKER_PLATFORM:-}"
NO_CACHE="${NO_CACHE:-0}"
REGISTRY_USERNAME="${REGISTRY_USERNAME:-}"
REGISTRY_PASSWORD="${REGISTRY_PASSWORD:-}"

REGISTRY="${REGISTRY#https://}"
REGISTRY="${REGISTRY#http://}"
REGISTRY="${REGISTRY%/}"
REGISTRY="${REGISTRY%/v2}"
REGISTRY="${REGISTRY%/}"

usage() {
  cat <<'EOF'
Usage: ./build.sh [options]

Build and push the chat-bi Docker image.

Options:
      --registry HOST   Registry host (default: registry.alenfive.top)
  -n, --name NAME       Image repository name (default: datatalk)
  -t, --tag TAG         Image tag (default: latest)
      --platform VALUE  Docker target platform, for example linux/amd64
      --no-cache         Disable Docker layer cache
  -h, --help             Show this help

Environment variables:
  REGISTRY, IMAGE_NAME, IMAGE_TAG, DOCKER_PLATFORM, NO_CACHE, DOCKERFILE
  REGISTRY_USERNAME, REGISTRY_PASSWORD

Examples:
  ./build.sh
  ./build.sh --tag latest
  ./build.sh --registry registry.example.com --name datatalk --tag 2026.08.23
  ./build.sh --platform linux/amd64
EOF
}

while (($# > 0)); do
  case "$1" in
    --registry)
      [[ $# -ge 2 ]] || { echo "Missing value for $1" >&2; exit 2; }
      REGISTRY="$2"
      REGISTRY="${REGISTRY#https://}"
      REGISTRY="${REGISTRY#http://}"
      REGISTRY="${REGISTRY%/}"
      REGISTRY="${REGISTRY%/v2}"
      REGISTRY="${REGISTRY%/}"
      shift 2
      ;;
    -n|--name)
      [[ $# -ge 2 ]] || { echo "Missing value for $1" >&2; exit 2; }
      IMAGE_NAME="$2"
      shift 2
      ;;
    -t|--tag)
      [[ $# -ge 2 ]] || { echo "Missing value for $1" >&2; exit 2; }
      IMAGE_TAG="$2"
      shift 2
      ;;
    --platform)
      [[ $# -ge 2 ]] || { echo "Missing value for $1" >&2; exit 2; }
      DOCKER_PLATFORM="$2"
      shift 2
      ;;
    --no-cache)
      NO_CACHE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

IMAGE="${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker command was not found." >&2
  exit 1
fi

if [[ ! -f "$DOCKERFILE" ]]; then
  echo "Error: Dockerfile not found: $DOCKERFILE" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Error: Docker daemon is not available. Start Docker Desktop or the Docker service first." >&2
  exit 1
fi

if [[ -n "$REGISTRY_USERNAME" || -n "$REGISTRY_PASSWORD" ]]; then
  if [[ -z "$REGISTRY_USERNAME" || -z "$REGISTRY_PASSWORD" ]]; then
    echo "Error: REGISTRY_USERNAME and REGISTRY_PASSWORD must be provided together." >&2
    exit 1
  fi

  printf '%s' "$REGISTRY_PASSWORD" | docker login "$REGISTRY" --username "$REGISTRY_USERNAME" --password-stdin
fi

docker_args=(build --file "$DOCKERFILE" --tag "$IMAGE")
if [[ -n "$DOCKER_PLATFORM" ]]; then
  docker_args+=(--platform "$DOCKER_PLATFORM")
fi
if [[ "$NO_CACHE" == "1" ]]; then
  docker_args+=(--no-cache)
fi

echo "Building Docker image: $IMAGE"
echo "Build context: $SCRIPT_DIR"

docker "${docker_args[@]}" "$SCRIPT_DIR"

echo "Pushing Docker image: $IMAGE"
docker push "$IMAGE"

image_id="$(docker image inspect --format '{{.Id}}' "$IMAGE")"
image_size="$(docker image inspect --format '{{.Size}}' "$IMAGE")"

echo "Built image: $IMAGE"
echo "Image ID: $image_id"
echo "Image size (uncompressed local layers): $((image_size / 1024 / 1024)) MiB"
echo "Pushed image: $IMAGE"
