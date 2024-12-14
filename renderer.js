const dropArea = document.getElementById('dropArea');
const fileInput = document.getElementById('fileInput');
const uploadButton = document.getElementById('uploadButton');
const uploadProgress = document.getElementById('uploadProgress');
const uploadSpeedDisplay = document.getElementById('uploadSpeed');
const fileListItems = document.getElementById('fileListItems');
const uploadedFilesList = document.getElementById('uploadedFilesList');
const logoutButton = document.getElementById('logoutButton');

let filesToUpload = [];
let currentUploadIndex = 0;
let isUploading = false;

function createNotification(message, type = 'success') {
  const notificationContainer = document.createElement('div');
  notificationContainer.className = `alert alert-${type} notification`;
  notificationContainer.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 1000;
    transition: opacity 0.5s ease;
  `;
  notificationContainer.textContent = message;
  document.body.appendChild(notificationContainer);

  setTimeout(() => {
    notificationContainer.style.opacity = '0';
    setTimeout(() => {
      document.body.removeChild(notificationContainer);
    }, 500);
  }, 3000);
}

function createFileListItem(file, removeCallback, isUploading = false) {
  const fileItem = document.createElement('div');
  fileItem.className = `file-item ${isUploading ? 'uploading' : ''}`;

  const fileInfo = document.createElement('div');
  fileInfo.innerHTML = `
    <strong>${file.name}</strong>
    <small class="text-muted ml-2">${(file.size / 1024 / 1024).toFixed(2)} MB</small>
    ${isUploading ? '<span class="badge badge-primary ml-2">Uploading</span>' : ''}
  `;

  const removeButton = document.createElement('button');
  removeButton.className = 'btn btn-sm btn-outline-danger';
  removeButton.innerHTML = '<i class="fas fa-trash"></i>';
  removeButton.addEventListener('click', removeCallback);

  fileItem.appendChild(fileInfo);
  fileItem.appendChild(removeButton);
  fileItem.dataset.path = file.path;

  return fileItem;
}

function handleFiles(files) {
    console.log('Handling files:', files);
    if (isUploading) {
        createNotification('Upload in progress. Cannot add more files.', 'warning');
        return;
    }

    const MAX_FILES = 10;
    if (filesToUpload.length + files.length > MAX_FILES) {
        createNotification(`Maximum ${MAX_FILES} files allowed`, 'warning');
        return;
    }

    files.forEach(file => {
        if (!filesToUpload.some(f => f.path === file.path)) {
            const removeCallback = () => {
                if (isUploading && filesToUpload[currentUploadIndex]?.path === file.path) {
                    window.api.cancelUpload(file.path);
                } else {
                    filesToUpload = filesToUpload.filter(f => f.path !== file.path);

                    const fileItemToRemove = document.querySelector(`.file-item[data-path="${file.path}"]`);
                    if (fileItemToRemove) {
                        fileItemToRemove.remove();
                    }
                }
                updateUploadButtonState();
            };

            const listItem = createFileListItem(file, removeCallback);
            fileListItems.appendChild(listItem);
            filesToUpload.push(file);
        }
    });

    updateUploadButtonState();
    fileInput.value = '';
}

function updateUploadButtonState() {
  uploadButton.disabled = filesToUpload.length === 0 || isUploading;
  dropArea.classList.toggle('disabled', isUploading);
}

function setupEventListeners() {
    dropArea.addEventListener('click', () => {
        if (!isUploading) fileInput.click();
    });

    dropArea.addEventListener('dragover', event => {
        event.preventDefault();
        dropArea.classList.toggle('drag-over', !isUploading);
    });

    dropArea.addEventListener('dragleave', () => {
        dropArea.classList.remove('drag-over');
    });

    dropArea.addEventListener('drop', event => {
        event.preventDefault();
        dropArea.classList.remove('drag-over');
        
        const files = Array.from(event.dataTransfer.files).filter(file => {
	    console.log('File type:', file.type);
	    const allowedTypes = [
  		'text/csv',
  		'application/zip',
  		'text/plain',
  		'application/fastq',
 	 	'application/fasta'
	    ];
	    return allowedTypes.includes(file.type);
        });

        if (!isUploading && files.length > 0) {
            handleFiles(files);
        } else if (files.length === 0) {
            createNotification('Unsupported file type', 'warning');
        }
    });

    fileInput.addEventListener('change', () => {
        const files = Array.from(fileInput.files).filter(file => {
            const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10 GB
            if (file.size > MAX_FILE_SIZE) {
                createNotification(`${file.name} exceeds 100 MB limit`, 'warning');
                return false;
            }
            return true;
        });
        handleFiles(files);
    });

    uploadButton.addEventListener('click', startUpload);
    logoutButton.addEventListener('click', () => window.api.logout());
}

function startUpload() {
  console.log('Starting upload. Files to upload:', filesToUpload);
  if (filesToUpload.length === 0 || isUploading) return;

  isUploading = true;
  updateUploadButtonState();
  currentUploadIndex = 0;
  startNextUpload();
}

function startNextUpload() {
  console.log(`Starting upload for file ${currentUploadIndex + 1}/${filesToUpload.length}`);
  if (currentUploadIndex < filesToUpload.length) {
    resetProgress();
    const fileToUpload = filesToUpload[currentUploadIndex];

    const fileItems = document.querySelectorAll('.file-item');
    fileItems.forEach((item, index) => {
      item.classList.toggle('uploading', index === currentUploadIndex);
    });

    window.api.uploadFile(fileToUpload.path);
  } else {
    completeUpload();
  }
}

function resetProgress() {
  console.log('Resetting upload progress');
  uploadProgress.style.width = '0%';
  uploadProgress.setAttribute('aria-valuenow', 0);
  uploadSpeedDisplay.textContent = 'Upload Speed: 0 MB/s';
}

function completeUpload() {
  console.log('Upload process completed');
  isUploading = false;
  filesToUpload = [];
  fileListItems.innerHTML = '';
  updateUploadButtonState();
  fetchUploadedFiles();
}

function completeUpload() {
    console.log('Upload process completed');
    uploadProgress.style.width = '0%';
    uploadProgress.setAttribute('aria-valuenow', 0);
    uploadSpeedDisplay.textContent = 'Upload Speed: 0 MB/s';

    isUploading = false;
    filesToUpload = [];
    fileListItems.innerHTML = '';
    updateUploadButtonState();
    fetchUploadedFiles();
}

function handleUploadProgress() {
  window.api.onUploadProgress((event, { progress, speed }) => {
    console.log(`Upload progress: ${progress}%, Speed: ${speed.toFixed(2)} MB/s`);
    uploadProgress.style.width = `${progress}%`;
    uploadProgress.setAttribute('aria-valuenow', progress);
    uploadSpeedDisplay.textContent = `Upload Speed: ${speed.toFixed(2)} MB/s`;

    if (progress === 100) {
      currentUploadIndex++;
      startNextUpload();
    }
  });
}

function handleUploadSuccess() {
  window.api.onUploadSuccess((event, fileInfo) => {
    console.log('File uploaded successfully:', fileInfo.name);
    createNotification(`${fileInfo.name} uploaded successfully`);
    fetchUploadedFiles();
    currentUploadIndex++;
    startNextUpload();
  });
}

function handleUploadError() {
    window.api.onUploadError((event, errorMessage) => {
        console.error(`Upload error: ${errorMessage}`);
        createNotification(`Upload error: ${errorMessage}`, 'danger');

        filesToUpload.splice(currentUploadIndex, 1);

        const fileItems = document.querySelectorAll('.file-item');
        if (fileItems[currentUploadIndex]) {
            fileItems[currentUploadIndex].remove();
        }

        if (currentUploadIndex < filesToUpload.length) {
            startNextUpload();
        } else {
            completeUpload();
        }
    });
}

function handleUploadError() {
    window.api.onUploadError((event, errorInfo) => {
        console.error('Upload error:', errorInfo);

        const errorMessage = errorInfo.message || 'Unknown error';
        const fileName = errorInfo.fileName || 'Unknown file';

        console.error(`Upload error for ${fileName}: ${errorMessage}`);
        createNotification(`Upload failed: ${fileName} - ${errorMessage}`, 'danger');

        const failedFileIndex = filesToUpload.findIndex(file =>
            path.basename(file.path) === fileName
        );

        if (failedFileIndex !== -1) {
            filesToUpload.splice(failedFileIndex, 1);

            const fileItems = document.querySelectorAll('.file-item');
            if (fileItems[failedFileIndex]) {
                fileItems[failedFileIndex].remove();
            }
        }

        if (filesToUpload.length > 0) {
            startNextUpload();
        } else {
            completeUpload();
        }
    });
}

function fetchUploadedFiles() {
  console.log('Fetching uploaded files');
  window.api.listFiles()
    .then(files => {
      uploadedFilesList.innerHTML = '';
      files.forEach(file => {
        const listItem = document.createElement('li');
        listItem.className = 'list-group-item d-flex justify-content-between align-items-center';
        listItem.innerHTML = `
          ${file.name}
          <button class="btn btn-sm btn-outline-danger delete-file" data-id="${file.id}">
            <i class="fas fa-trash"></i>
          </button>
        `;

        listItem.querySelector('.delete-file').addEventListener('click', async () => {
          await handleDeleteFile(file.id);
        });

        uploadedFilesList.appendChild(listItem);
      });
    })
    .catch(error => {
      console.error('Error fetching files:', error.message);
      createNotification('Failed to fetch uploaded files', 'danger');
    });
}

async function handleDeleteFile(fileId) {
  try {
    console.log('Deleting file with ID:', fileId);
    await window.api.deleteFile(fileId);
    createNotification('File deleted successfully');
    fetchUploadedFiles();
  } catch (error) {
    console.error('Error deleting file:', error);
    createNotification(`Deletion failed: ${error.message}`, 'danger');
  }
}

function init() {
  console.log('Initializing renderer');
  setupEventListeners();
  handleUploadProgress();
  handleUploadSuccess();
  handleUploadError();
  fetchUploadedFiles();
}

init();
