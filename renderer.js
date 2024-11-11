const dropArea = document.getElementById('dropArea');
const fileInput = document.getElementById('fileInput');
const uploadButton = document.getElementById('uploadButton');
const uploadProgress = document.getElementById('uploadProgress');
const uploadSpeedDisplay = document.getElementById('uploadSpeed');
const fileListItems = document.getElementById('fileListItems');
const logoutButton = document.getElementById('logoutButton');

let filesToUpload = [];
let currentUploadIndex = 0;
let isUploading = false;
let activeUploadPath = null; // Track the currently uploading file path

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
        if (activeUploadPath === files[i].path) {
	  window.api.cancelUpload(files[i].path);	
          resetProgress(); // Reset progress immediately when canceling an active upload
        }
        filesToUpload = filesToUpload.filter(file => file.path !== files[i].path);
        listItem.remove();
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
  isUploading = false;
  activeUploadPath = null; // Clear the active upload path
}

function startNextUpload() {
  if (currentUploadIndex < filesToUpload.length) {
    isUploading = true;
    activeUploadPath = filesToUpload[currentUploadIndex].path;
    window.api.uploadFile(activeUploadPath);
  } else {
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

window.api.onUploadProgress((event, { progress, speed }) => {
  if (!isUploading || activeUploadPath !== filesToUpload[currentUploadIndex].path) return; // Ignore updates if not uploading or if the file is not active

  uploadProgress.style.width = `${progress}%`;
  uploadProgress.setAttribute('aria-valuenow', progress);
  const speedMBPerSecond = speed / (1024 * 1024); // Convert bytes per second to MB per second
  uploadSpeedDisplay.textContent = `Upload Speed: ${speedMBPerSecond.toFixed(2)} MB/s`; // Display speed in MB/s

  if (progress === 100) {
    currentUploadIndex++;
    startNextUpload();
  }
});

window.api.onUploadSuccess((event, fileName) => {
  alert(`File "${fileName}" uploaded successfully!`);
  currentUploadIndex++;
  startNextUpload();
});

window.api.onUploadError((event, errorMessage) => {
  console.error(`Upload error: ${errorMessage}`);
  alert(`Upload error: ${errorMessage}`);
  currentUploadIndex++;
  startNextUpload();
});

async function fetchUploadedFiles() {
  try {
    const files = await window.api.listFiles(); // Invoke the list-files handler
    const uploadedFilesList = document.getElementById('uploadedFilesList');
    uploadedFilesList.innerHTML = ''; // Clear existing list

    files.forEach(file => {
      const listItem = document.createElement('li');
      listItem.className = 'list-group-item d-flex justify-content-between align-items-center';
      listItem.textContent = file.name;

      const deleteButton = document.createElement('button');
      deleteButton.className = 'btn btn-danger btn-sm';
      deleteButton.textContent = 'Delete';
      deleteButton.addEventListener('click', async () => {
        await handleDeleteFile(file.id);
        alert(`File "${file.name}" deleted successfully!`);
        fetchUploadedFiles(); // Refresh the file list
      });

      listItem.appendChild(deleteButton);
      uploadedFilesList.appendChild(listItem);
    });
  } catch (error) {
      console.error('Error fetching files:', error.message);
  }
}

// Handle file deletion
async function handleDeleteFile(fileId) {
  try {
    await window.api.deleteFile(fileId); // Invoke the delete-file handler
  } catch (error) {
      console.error('Error deleting file:', error.message);
  }
}

// Call fetchUploadedFiles on page load to populate the file list
fetchUploadedFiles();

logoutButton.addEventListener('click', () => {
  console.log('Logout event received');
  window.api.logout(); // Send a message to the main process to handle logout
});

