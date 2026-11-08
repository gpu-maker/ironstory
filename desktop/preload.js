// Exposes a tiny, safe API to the game page (quit + fullscreen) when running as the desktop app.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('aegisDesktop', {
  isDesktop: true,
  quit: () => ipcRenderer.send('aegis:quit'),
  toggleFullscreen: () => ipcRenderer.send('aegis:fullscreen'),
});
