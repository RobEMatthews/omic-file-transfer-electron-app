const fs = require('fs');
const path = require('path');
const axios = require('axios');

const API_BASE_URL = 'https://app.staging.scientist.com/api/v2';

async function uploadFile(localPath, event, abortController, accessToken) {
    try {
        const fileName = path.basename(localPath);
        const fileSize = fs.statSync(localPath).size;

        const concurrencyResponse = await axios.get(
            `${API_BASE_URL}/storage/concurrency_limit?size_hint=${fileSize}`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        const { concurrency_limit: concurrencyLimit, chunk_size: chunkSize } = concurrencyResponse.data;

        // Initiate multipart upload
        const initiateResponse = await axios.post(
            `${API_BASE_URL}/storage/initiate_multipart_upload`,
            { s3_key: fileName },
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        const { upload_id: uploadId } = initiateResponse.data;
        const fileHandle = fs.openSync(localPath, 'r');
        const parts = [];
        let totalBytesUploaded = 0;

        const uploadParts = async () => {
            const totalParts = Math.ceil(fileSize / chunkSize);

            for (let partBatch = 0; partBatch < Math.ceil(totalParts / concurrencyLimit); partBatch++) {
                const batchPromises = [];

                for (let i = 0; i < concurrencyLimit; i++) {
                    const partNumber = partBatch * concurrencyLimit + i + 1;
                    if (partNumber > totalParts) break;

                    const promise = (async () => {
                        const start = (partNumber - 1) * chunkSize;
                        const buffer = Buffer.alloc(chunkSize);
                        const bytesRead = fs.readSync(fileHandle, buffer, 0, chunkSize, start);

                        if (bytesRead === 0) return null;

                        // Get presigned URL
                        const presignedUrlResponse = await axios.get(
                            `${API_BASE_URL}/storage/presigned_url_for_part`,
                            {
                                params: {
                                    s3_key: fileName,
                                    part_number: partNumber,
                                    upload_id: uploadId
                                },
                                headers: { Authorization: `Bearer ${accessToken}` }
                            }
                        );

                        const { url: presignedUrl } = presignedUrlResponse.data;

                        // Upload part with progress tracking
                        const uploadStart = Date.now();
                        const uploadResponse = await axios.put(
                            presignedUrl,
                            buffer.slice(0, bytesRead),
                            {
                                headers: { 'Content-Type': 'application/octet-stream' },
                                signal: abortController.signal,

				onUploadProgress: (progressEvent) => {
     				    const loadedBytes = progressEvent.loaded || 0;
      				    totalBytesUploaded += loadedBytes;

        			    const progress = Math.round((totalBytesUploaded / fileSize) * 100);
        			    const currentTime = Date.now();
        			    const elapsedSeconds = Math.max((currentTime - uploadStart) / 1000, 0.001);

        			    const uploadSpeedBytes = totalBytesUploaded / elapsedSeconds;
       				    const uploadSpeedMBps = uploadSpeedBytes / (1024 * 1024);

        			    event.reply('upload-progress', { progress, speed: uploadSpeedMBps });
   			       }
                            }
                        );

                        return {
                            part_number: partNumber,
                            etag: uploadResponse.headers.etag
                        };
                    })();

                    batchPromises.push(promise);
                }

                const batchParts = await Promise.all(batchPromises);
                parts.push(...batchParts.filter(part => part !== null));
            }

            return parts;
        };

        // Upload parts
        const uploadedParts = await uploadParts();
        fs.closeSync(fileHandle);

        // Complete multipart upload
        await axios.post(
            `${API_BASE_URL}/storage/complete_multipart_upload`,
            {
                s3_key: fileName,
                upload_id: uploadId,
                parts: uploadedParts.sort((a, b) => a.part_number - b.part_number)
            },
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        // Create storage object
        await axios.post(
            `${API_BASE_URL}/storage`,
            {
                storage_object: {
                    name: fileName,
                    s3_key: fileName
                }
            },
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        event.reply('upload-success', {
            name: fileName,
            path: localPath
        });

    } catch (error) {
        console.error('Upload error:', error);
        event.reply('upload-error', error.message || 'Upload failed');
    }
}

module.exports = uploadFile;
