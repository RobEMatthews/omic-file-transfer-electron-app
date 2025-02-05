const axios = require("axios");
const fs = require("fs");
const path = require("path");
const log = require("electron-log");

class UploadManager {
  constructor(config) {
    this.uploads = [];
    this.errors = [];
    this.config = {
      apiBaseUrl: "https://app.scientist.com/api/v2",
      maxUploadSpeedBps: 50 * 1000 * 1000,
      ...config,
    };
    this.accessToken = null;
    this.concurrencyLimit = null;
    this.chunkSize = null;
    this.onProgressCallback = null;
    this.onSuccessCallback = null;
    this.onErrorCallback = null;
  }

  async initialize(accessToken) {
    this.accessToken = accessToken;
    await this.updateConcurrencyLimit();
  }

  setCallbacks({ onProgress, onSuccess, onError }) {
    this.onProgressCallback = onProgress;
    this.onSuccessCallback = onSuccess;
    this.onErrorCallback = onError;
  }

  async updateConcurrencyLimit() {
    try {
      const response = await axios.get(
        `${this.config.apiBaseUrl}/storage/concurrency_limit`,
        {
          params: { size_hint: 1024 * 1024 * 100 }, // 100MB default size hint
          headers: { Authorization: `Bearer ${this.accessToken}` },
        },
      );
      this.concurrencyLimit = response.data.concurrency_limit;
      this.chunkSize = response.data.chunk_size;
    } catch (error) {
      throw new Error(`Failed to get concurrency limit: ${error.message}`);
    }
  }

  addUpload(file) {
    const upload = {
      id: Date.now().toString(),
      file,
      status: "pending",
      progress: 0,
      speed: 0,
      uploadId: null,
      parts: [],
      controller: new AbortController(),
    };
    this.uploads.push(upload);
    return upload.id;
  }

  removeUpload(uploadId) {
    const index = this.uploads.findIndex((u) => u.id === uploadId);
    if (index !== -1) {
      const upload = this.uploads[index];
      if (upload.status === "uploading") {
        upload.controller.abort();
      }
      this.uploads.splice(index, 1);
    }
  }

  async startUpload(uploadId) {
    const upload = this.uploads.find((u) => u.id === uploadId);
    if (!upload || upload.status === "uploading") return;

    try {
      upload.status = "uploading";
      await this._processUpload(upload);
    } catch (error) {
      this._handleError(upload, error);
    }
  }

  async startAllUploads() {
    const pendingUploads = this.uploads.filter((u) => u.status === "pending");
    return Promise.all(pendingUploads.map((u) => this.startUpload(u.id)));
  }

  cancelUpload(uploadId) {
    const upload = this.uploads.find((u) => u.id === uploadId);
    if (upload && upload.status === "uploading") {
      upload.controller.abort();
      upload.status = "canceled";
      this._handleError(upload, new Error("Upload canceled"));
    }
  }

  cancelAllUploads() {
    this.uploads.forEach((upload) => {
      if (upload.status === "uploading") {
        upload.controller.abort();
        upload.status = "canceled";
      }
    });
  }

  async _processUpload(upload) {
    const { file } = upload;
    const fileSize = fs.statSync(file.path).size;

    upload.uploadId = await this._initiateMultipartUpload(file.path);
    const totalParts = Math.ceil(fileSize / this.chunkSize);

    for (
      let partBatch = 0;
      partBatch < Math.ceil(totalParts / this.concurrencyLimit);
      partBatch++
    ) {
      const batchPromises = [];

      for (let i = 0; i < this.concurrencyLimit; i++) {
        const partNumber = partBatch * this.concurrencyLimit + i + 1;
        if (partNumber > totalParts) break;

        batchPromises.push(this._uploadPart(upload, partNumber, fileSize));
      }

      const batchResults = await Promise.all(batchPromises);
      upload.parts.push(...batchResults.filter(Boolean));
    }

    await this._completeUpload(upload);
    this._handleSuccess(upload);
  }

  async _initiateMultipartUpload(filePath) {
    const response = await axios.post(
      `${this.config.apiBaseUrl}/storage/initiate_multipart_upload`,
      { s3_key: path.basename(filePath) },
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );
    return response.data.upload_id;
  }

  async _uploadPart(upload, partNumber, fileSize) {
    const { file, controller } = upload;
    const start = (partNumber - 1) * this.chunkSize;

    let fileHandle;
    try {
      fileHandle = await fs.promises.open(file.path, "r");
      const buffer = Buffer.alloc(this.chunkSize);
      const { bytesRead } = await fileHandle.read(
        buffer,
        0,
        this.chunkSize,
        start,
      );
      if (bytesRead === 0) return null;

      const url = await this._getPresignedUrl(
        file.path,
        partNumber,
        upload.uploadId,
      );
      const startTime = Date.now();

      const response = await axios.put(url, buffer.slice(0, bytesRead), {
        headers: { "Content-Type": "application/octet-stream" },
        signal: controller.signal,
      });

      this._updateProgress(upload, bytesRead, fileSize, startTime);
      return {
        part_number: partNumber,
        etag: response.headers.etag,
      };
    } catch (error) {
      throw error;
    } finally {
      if (fileHandle) await fileHandle.close();
    }
  }

  async _getPresignedUrl(filePath, partNumber, uploadId) {
    const response = await axios.get(
      `${this.config.apiBaseUrl}/storage/presigned_url_for_part`,
      {
        params: {
          s3_key: path.basename(filePath),
          part_number: partNumber,
          upload_id: uploadId,
        },
        headers: { Authorization: `Bearer ${this.accessToken}` },
      },
    );
    return response.data.url;
  }

  async _completeUpload(upload) {
    const { file, uploadId, parts } = upload;
    await axios.post(
      `${this.config.apiBaseUrl}/storage/complete_multipart_upload`,
      {
        s3_key: path.basename(file.path),
        upload_id: uploadId,
        parts: parts.sort((a, b) => a.part_number - b.part_number),
      },
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );

    await this._createStorageObject(file.path);
  }

  async _createStorageObject(filePath) {
    await axios.post(
      `${this.config.apiBaseUrl}/storage`,
      {
        storage_object: {
          name: path.basename(filePath),
          s3_key: path.basename(filePath),
        },
      },
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );
  }

  _updateProgress(upload, bytesUploaded, totalSize, startTime) {
    const elapsedTime = (Date.now() - startTime) / 1000;
    const speed = bytesUploaded / elapsedTime;
    const progress = Math.round((bytesUploaded / totalSize) * 100);

    upload.progress = progress;
    upload.speed = speed;

    if (this.onProgressCallback) {
      this.onProgressCallback(upload);
    }
  }

  _handleSuccess(upload) {
    upload.status = "completed";
    upload.progress = 100;
    if (this.onSuccessCallback) {
      this.onSuccessCallback(upload);
    }
  }

  _handleError(upload, error) {
    upload.status = "failed";
    upload.error = error.message;
    this.errors.push({
      uploadId: upload.id,
      fileName: upload.file.name,
      error: error.message,
    });
    if (this.onErrorCallback) {
      this.onErrorCallback(upload, error);
    }
  }
}

module.exports = UploadManager;
