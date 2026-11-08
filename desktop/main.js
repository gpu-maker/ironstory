// Electron entry point: opens the game in its own window.
const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('ignore-gpu-blocklist');   // make sure WebGL is on for older GPUs
app.commandLine.appendSwitch('enable-gpu-rasterization');

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 960, minHeight: 540,
    title: 'AEGIS: Port Halcyon', backgroundColor: '#05070c',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.key === 'F12' && input.control && input.shift) win.webContents.toggleDevTools();
  });
  // links (e.g. to GitHub) open in the normal browser, never inside the game window
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); shell.openExternal(url); } });
}
ipcMain.on('aegis:quit', () => app.quit());
ipcMain.on('aegis:fullscreen', () => win && win.setFullScreen(!win.isFullScreen()));

const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(createWindow);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on('window-all-closed', () => app.quit());
}
