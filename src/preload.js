const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('terminal', {
  sendCommand: (text) => ipcRenderer.send('command', text),
  onLog: (callback) => ipcRenderer.on('log', (_event, message) => callback(message)),
  onClear: (callback) => ipcRenderer.on('clear-log', () => callback()),
  onTabsUpdated: (callback) => ipcRenderer.on('tabs-updated', (_event, tabs) => callback(tabs)),
  onTerminalVisibility: (callback) => ipcRenderer.on('terminal-visibility', (_event, visible) => callback(visible)),
});