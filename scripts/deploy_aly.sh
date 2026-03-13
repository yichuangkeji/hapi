#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_HOST="${TARGET_HOST:-aly}"
BUILD_TARGET="${BUILD_TARGET:-bun-linux-x64-baseline}"
LOCAL_BIN="${ROOT_DIR}/cli/dist-exe/${BUILD_TARGET}/hapi"
REMOTE_TMP="/tmp/hapi.new"
REMOTE_BIN="/usr/lib/node_modules/@twsxtd/hapi/node_modules/@twsxtd/hapi-linux-x64/bin/hapi"
REMOTE_LOG="/root/.hapi/hub.log"
REMOTE_SETTINGS="${REMOTE_SETTINGS:-/root/.hapi/settings.json}"
REMOTE_LISTEN_HOST="${REMOTE_LISTEN_HOST:-0.0.0.0}"

SKIP_BUILD="${SKIP_BUILD:-0}"

log() {
    printf '[deploy-aly] %s\n' "$*"
}

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        printf 'Missing command: %s\n' "$1" >&2
        exit 1
    fi
}

retry_healthcheck() {
    local max_attempts=20
    local attempt=1

    while (( attempt <= max_attempts )); do
        if ssh "${TARGET_HOST}" "curl -fsS http://127.0.0.1:3006/health" >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
        (( attempt++ ))
    done

    return 1
}

build_binary() {
    log "build web assets"
    (cd "${ROOT_DIR}" && bun run build:web)

    log "generate embedded web assets"
    (cd "${ROOT_DIR}" && bun run --cwd hub generate:embedded-web-assets)

    log "download tunwg binaries"
    (cd "${ROOT_DIR}" && bun run download:tunwg)

    log "build linux executable (${BUILD_TARGET})"
    (cd "${ROOT_DIR}" && bun run --cwd cli scripts/build-executable.ts --with-web-assets --target "${BUILD_TARGET}" --name hapi)
}

deploy_binary() {
    local ts
    ts="$(date +%Y%m%d%H%M%S)"

    log "upload binary to ${TARGET_HOST}:${REMOTE_TMP}"
    scp "${LOCAL_BIN}" "${TARGET_HOST}:${REMOTE_TMP}"

    log "stop existing hapi hub"
    ssh "${TARGET_HOST}" "pkill -f '^node /usr/bin/hapi hub$' || true"
    ssh "${TARGET_HOST}" "pkill -f '^/usr/lib/node_modules/.*/hapi-linux-x64/bin/hapi hub$' || true"

    log "install binary on ${TARGET_HOST}"
    ssh "${TARGET_HOST}" "mkdir -p \"$(dirname "${REMOTE_BIN}")\""
    ssh "${TARGET_HOST}" "if [ -f \"${REMOTE_BIN}\" ]; then cp -a \"${REMOTE_BIN}\" \"${REMOTE_BIN}.bak.${ts}\"; fi"
    ssh "${TARGET_HOST}" "install -m 755 \"${REMOTE_TMP}\" \"${REMOTE_BIN}\" && rm -f \"${REMOTE_TMP}\""

    local local_sha remote_sha
    local_sha="$(shasum -a 256 "${LOCAL_BIN}" | cut -d ' ' -f1)"
    remote_sha="$(ssh "${TARGET_HOST}" "shasum -a 256 \"${REMOTE_BIN}\" | cut -d ' ' -f1")"
    if [[ "${local_sha}" != "${remote_sha}" ]]; then
        printf 'sha256 mismatch: local=%s remote=%s\n' "${local_sha}" "${remote_sha}" >&2
        exit 1
    fi
    log "sha256 verified: ${remote_sha}"
}

restart_hub() {
    log "set listen host to ${REMOTE_LISTEN_HOST}"
    ssh "${TARGET_HOST}" "node -e '
const fs = require(\"fs\");
const p = process.argv[1];
const host = process.argv[2];
let settings = {};
try {
  settings = JSON.parse(fs.readFileSync(p, \"utf8\"));
} catch {}
settings.listenHost = host;
fs.writeFileSync(p, JSON.stringify(settings, null, 2) + \"\\n\");
' \"${REMOTE_SETTINGS}\" \"${REMOTE_LISTEN_HOST}\""

    log "start hapi hub"
    ssh "${TARGET_HOST}" "nohup /usr/bin/hapi hub >\"${REMOTE_LOG}\" 2>&1 </dev/null &"

    if retry_healthcheck; then
        log "health check passed"
        ssh "${TARGET_HOST}" "curl -fsS http://127.0.0.1:3006/health"
        ssh "${TARGET_HOST}" "pgrep -af 'hapi hub' || true"
        return
    fi

    log "health check failed, recent log:"
    ssh "${TARGET_HOST}" "tail -n 120 \"${REMOTE_LOG}\" || true"
    exit 1
}

main() {
    require_cmd bun
    require_cmd ssh
    require_cmd scp
    require_cmd shasum

    if [[ "${SKIP_BUILD}" != "1" ]]; then
        build_binary
    else
        log "skip build (SKIP_BUILD=1)"
    fi

    if [[ ! -f "${LOCAL_BIN}" ]]; then
        printf 'local binary not found: %s\n' "${LOCAL_BIN}" >&2
        exit 1
    fi

    deploy_binary
    restart_hub

    log "done"
}

main "$@"
