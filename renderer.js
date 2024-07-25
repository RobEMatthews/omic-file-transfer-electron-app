
const { ipcRenderer } = require('electron');

const dropArea = document.getElementById('dropArea');
const fileInput = document.getElementById('fileInput');
const uploadButton = document.getElementById('uploadButton');
const uploadProgress = document.getElementById('uploadProgress');
const fileListItems = document.getElementById('fileListItems');

let filesToUpload = [];

function handleFiles(files) {
  for (let i = 0; i < files.length; i++) {
    if (!filesToUpload.some(file => file.path === files[i].path)) {
      const listItem = document.createElement('li');
      listItem.className = 'list-group-item d-flex justify-content-between align-items-center';
      listItem.textContent = files[i].name;

      const removeButton = document.createElement('button');
      removeButton.className = 'btn btn-danger btn-sm';
      removeButton.textContent = 'Remove';
      removeButton.addEventListener('click', () => {
        filesToUpload = filesToUpload.filter(file => file.path !== files[i].path);
        listItem.remove();
      });

      listItem.appendChild(removeButton);
      fileListItems.appendChild(listItem);
      filesToUpload.push(files[i]);
    }
  }
}

dropArea.addEventListener('click', () => {
  fileInput.click();
});

dropArea.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropArea.classList.add('hover');
});

dropArea.addEventListener('dragleave', () => {
  dropArea.classList.remove('hover');
});
dropArea.addEventListener('drop', (event) => {
  event.preventDefault();
  dropArea.classList.remove('hover');
  handleFiles(event.dataTransfer.files);
});

fileInput.addEventListener('change', () => {
  handleFiles(fileInput.files);
});

uploadButton.addEventListener('click', () => {
  uploadProgress.style.width = '0%';
  uploadProgress.setAttribute('aria-valuenow', 0);

  filesToUpload.forEach(file => {
    ipcRenderer.send('upload-file', file.path);
  });
});

ipcRenderer.on('upload-progress', (event, progress) => {
  uploadProgress.style.width = `${progress}%`;
  uploadProgress.setAttribute('aria-valuenow', progress);
});

ipcRenderer.on('upload-error', (event, errorMessage) => {
  console.error(`Upload error: ${errorMessage}`);
});
