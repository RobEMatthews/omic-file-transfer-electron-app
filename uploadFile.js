const fs = require('fs');
const path = require('path');
const axios = require('axios');

async function uploadFile(localPath, event, abortController, accessToken) {
  console.log(`Starting upload for: ${localPath}`);

  try {
    const fileSize = fs.statSync(localPath).size;
    const partSize = 5 * 1024 * 1024; // 5 MB part size
    const numParts = Math.ceil(fileSize / partSize);
    const fileContent = fs.readFileSync(localPath);

    // Upload each part
    for (let partNumber = 0; partNumber < numParts; partNumber++) {
      const start = partNumber * partSize;
      const end = Math.min(start + partSize, fileSize);
      const partContent = fileContent.slice(start, end);

      // Request a presigned URL for each part
      console.log(`Requesting presigned URL for part ${partNumber + 1}/${numParts}...`);
      const response = await axios.get('http://app.scientist.com/api/v2/storage/presigned_url', {
        params: { s3_key: `${path.basename(localPath)}.part${partNumber + 1}` },
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const presignedUrl = response.data.url;
      console.log(`Received presigned URL for part ${partNumber + 1}: ${presignedUrl}`);

      // Upload the part
      console.log(`Uploading part ${partNumber + 1}/${numParts}...`);
      await axios.put(presignedUrl, partContent, {
        headers: { 'Content-Type': 'application/octet-stream' },
        onUploadProgress: (progressEvent) => {
          const progress = Math.round((progressEvent.loaded / progressEvent.total) * 100);
          event.reply('upload-progress', { progress });
          console.log(`Part ${partNumber + 1} progress: ${progress}%`);
        },
        signal: abortController.signal,
      });
      console.log(`Part ${partNumber + 1} uploaded successfully.`);
    }

    // Create a storage object after successful upload
    console.log(`Creating storage object for ${path.basename(localPath)}...`);
    await axios.post('http://app.scientist.com/storage', {
      storage_object: { name: path.basename(localPath), s3_key: path.basename(localPath) }
    }, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    console.log(`Storage object for ${path.basename(localPath)} created successfully.`);

    event.reply('upload-success', path.basename(localPath));
  } catch (error) {
    console.error('Error uploading file:', error.message);
    event.reply('upload-error', error.message);
  }
}

module.exports = uploadFile;

