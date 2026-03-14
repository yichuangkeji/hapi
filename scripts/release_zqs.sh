#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="${REMOTE:-zqs}"
DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"
SKIP_BUILD="${SKIP_BUILD:-0}"
PUSH_BRANCH="${PUSH_BRANCH:-1}"

log() {
    printf '[release-zqs] %s\n' "$*"
}

die() {
    printf '[release-zqs] ERROR: %s\n' "$*" >&2
    exit 1
}

usage() {
    cat <<'EOF'
Usage:
  ./scripts/release_zqs.sh <version-or-tag>

Examples:
  ./scripts/release_zqs.sh 0.16.2-zqs.1
  ./scripts/release_zqs.sh v0.16.2-zqs.1

Environment variables:
  REMOTE=zqs            Git remote name (default: zqs)
  DEFAULT_BRANCH=main   Branch to push before tag (default: main)
  SKIP_BUILD=1          Skip local build step
  PUSH_BRANCH=0         Skip pushing branch, push tag only
EOF
}

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        die "Missing command: $1"
    fi
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
fi

VERSION_OR_TAG="${1:-}"
if [[ -z "${VERSION_OR_TAG}" ]]; then
    usage
    exit 1
fi

if [[ "${VERSION_OR_TAG}" == v* ]]; then
    TAG="${VERSION_OR_TAG}"
else
    TAG="v${VERSION_OR_TAG}"
fi

require_cmd git
require_cmd bun

cd "${ROOT_DIR}"

git remote get-url "${REMOTE}" >/dev/null 2>&1 || die "Git remote '${REMOTE}' not found"

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "${CURRENT_BRANCH}" != "${DEFAULT_BRANCH}" ]]; then
    die "Current branch is '${CURRENT_BRANCH}', expected '${DEFAULT_BRANCH}'"
fi

if [[ -n "$(git status --porcelain)" ]]; then
    die "Working tree is not clean. Commit or stash changes first."
fi

if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
    die "Local tag already exists: ${TAG}"
fi

if git ls-remote --tags "${REMOTE}" "refs/tags/${TAG}" | grep -q .; then
    die "Remote tag already exists on ${REMOTE}: ${TAG}"
fi

if [[ "${SKIP_BUILD}" != "1" ]]; then
    log "build release artifacts"
    bun run build:single-exe:all
else
    log "skip build (SKIP_BUILD=1)"
fi

if [[ "${PUSH_BRANCH}" == "1" ]]; then
    log "push ${DEFAULT_BRANCH} -> ${REMOTE}/${DEFAULT_BRANCH}"
    git push "${REMOTE}" "${DEFAULT_BRANCH}"
else
    log "skip branch push (PUSH_BRANCH=0)"
fi

log "create local tag ${TAG}"
git tag "${TAG}"

log "push tag ${TAG} -> ${REMOTE}"
git push "${REMOTE}" "${TAG}"

log "done"
log "release workflow: https://github.com/yichuangkeji/hapi/actions/workflows/release.yml"
log "release page: https://github.com/yichuangkeji/hapi/releases/tag/${TAG}"
