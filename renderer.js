class UIManager {
  constructor() {
    this.elements = {
      dropArea: document.getElementById("dropArea"),
      fileInput: document.getElementById("fileInput"),
      uploadButton: document.getElementById("uploadButton"),
      uploadProgress: document.getElementById("uploadProgress"),
      uploadSpeedDisplay: document.getElementById("uploadSpeed"),
      fileListItems: document.getElementById("fileListItems"),
      uploadedFilesList: document.getElementById("uploadedFilesList"),
      logoutButton: document.getElementById("logoutButton"),
    };

    this.state = {
      filesToUpload: [],
      isUploading: false,
    };

    this.initialize();
  }

  initialize() {
    this.setupEventListeners();
    this.setupAPIHandlers();
    this.fetchUploadedFiles();
  }

  setupEventListeners() {
    this.elements.dropArea.addEventListener("click", () => {
      if (!this.state.isUploading) this.elements.fileInput.click();
    });

    this.elements.dropArea.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (!this.state.isUploading) {
        this.elements.dropArea.classList.add("drag-over");
      }
    });

    this.elements.dropArea.addEventListener("dragleave", () => {
      this.elements.dropArea.classList.remove("drag-over");
    });

    this.elements.dropArea.addEventListener("drop", (event) => {
      event.preventDefault();
      this.elements.dropArea.classList.remove("drag-over");

      if (!this.state.isUploading) {
        const files = Array.from(event.dataTransfer.files).filter(
          this.isFileTypeAllowed,
        );
        this.handleFiles(files);
      }
    });

    this.elements.fileInput.addEventListener("change", () => {
      const files = Array.from(this.elements.fileInput.files).filter(
        this.isFileSizeAllowed,
      );
      this.handleFiles(files);
    });

    this.elements.uploadButton.addEventListener("click", () =>
      this.startUpload(),
    );
    this.elements.logoutButton.addEventListener("click", () =>
      window.api.logout(),
    );
  }

  setupAPIHandlers() {
    window.api.onUploadProgress((event, { progress, speed }) => {
      this.updateProgress(progress, speed);
    });

    window.api.onUploadSuccess((event, fileInfo) => {
      this.handleUploadSuccess(fileInfo);
    });

    window.api.onUploadError((event, error) => {
      this.handleUploadError(error);
    });
  }

  isFileTypeAllowed(file) {
    const allowedTypes = [
      "text/csv",
      "application/zip",
      "text/plain",
      "application/fastq",
      "application/fasta",
    ];
    return allowedTypes.includes(file.type);
  }

  isFileSizeAllowed(file) {
    const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10 GB
    return file.size <= MAX_FILE_SIZE;
  }

  handleFiles(files) {
    if (this.state.isUploading) {
      this.createNotification(
        "Upload in progress. Cannot add more files.",
        "warning",
      );
      return;
    }

    const MAX_FILES = 10;
    if (this.state.filesToUpload.length + files.length > MAX_FILES) {
      this.createNotification(`Maximum ${MAX_FILES} files allowed`, "warning");
      return;
    }

    files.forEach((file) => {
      if (!this.state.filesToUpload.some((f) => f.path === file.path)) {
        this.addFileToList(file);
        this.state.filesToUpload.push(file);
      }
    });

    this.updateUploadButtonState();
    this.elements.fileInput.value = "";
  }

  addFileToList(file) {
    const listItem = this.createFileListItem(file);
    this.elements.fileListItems.appendChild(listItem);
  }

  createFileListItem(file) {
    const fileItem = document.createElement("div");
    fileItem.className = "file-item";
    fileItem.dataset.path = file.path;

    const fileInfo = document.createElement("div");
    fileInfo.innerHTML = `
      <strong>${file.name}</strong>
      <small class="text-muted ml-2">${(file.size / 1024 / 1024).toFixed(2)} MB</small>
    `;

    const removeButton = document.createElement("button");
    removeButton.className = "btn btn-sm btn-outline-danger";
    removeButton.innerHTML = '<i class="fas fa-trash"></i>';
    removeButton.addEventListener("click", () => this.removeFile(file));

    fileItem.appendChild(fileInfo);
    fileItem.appendChild(removeButton);

    return fileItem;
  }

  removeFile(file) {
    if (this.state.isUploading) {
      window.api.cancelUpload(file.path);
    }

    this.state.filesToUpload = this.state.filesToUpload.filter(
      (f) => f.path !== file.path,
    );
    const fileItem = document.querySelector(
      `.file-item[data-path="${file.path}"]`,
    );
    if (fileItem) {
      fileItem.remove();
    }

    this.updateUploadButtonState();
  }

  startUpload() {
    if (this.state.filesToUpload.length === 0 || this.state.isUploading) return;

    this.state.isUploading = true;
    this.updateUploadButtonState();
    this.elements.logoutButton.disabled = true;

    this.state.filesToUpload.forEach((file) => {
      window.api.uploadFile(file.path);
    });
  }

  updateProgress(progress, speed) {
    this.elements.uploadProgress.style.width = `${progress}%`;
    this.elements.uploadProgress.setAttribute("aria-valuenow", progress);
    this.elements.uploadSpeedDisplay.textContent = `Upload Speed: ${speed.toFixed(2)} MB/s`;
  }

  handleUploadSuccess(fileInfo) {
    this.createNotification(`${fileInfo.name} uploaded successfully`);
    this.fetchUploadedFiles();
    this.removeFile({ path: fileInfo.path });

    if (this.state.filesToUpload.length === 0) {
      this.completeUpload();
    }
  }

  handleUploadError(error) {
    if (error.message === "Upload canceled") {
      this.createNotification("Upload canceled", "warning");
    } else {
      this.createNotification(`Upload failed: ${error.message}`, "danger");
    }

    if (error.fileName) {
      this.removeFile({ path: error.fileName });
    }

    if (this.state.filesToUpload.length === 0) {
      this.completeUpload();
    } else {
      this.startUpload();
    }
  }

  completeUpload() {
    this.state.isUploading = false;
    this.updateUploadButtonState();
    this.elements.logoutButton.disabled = false;
    this.resetProgress();
  }

  resetProgress() {
    this.elements.uploadProgress.style.width = "0%";
    this.elements.uploadProgress.setAttribute("aria-valuenow", 0);
    this.elements.uploadSpeedDisplay.textContent = "Upload Speed: 0 MB/s";
  }

  updateUploadButtonState() {
    this.elements.uploadButton.disabled =
      this.state.filesToUpload.length === 0 || this.state.isUploading;
    this.elements.dropArea.classList.toggle("disabled", this.state.isUploading);
  }

  async fetchUploadedFiles() {
    try {
      const files = await window.api.listFiles();
      this.renderUploadedFiles(files);
    } catch (error) {
      this.createNotification("Failed to fetch uploaded files", "danger");
    }
  }

  renderUploadedFiles(files) {
    this.elements.uploadedFilesList.innerHTML = "";
    files.forEach((file) => {
      const listItem = document.createElement("li");
      listItem.className =
        "list-group-item d-flex justify-content-between align-items-center";
      listItem.innerHTML = `
        ${file.name}
        <button class="btn btn-sm btn-outline-danger delete-file" data-id="${file.id}">
          <i class="fas fa-trash"></i>
        </button>
      `;

      listItem.querySelector(".delete-file").addEventListener("click", () => {
        this.deleteFile(file.id);
      });

      this.elements.uploadedFilesList.appendChild(listItem);
    });
  }

  async deleteFile(fileId) {
    try {
      await window.api.deleteFile(fileId);
      this.createNotification("File deleted successfully");
      this.fetchUploadedFiles();
    } catch (error) {
      this.createNotification("Failed to delete file", "danger");
    }
  }

  createNotification(message, type = "success") {
    const notification = document.createElement("div");
    notification.className = `alert alert-${type} notification`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.opacity = "0";
      setTimeout(() => notification.remove(), 500);
    }, 3000);
  }
}

new UIManager();
