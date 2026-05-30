const fs = require('fs');
const path = require('path');

const DEST_DIR = path.resolve(__dirname, '../.vscode-test');
const DEST_FILE = path.join(DEST_DIR, 'scheme-langserver');
const DOWNLOAD_URL = 'https://github.com/ufo5260987423/scheme-langserver/releases/latest/download/scheme-langserver-x86_64-linux-glibc';

async function main() {
  if (fs.existsSync(DEST_FILE)) {
    try {
      fs.accessSync(DEST_FILE, fs.constants.X_OK);
      console.log(`scheme-langserver already exists at ${DEST_FILE}`);
      return;
    } catch {
      // not executable, re-download
    }
  }

  fs.mkdirSync(DEST_DIR, { recursive: true });
  console.log(`Downloading scheme-langserver...`);

  try {
    const response = await fetch(DOWNLOAD_URL, {
      redirect: 'follow',
      headers: { 'User-Agent': 'magic-scheme-vscode-extension' },
    });

    if (!response.ok) {
      throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(DEST_FILE, buffer);
    fs.chmodSync(DEST_FILE, 0o755);

    console.log(`scheme-langserver downloaded to ${DEST_FILE}`);
  } catch (err) {
    try {
      if (fs.existsSync(DEST_FILE)) {
        fs.unlinkSync(DEST_FILE);
      }
    } catch {
      // ignore cleanup errors
    }
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
