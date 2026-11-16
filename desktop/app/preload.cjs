const { contextBridge, ipcRenderer } = require('electron');
const on = (name, callback) => { const listener = (_event, value) => callback(value); ipcRenderer.on(name, listener); return () => ipcRenderer.removeListener(name, listener); };
contextBridge.exposeInMainWorld('quandeckDesktop', {
  platform: process.platform,
  getConnection: () => ipcRenderer.invoke('connection'),
  bootstrap: values => ipcRenderer.invoke('bootstrap', values),
  command: (name, args) => ipcRenderer.invoke('command', name, args),
  onStorageError: callback => on('storage-error', callback), onSnapshot: callback => on('snapshot', callback), onNavigate: callback => on('navigate', callback),
  chooseDirectory: () => ipcRenderer.invoke('directory'), chooseExecutable: () => ipcRenderer.invoke('executable'),
  savePreference: (key, value) => ipcRenderer.invoke('preference', key, value),
  saveAttachment: (project, input) => ipcRenderer.invoke('attachment-save', project, input),
  downloadAttachment: (project, file) => ipcRenderer.invoke('attachment-download', project, file),
  removeAttachment: (project, id) => ipcRenderer.invoke('attachment-remove', project, id),
  openRun: (id, target) => ipcRenderer.invoke('run-open', id, target), getRun: id => ipcRenderer.invoke('run-read', id),
  controlRun: (id, action, payload) => ipcRenderer.invoke('run-control', id, action, payload),
  onRunEvent: callback => on('run-event', callback), cleanInstallers: () => ipcRenderer.invoke('installers-clean'),
  backupWorkspace: () => ipcRenderer.invoke('workspace-backup'),
});
