// Copies the shared game (../game) into desktop/app so it ships inside the desktop build.
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', '..', 'game');
const dst = path.join(__dirname, '..', 'app');
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
console.log('Copied game files into desktop/app');
