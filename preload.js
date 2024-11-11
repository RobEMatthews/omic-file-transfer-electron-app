const { contextBridge, ipcRenderer } = require('electron');

// Expose a limited set of functionalities to the renderer process
contextBridge.exposeInMainWorld('api', {
  uploadFile: (filePath) => ipcRenderer.send('upload-file', filePath),
  cancelUpload: (filePath) => ipcRenderer.send('cancel-upload', filePath),
  onUploadProgress: (callback) => ipcRenderer.on('upload-progress', callback),
  onUploadSuccess: (callback) => ipcRenderer.on('upload-success', callback),
  onUploadError: (callback) => ipcRenderer.on('upload-error', callback),
  listFiles: () => ipcRenderer.invoke('list-files'),
  deleteFile: (fileId) => ipcRenderer.invoke('delete-file', fileId),
  logout: () => ipcRenderer.send('logout')
});

