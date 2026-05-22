const fs = require('fs');
const path = require('path');

const settingsPath = path.join(__dirname, '..', '.vscode', 'settings.json');
if (!fs.existsSync(settingsPath)) {
    process.exit(0);
}

let settings;
try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
} catch {
    process.exit(0);
}

let changed = false;
for (const key of Object.keys(settings)) {
    if (key.startsWith('magicScheme.')) {
        delete settings[key];
        changed = true;
    }
}

if (changed) {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4) + '\n', 'utf8');
    console.log('Cleaned magicScheme settings from .vscode/settings.json');
}
