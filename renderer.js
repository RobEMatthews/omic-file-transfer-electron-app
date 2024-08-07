const { ipcRenderer } = require('electron');

const dropArea = document.getElementById('dropArea');
const fileInput = document.getElementById('fileInput');
const uploadButton = document.getElementById('uploadButton');
const uploadProgress = document.getElementById('uploadProgress');
const uploadSpeedDisplay = document.getElementById('uploadSpeed');
const fileListItems = document.getElementById('fileListItems');

let filesToUpload = [];
let currentUploadIndex = 0;
let isUploading = false;

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
        ipcRenderer.send('cancel-upload', files[i].path);
        filesToUpload = filesToUpload.filter(file => file.path !== files[i].path);
        listItem.remove();
        if (currentUploadIndex === filesToUpload.length) {
          resetProgress(); // Reset progress bar and speed display when the current upload is canceled
        }
      });

      listItem.appendChild(removeButton);
      fileListItems.appendChild(listItem);
      filesToUpload.push(files[i]);
    }
  }
}

function resetProgress() {
  uploadProgress.style.width = '0%';
  uploadProgress.setAttribute('aria-valuenow', 0);
  uploadSpeedDisplay.textContent = 'Upload Speed: 0 MB/s';
}

function startNextUpload() {
  if (currentUploadIndex < filesToUpload.length) {
    isUploading = true;
    ipcRenderer.send('upload-file', filesToUpload[currentUploadIndex].path);
  } else {
    isUploading = false;
    resetProgress();
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
  if (!isUploading) {
    currentUploadIndex = 0;
    startNextUpload();
  }
});

ipcRenderer.on('upload-progress', (event, { progress, speed }) => {
  uploadProgress.style.width = `${progress}%`;
  uploadProgress.setAttribute('aria-valuenow', progress);
  const speedMBPerSecond = speed / (1024 * 1024); // Convert bytes per second to MB per second
  uploadSpeedDisplay.textContent = `Upload Speed: ${speedMBPerSecond.toFixed(2)} MB/s`; // Display speed in MB/s

  if (progress === 100) {
    currentUploadIndex++;
    startNextUpload();
  }
});

ipcRenderer.on('upload-error', (event, errorMessage) => {
  console.error(`Upload error: ${errorMessage}`);
  alert(`Upload error: ${errorMessage}`);
  currentUploadIndex++;
  startNextUpload();
});

