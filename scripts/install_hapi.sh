#!/usr/bin/env bash
set -euo pipefail

REPO="${REPO:-yichuangkeji/hapi}"
INSTALL_DIR_DEFAULT="${HOME}/.local/bin"
INSTALL_DIR="${INSTALL_DIR:-${INSTALL_DIR_DEFAULT}}"
VERSION_INPUT="${VERSION:-latest}"

log() {
    printf '[install-hapi] %s\n' "$*"
}

die() {
    printf '[install-hapi] ERROR: %s\n' "$*" >&2
    exit 1
}

usage() {
    cat <<'EOF'
Usage:
  ./scripts/install_hapi.sh [--version <tag|latest>] [--repo <owner/repo>] [--install-dir <path>]

Examples:
  ./scripts/install_hapi.sh
  ./scripts/install_hapi.sh --version v0.16.1-zqs.1
  ./scripts/install_hapi.sh --repo yichuangkeji/hapi
  ./scripts/install_hapi.sh --install-dir /usr/local/bin

Environment variables:
  VERSION=latest
  REPO=yichuangkeji/hapi
  INSTALL_DIR=$HOME/.local/bin
EOF
}

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        die "Missing command: $1"
    fi
}

normalize_version() {
    local raw="$1"
    if [[ "$raw" == "latest" ]]; then
        printf 'latest'
        return 0
    fi
    if [[ "$raw" == v* ]]; then
        printf '%s' "$raw"
        return 0
    fi
    printf 'v%s' "$raw"
}

resolve_os() {
    local uname_s
    uname_s="$(uname -s)"
    case "$uname_s" in
        Darwin) printf 'darwin' ;;
        Linux) printf 'linux' ;;
        *)
            die "Unsupported OS: ${uname_s}. Use prebuilt binary manually for this platform."
            ;;
    esac
}

resolve_arch() {
    local uname_m
    uname_m="$(uname -m)"
    case "$uname_m" in
        x86_64|amd64) printf 'x64' ;;
        arm64|aarch64) printf 'arm64' ;;
        *)
            die "Unsupported architecture: ${uname_m}. Use prebuilt binary manually for this platform."
            ;;
    esac
}

build_asset_candidates() {
    local os="$1"
    local arch="$2"
    if [[ "$os" == "linux" && "$arch" == "x64" ]]; then
        printf '%s\n' "hapi-linux-x64-baseline.tar.gz" "hapi-linux-x64.tar.gz"
        return 0
    fi
    printf 'hapi-%s-%s.tar.gz\n' "$os" "$arch"
}

download_release_asset() {
    local repo="$1"
    local version="$2"
    local dest_file="$3"
    shift 3
    local assets=("$@")

    local base_url
    if [[ "$version" == "latest" ]]; then
        base_url="https://github.com/${repo}/releases/latest/download"
    else
        base_url="https://github.com/${repo}/releases/download/${version}"
    fi

    local asset
    for asset in "${assets[@]}"; do
        local url="${base_url}/${asset}"
        if curl -fsSL --retry 3 --connect-timeout 10 "$url" -o "$dest_file"; then
            log "downloaded asset: ${asset}"
            printf '%s' "$asset"
            return 0
        fi
    done

    die "No matching asset found for this platform in ${repo} (${version})."
}

main() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                usage
                exit 0
                ;;
            --version)
                [[ $# -ge 2 ]] || die "Missing value for --version"
                VERSION_INPUT="$2"
                shift 2
                ;;
            --repo)
                [[ $# -ge 2 ]] || die "Missing value for --repo"
                REPO="$2"
                shift 2
                ;;
            --install-dir)
                [[ $# -ge 2 ]] || die "Missing value for --install-dir"
                INSTALL_DIR="$2"
                shift 2
                ;;
            *)
                die "Unknown argument: $1"
                ;;
        esac
    done

    require_cmd curl
    require_cmd tar
    require_cmd install
    require_cmd mktemp
    require_cmd uname

    local version
    version="$(normalize_version "$VERSION_INPUT")"
    local os
    os="$(resolve_os)"
    local arch
    arch="$(resolve_arch)"

    log "repo: ${REPO}"
    log "version: ${version}"
    log "platform: ${os}/${arch}"
    log "install dir: ${INSTALL_DIR}"

    local tmpdir
    tmpdir="$(mktemp -d)"
    trap 'rm -rf "$tmpdir"' EXIT

    local archive_file="${tmpdir}/hapi.tar.gz"
    mapfile -t asset_candidates < <(build_asset_candidates "$os" "$arch")
    local selected_asset
    selected_asset="$(download_release_asset "$REPO" "$version" "$archive_file" "${asset_candidates[@]}")"

    tar -xzf "$archive_file" -C "$tmpdir"
    [[ -f "${tmpdir}/hapi" ]] || die "Archive ${selected_asset} does not contain hapi binary."

    mkdir -p "$INSTALL_DIR"
    install -m 755 "${tmpdir}/hapi" "${INSTALL_DIR}/hapi"

    if [[ "$os" == "darwin" ]] && command -v xattr >/dev/null 2>&1; then
        xattr -d com.apple.quarantine "${INSTALL_DIR}/hapi" >/dev/null 2>&1 || true
    fi

    log "installed: ${INSTALL_DIR}/hapi"
    "${INSTALL_DIR}/hapi" --version || true

    if [[ ":$PATH:" != *":${INSTALL_DIR}:"* ]]; then
        printf '\n'
        printf 'PATH hint:\n'
        printf '  export PATH="%s:$PATH"\n' "$INSTALL_DIR"
    fi
}

main "$@"
