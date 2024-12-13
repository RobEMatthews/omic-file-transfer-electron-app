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
let activeUploadPath = null;

function createFileListItem(file, removeCallback) {
  const listItem = document.createElement('li');
  listItem.className = 'list-group-item d-flex justify-content-between align-items-center';
  listItem.textContent = file.name;

  const removeButton = document.createElement('button');
  removeButton.className = 'btn btn-danger btn-sm';
  removeButton.textContent = 'Remove';
  removeButton.addEventListener('click', removeCallback);

  listItem.appendChild(removeButton);
  return listItem;
}

function handleFiles(files) {
  Array.from(files).forEach(file => {
    if (!filesToUpload.some(f => f.path === file.path)) {
      const removeCallback = () => {
        if (activeUploadPath === file.path) {
          window.api.cancelUpload(file.path);
          resetProgress();
        }
        filesToUpload = filesToUpload.filter(f => f.path !== file.path);
        const listItem = document.querySelector(`li[data-path="${file.path}"]`);
        if (listItem) listItem.remove();

	if (filesToUpload.length === 0 && fileInput) {
    	  fileInput.value = '';
	}
      };

      const listItem = createFileListItem(file, removeCallback);
      listItem.dataset.path = file.path;
      fileListItems.appendChild(listItem);
      filesToUpload.push(file);
    }
  });
}

function updateUploadProgress(progress, speed) {
  uploadProgress.style.width = `${progress}%`;
  uploadProgress.setAttribute('aria-valuenow', progress);
  uploadSpeedDisplay.textContent = `Upload Speed: ${speed.toFixed(2)} MB/s`;
}

function resetProgress() {
  uploadProgress.style.width = '0%';
  uploadProgress.setAttribute('aria-valuenow', 0);
  uploadSpeedDisplay.textContent = 'Upload Speed: 0 MB/s';
  isUploading = false;
  activeUploadPath = null;
}

function startNextUpload() {
  console.log('Starting next upload');
  console.log('Current upload index:', currentUploadIndex);
  console.log('Total files to upload:', filesToUpload.length);
  if (currentUploadIndex < filesToUpload.length) {
    console.log('Resetting progress');
    resetProgress();
    activeUploadPath = filesToUpload[currentUploadIndex].path;
    console.log('Uploading file:', activeUploadPath);
    window.api.uploadFile(activeUploadPath);
  } else {
    console.log('No more files to upload');
    resetProgress();
    filesToUpload = [];
    fileListItems.innerHTML = '';
  }
}

function handleFileEvents() {
  dropArea.addEventListener('click', () => fileInput.click());
  dropArea.addEventListener('dragover', event => event.preventDefault());
  dropArea.addEventListener('dragleave', () => dropArea.classList.remove('hover'));
  dropArea.addEventListener('drop', event => {
    event.preventDefault();
    dropArea.classList.remove('hover');
    handleFiles(event.dataTransfer.files);
  });

  fileInput.addEventListener('change', () => handleFiles(fileInput.files));
}

function uploadButtonHandler() {
  uploadButton.addEventListener('click', () => {
  
  console.log('Upload button clicked');
  console.log('Files to upload:', filesToUpload);
  console.log('Is uploading:', isUploading);
    if (!isUploading) {
      currentUploadIndex = 0;
      startNextUpload();
    }
  });
}

function fetchUploadedFiles() {
  window.api.listFiles()
    .then(files => {
      const uploadedFilesList = document.getElementById('uploadedFilesList');
      uploadedFilesList.innerHTML = '';
      files.forEach(file => {
        const listItem = createFileListItem(file, async () => {
          await handleDeleteFile(file.id);
          alert(`File "${file.name}" deleted successfully!`);
          fetchUploadedFiles();
        });
        uploadedFilesList.appendChild(listItem);
      });
    })
    .catch(error => console.error('Error fetching files:', error.message));
}

async function handleDeleteFile(fileId) {
  try {
    const result = await window.api.deleteFile(fileId);
    if (result.success) {
      const uploadedFilesList = document.getElementById('uploadedFilesList');
      const listItemToRemove = Array.from(uploadedFilesList.children)
        .find(item => item.dataset.fileId === fileId);

      if (listItemToRemove) {
        listItemToRemove.remove();
      }

      await fetchUploadedFiles();
    } else {
      throw new Error(result.error || 'File deletion failed');
    }
  } catch (error) {
    console.error('Error deleting file:', error.message);
    alert(`Deletion failed: ${error.message}`);
  }
}

function handleUploadProgress() {
  window.api.onUploadProgress((event, { progress, speed }) => {
     console.log('Upload Progress Event:', {
       progress, 
       speed, 
       currentUploadIndex,
       activeUploadPath,
       expectedFilePath: filesToUpload[currentUploadIndex]?.path
     });
     if (!isUploading || activeUploadPath !== filesToUpload[currentUploadIndex].path) return;
    updateUploadProgress(progress, speed);

    if (progress === 100) {
      currentUploadIndex++;
      startNextUpload();
    }
  });
}

function handleUploadSuccess() {
  window.api.onUploadSuccess((event, fileInfo) => {
    alert(`File "${fileInfo.name}" uploaded successfully!`);
    fetchUploadedFiles();
    currentUploadIndex++;
    startNextUpload();
  });
}

function handleUploadError() {
  window.api.onUploadError((event, errorMessage) => {
    console.error(`Upload error: ${errorMessage}`);
    alert(`Upload error: ${errorMessage}`);
    currentUploadIndex++;
    startNextUpload();
  });
}

function logoutHandler() {
  logoutButton.addEventListener('click', () => {
    console.log('Logout event received');
    window.api.logout();
  });
}

function init() {
  handleFileEvents();
  uploadButtonHandler();
  handleUploadProgress();
  handleUploadSuccess();
  handleUploadError();
  logoutHandler();
  fetchUploadedFiles();
}

init();
