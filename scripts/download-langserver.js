const fs = require('fs');
const path = require('path');
const https = require('https');

const DEST_DIR = path.resolve(__dirname, '../.vscode-test');
const DEST_FILE = path.join(DEST_DIR, 'scheme-langserver');
const DOWNLOAD_URL = 'https://github.com/ufo5260987423/scheme-langserver/releases/latest/download/scheme-langserver-x86_64-linux-glibc';

function main() {
  if (fs.existsSync(DEST_FILE)) {
    try {
      fs.accessSync(DEST_FILE, fs.constants.X_OK);
      console.log(`scheme-langserver already exists at ${DEST_FILE}`);
      process.exit(0);
    } catch {
      // not executable, re-download
    }
  }

  fs.mkdirSync(DEST_DIR, { recursive: true });
  console.log(`Downloading scheme-langserver...`);

  const file = fs.createWriteStream(DEST_FILE);

  https.get(DOWNLOAD_URL, { headers: { 'User-Agent': 'magic-scheme-vscode-extension' } }, (response) => {
    if (response.statusCode === 301 || response.statusCode === 302) {
      const redirectUrl = response.headers.location;
      if (!redirectUrl) {
        console.error('Redirect without location header');
        process.exit(1);
      }
      https.get(redirectUrl, { headers: { 'User-Agent': 'magic-scheme-vscode-extension' } }, (res) => {
        handleResponse(res, file);
      }).on('error', (err) => {
        console.error(`Download failed: ${err.message}`);
        process.exit(1);
      });
      return;
    }
    handleResponse(response, file);
  }).on('error', (err) => {
    console.error(`Download failed: ${err.message}`);
    process.exit(1);
  });
}

function handleResponse(response, file) {
  if (response.statusCode !== 200) {
    console.error(`Download failed: HTTP ${response.statusCode}`);
    cleanupAndExit(1);
    return;
  }

  response.pipe(file);

  response.on('error', (err) => {
    console.error(`Download stream error: ${err.message}`);
    cleanupAndExit(1);
  });

  file.on('error', (err) => {
    console.error(`File write error: ${err.message}`);
    cleanupAndExit(1);
  });

  file.on('finish', () => {
    file.close();
    const stats = fs.statSync(DEST_FILE);
    const expectedSize = parseInt(response.headers['content-length'] || '0', 10);
    if (expectedSize > 0 && stats.size !== expectedSize) {
      console.error(`Download size mismatch: expected ${expectedSize}, got ${stats.size}`);
      cleanupAndExit(1);
      return;
    }
    fs.chmodSync(DEST_FILE, 0o755);
    console.log(`scheme-langserver downloaded to ${DEST_FILE}`);
  });
}

function cleanupAndExit(code) {
  try {
    if (fs.existsSync(DEST_FILE)) {
      fs.unlinkSync(DEST_FILE);
    }
  } catch {
    // ignore cleanup errors
  }
  process.exit(code);
}

main();
