#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKIP_BUILD="${SKIP_BUILD:-0}"
RUN_INSTALL="${RUN_INSTALL:-0}"
CURRENT_HAPI="$(command -v hapi 2>/dev/null || true)"
DEFAULT_INSTALL_PATH="${CURRENT_HAPI:-${HOME}/.local/bin/hapi}"
INSTALL_PATH="${INSTALL_PATH:-${DEFAULT_INSTALL_PATH}}"

log() {
    printf '[override-local-hapi] %s\n' "$*"
}

die() {
    printf '[override-local-hapi] ERROR: %s\n' "$*" >&2
    exit 1
}

usage() {
    cat <<'EOF'
Usage:
  ./scripts/override_local_hapi.sh

Environment variables:
  INSTALL_PATH=/path/to/hapi  Override install target
  SKIP_BUILD=1                Skip build and reuse existing binary
  RUN_INSTALL=1               Run bun install before build

Behavior:
  1. Build local all-in-one hapi binary for current host
  2. Backup existing hapi to <install-path>.bak.<timestamp>
  3. Install the new binary to INSTALL_PATH
EOF
}

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        die "Missing command: $1"
    fi
}

resolve_build_target() {
    local os arch
    os="$(uname -s)"
    arch="$(uname -m)"

    case "${os}" in
        Darwin) os='darwin' ;;
        Linux) os='linux' ;;
        *)
            die "Unsupported OS: ${os}"
            ;;
    esac

    case "${arch}" in
        x86_64|amd64) arch='x64' ;;
        arm64|aarch64) arch='arm64' ;;
        *)
            die "Unsupported architecture: ${arch}"
            ;;
    esac

    if [[ "${os}" == "linux" && "${arch}" == "x64" ]]; then
        printf 'bun-linux-x64-baseline'
        return 0
    fi

    printf 'bun-%s-%s' "${os}" "${arch}"
}

build_binary() {
    if [[ "${RUN_INSTALL}" == "1" ]]; then
        log "bun install"
        (cd "${ROOT_DIR}" && bun install)
    fi

    log "build local single executable"
    (cd "${ROOT_DIR}" && bun run build:single-exe)
}

backup_existing_binary() {
    local install_path="$1"
    local backup_path="$2"

    if [[ -e "${install_path}" || -L "${install_path}" ]]; then
        log "backup existing binary -> ${backup_path}"
        cp -a "${install_path}" "${backup_path}"
        rm -f "${install_path}"
    fi
}

verify_install() {
    local install_path="$1"
    local installed_sha built_sha
    built_sha="$(shasum -a 256 "${BUILT_BINARY}" | awk '{print $1}')"
    installed_sha="$(shasum -a 256 "${install_path}" | awk '{print $1}')"

    if [[ "${built_sha}" != "${installed_sha}" ]]; then
        die "sha256 mismatch: built=${built_sha} installed=${installed_sha}"
    fi

    log "sha256 verified: ${installed_sha}"
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
fi

require_cmd bun
require_cmd install
require_cmd shasum
require_cmd uname

BUILD_TARGET="$(resolve_build_target)"
BUILT_BINARY="${ROOT_DIR}/cli/dist-exe/${BUILD_TARGET}/hapi"
TIMESTAMP="$(date +%Y%m%d%H%M%S)"
BACKUP_PATH="${INSTALL_PATH}.bak.${TIMESTAMP}"

log "root dir: ${ROOT_DIR}"
log "build target: ${BUILD_TARGET}"
log "install path: ${INSTALL_PATH}"

if [[ "${SKIP_BUILD}" != "1" ]]; then
    build_binary
else
    log "skip build (SKIP_BUILD=1)"
fi

[[ -f "${BUILT_BINARY}" ]] || die "Built binary not found: ${BUILT_BINARY}"

mkdir -p "$(dirname "${INSTALL_PATH}")"
backup_existing_binary "${INSTALL_PATH}" "${BACKUP_PATH}"

log "install new binary"
install -m 755 "${BUILT_BINARY}" "${INSTALL_PATH}"

if [[ "$(uname -s)" == "Darwin" ]] && command -v xattr >/dev/null 2>&1; then
    xattr -d com.apple.quarantine "${INSTALL_PATH}" >/dev/null 2>&1 || true
fi

verify_install "${INSTALL_PATH}"

if command -v hapi >/dev/null 2>&1; then
    log "current hapi on PATH: $(command -v hapi)"
    if [[ "$(command -v hapi)" != "${INSTALL_PATH}" ]]; then
        log "PATH warning: current shell still resolves hapi to another location"
    fi
fi

log "done"
log "backup: ${BACKUP_PATH}"
log "installed: ${INSTALL_PATH}"
log "version:"
"${INSTALL_PATH}" --version || true
