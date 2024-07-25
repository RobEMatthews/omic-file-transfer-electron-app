const { ipcRenderer } = require('electron');

document.getElementById('uploadButton').addEventListener('click', () => {
  const files = document.getElementById('fileInput').files;
  for (let i = 0; i < files.length; i++) {
    ipcRenderer.send('upload-file', files[i].path);
  }
});

ipcRenderer.on('upload-progress', (event, progress) => {
  console.log(`Upload progress: ${progress}%`);
  // Update UI with progress
});

ipcRenderer.on('upload-error', (event, errorMessage) => {
  console.error(`Upload error: ${errorMessage}`);
  // Update UI with error message
});
