const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('localRag', {
  selectFolder: () => ipcRenderer.invoke('dialog:select-folder'),
  selectModelFolder: () => ipcRenderer.invoke('dialog:select-model-folder'),
  selectGgufFiles: () => ipcRenderer.invoke('dialog:select-gguf-files'),
  openPath: (filePath) => ipcRenderer.invoke('shell:open-path', filePath)
});
