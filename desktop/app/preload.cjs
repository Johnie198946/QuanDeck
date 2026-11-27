const { contextBridge, ipcRenderer } = require('electron');
const on = (name, callback) => { const listener = (_event, value) => callback(value); ipcRenderer.on(name, listener); return () => ipcRenderer.removeListener(name, listener); };
// A notification can reopen a closed window before React has mounted its navigation handlers.
function bufferedChannel(name) {
  const listeners = new Set();
  let pending;
  function deliver() {
    if (!pending || !listeners.size) return;
    const event = pending;
    pending = undefined;
    for (const listener of listeners) listener(event.value);
  }
  on(name, value => { pending = { value }; deliver(); });
  return listener => {
    listeners.add(listener);
    if (pending) queueMicrotask(deliver);
    return () => listeners.delete(listener);
  };
}
const onNavigate = bufferedChannel('navigate');
const onAgendaReminderClick = bufferedChannel('agenda-reminder-clicked');
contextBridge.exposeInMainWorld('quandeckDesktop', {
  resolveNoteTodoDue: text => ipcRenderer.invoke('knowledge-todo-due', text),
  readKnowledge: () => ipcRenderer.invoke('knowledge-read'),
  compareKnowledge: (expected, value) => ipcRenderer.invoke('knowledge-compare', expected, value),
  onAgendaReminderClick,
  onKnowledgeChange: callback => on('knowledge-changed', callback),
  previewKnowledgeAttachment: (noteId, fileId) => ipcRenderer.invoke('knowledge-attachment-preview', noteId, fileId),
  readKnowledgeImage: (noteId, fileId) => ipcRenderer.invoke('knowledge-image', noteId, fileId),
  shareKnowledgeNote: input => ipcRenderer.invoke('knowledge-share', input),
  getKnowledgeGraphProgress: () => ipcRenderer.invoke('knowledge-graph-progress'),
  onKnowledgeGraphProgress: callback => on('knowledge-graph-progress-changed', callback),
  copyKnowledgeImage: png => ipcRenderer.invoke('knowledge-image-copy', png),
  readKnowledgeFileQuote: anchor => ipcRenderer.invoke('knowledge-attachment-quote', anchor),
  extractInspirations: noteIds => ipcRenderer.invoke('knowledge-extract-inspirations', noteIds),
  generateKnowledgeGraph: () => ipcRenderer.invoke('knowledge-generate-graph'),
  onNoteAnswerProgress: callback => on('knowledge-answer-progress', callback),
  expandKnowledge: input => ipcRenderer.invoke('knowledge-expand', input),
  getCodexApprovalMode: () => ipcRenderer.invoke('codex-approval-read'),
  setCodexApprovalMode: mode => ipcRenderer.invoke('codex-approval-save', mode),
  comparePreference: (key, expected, value) => ipcRenderer.invoke('preference-compare', key, expected, value),
  platform: process.platform,
  getWindowState: () => ipcRenderer.invoke('window-state'),
  toggleFullscreen: () => ipcRenderer.invoke('window-fullscreen'),
  onWindowState: callback => on('window-state', callback),
  getConnection: () => ipcRenderer.invoke('connection'),
  bootstrap: values => ipcRenderer.invoke('bootstrap', values),
  distillProjectBrief: (projectId, evidenceKey) => ipcRenderer.invoke('project-brief:distill', projectId, evidenceKey),
  analyzeProject: input => ipcRenderer.invoke('project-analysis', input),
  compareTaskAgents: input => ipcRenderer.invoke('task-compare:run', input),
  command: (name, args) => ipcRenderer.invoke('command', name, args),
  onProjectChanges: callback => on('snapshot-invalidated', callback),
  onStorageError: callback => on('storage-error', callback), onSnapshot: callback => on('snapshot', callback), onNavigate,
  agentSetupDirectory: () => ipcRenderer.invoke('agent-setup-directory'),
  chooseDirectory: () => ipcRenderer.invoke('directory'), chooseExecutable: () => ipcRenderer.invoke('executable'),
  savePreference: (key, value) => ipcRenderer.invoke('preference', key, value),
  chooseRunAttachments: id => ipcRenderer.invoke('run-attachment-choose', id),
  previewDiscussionAttachment: (project, plan, conclusion, block, option) => ipcRenderer.invoke('discussion-attachment-preview', project, plan, conclusion, block, option),
  importSpecAttachment: (project, artifact, candidate) => ipcRenderer.invoke('spec-attachment-import', project, artifact, candidate),
  previewOutputAttachment: (projectId, outputId, attachmentId, reference) => ipcRenderer.invoke('output-attachment-preview', projectId, outputId, attachmentId, reference),
  previewRunAttachment: (id, path) => ipcRenderer.invoke('run-attachment-preview', id, path),
  revealRunAttachment: (id, path) => ipcRenderer.invoke('run-attachment-reveal', id, path),
  saveAttachment: (project, input) => ipcRenderer.invoke('attachment-save', project, input),
  downloadAttachment: (project, file) => ipcRenderer.invoke('attachment-download', project, file),
  removeAttachment: (project, id) => ipcRenderer.invoke('attachment-remove', project, id),
  openRun: (id, target) => ipcRenderer.invoke('run-open', id, target), getRun: id => ipcRenderer.invoke('run-read', id),
  controlRun: (id, action, payload) => ipcRenderer.invoke('run-control', id, action, payload),
  onRunEvent: callback => on('run-event', callback), cleanInstallers: () => ipcRenderer.invoke('installers-clean'),
  exportProject: project => ipcRenderer.invoke('project-export', project),
  deleteProjectPermanently: projectId => ipcRenderer.invoke('project-delete-permanently', projectId),
  previewEraseProject: project => ipcRenderer.invoke('project-erase-preview', project),
  eraseProject: request => ipcRenderer.invoke('project-erase', request),
  restoreWorkspace: () => ipcRenderer.invoke('workspace-restore'),
  backupWorkspace: () => ipcRenderer.invoke('workspace-backup'),
});
