# omic-file-transfer-electron-app

This app enables users to transfer large files securely.

Sequence Diagram:
Renderer -> Main: upload-file (first file)
Main -> UploadManager: addUpload() to queue
UploadManaher -> UploadManager: processQueue()
UploadManager -> S3: Start upload
S3 -> UploadManager: Upload complete
UploadManager -> Renderer: upload-success
Renderer -> Main: upload-file (next file)
