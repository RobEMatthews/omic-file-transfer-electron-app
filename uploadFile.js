require('dotenv').config();
const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');

// Configure AWS SDK
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

async function uploadFile(localPath, event) {
  console.log('Uploading file:', localPath);

  const fileContent = fs.readFileSync(localPath);
  const remotePath = path.basename(localPath);

  const params = {
    Bucket: process.env.AWS_S3_BUCKET,
    Key: remotePath,
    Body: fileContent
  };

  try {
    const upload = s3.upload(params);

    upload.on('httpUploadProgress', (evt) => {
      const progress = Math.round((evt.loaded / evt.total) * 100);
      event.reply('upload-progress', progress);
    });

    const data = await upload.promise();
    console.log('File uploaded successfully', data.Location);
  } catch (err) {
    console.error('Error uploading file', err);
    event.reply('upload-error', err.message);
  }
}

module.exports = uploadFile;
