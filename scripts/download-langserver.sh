#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="${SCRIPT_DIR}/../.vscode-test"
DEST_FILE="${DEST_DIR}/scheme-langserver"

mkdir -p "${DEST_DIR}"

# Skip if already downloaded and executable
if [[ -x "${DEST_FILE}" ]]; then
    echo "scheme-langserver already exists at ${DEST_FILE}"
    exit 0
fi

echo "Downloading latest scheme-langserver..."

DOWNLOAD_URL="https://github.com/ufo5260987423/scheme-langserver/releases/latest/download/scheme-langserver-x86_64-linux-glibc"

curl -fsSL -o "${DEST_FILE}" "${DOWNLOAD_URL}"
chmod +x "${DEST_FILE}"

echo "scheme-langserver downloaded to ${DEST_FILE}"
