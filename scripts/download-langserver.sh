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

echo "Fetching latest scheme-langserver release..."

# Get the download URL from GitHub API
DOWNLOAD_URL=$(curl -fsSL \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/ufo5260987423/scheme-langserver/releases/latest" \
    | grep '"browser_download_url"' \
    | head -1 \
    | sed -E 's/.*"browser_download_url": *"([^"]+)".*/\1/')

if [[ -z "${DOWNLOAD_URL}" ]]; then
    echo "Failed to get download URL from GitHub API"
    exit 1
fi

echo "Downloading from ${DOWNLOAD_URL}..."
curl -fsSL -o "${DEST_FILE}" "${DOWNLOAD_URL}"
chmod +x "${DEST_FILE}"

echo "scheme-langserver downloaded to ${DEST_FILE}"
