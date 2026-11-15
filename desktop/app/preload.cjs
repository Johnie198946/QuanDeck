const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('quandeckDesktop', {
  platform: process.platform,
  getConnection: () => ipcRenderer.invoke('connection'),
  chooseDirectory: () => ipcRenderer.invoke('directory'),
});
