const fs = require('fs');
const path = require('path');
const axios = require('axios');

const MAX_UPLOAD_SPEED_BPS = 100 * 1024 * 1024; // 100 MB/s
const API_BASE_URL = 'https://app.staging.scientist.com/api/v2';

async function uploadFile(localPath, event, abortController, accessToken) {
    console.log(`Starting multipart upload for: ${localPath}`);

    try {
        const fileSize = fs.statSync(localPath).size;
        console.log(`Total file size: ${fileSize} bytes`);

        // First, get the concurrency limit
        const concurrencyResponse = await axios.get(`${API_BASE_URL}/storage/concurrency_limit`, {
            params: { size_hint: fileSize },
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const { concurrency_limit: concurrencyLimit, chunk_size: chunkSize } = concurrencyResponse.data;
        console.log(`Concurrency limit: ${concurrencyLimit}, Chunk size: ${chunkSize}`);

        // Initiate multipart upload
        const initiateResponse = await axios.post(`${API_BASE_URL}/storage/initiate_multipart_upload`,
            { s3_key: path.basename(localPath) },
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        const { upload_id: uploadId } = initiateResponse.data;
        console.log(`Multipart upload initiated with ID: ${uploadId}`);

        // Prepare file reading
        const fileHandle = fs.openSync(localPath, 'r');
        const parts = [];
        let totalBytesUploaded = 0;

        // Upload parts with full file coverage
        const uploadParts = async () => {
            const totalParts = Math.ceil(fileSize / chunkSize);
            console.log(`Total parts to upload: ${totalParts}`);

            for (let partBatch = 0; partBatch < Math.ceil(totalParts / concurrencyLimit); partBatch++) {
                const batchPromises = [];

                // Upload a batch of parts concurrently
                for (let i = 0; i < concurrencyLimit; i++) {
                    const partNumber = partBatch * concurrencyLimit + i + 1;

                    // Stop if we've uploaded all parts
                    if (partNumber > totalParts) break;

                    const promise = (async () => {
                        const start = (partNumber - 1) * chunkSize;
                        const buffer = Buffer.alloc(chunkSize);
                        const bytesRead = fs.readSync(fileHandle, buffer, 0, chunkSize, start);

                        if (bytesRead === 0) return null; // No more data to read

                        // Get presigned URL for this part
                        const presignedUrlResponse = await axios.get(`${API_BASE_URL}/storage/presigned_url_for_part`, {
                            params: {
                                s3_key: path.basename(localPath),
                                part_number: partNumber,
                                upload_id: uploadId
                            },
                            headers: { Authorization: `Bearer ${accessToken}` }
                        });

                        const { url: presignedUrl } = presignedUrlResponse.data;

                        // Upload the part
                        const uploadStart = Date.now();
                        const uploadResponse = await axios.put(presignedUrl, buffer.slice(0, bytesRead), {
                            headers: { 'Content-Type': 'application/octet-stream' },
                            signal: abortController.signal,
                            onUploadProgress: (progressEvent) => {
				const progress = Math.round((totalBytesUploaded / fileSize) * 100);
                                const currentTime = Date.now();
				const elapsedTime = (currentTime - uploadStart) / 1000;
				const uploadSpeed = progressEvent.loaded / elapsedTime;

				event.reply('upload-progress', {
                                    progress,
				    speed: uploadSpeed
                                });
                            }
                        });

                        const elapsedTime = Date.now() - uploadStart;
                        const uploadSpeed = bytesRead / (elapsedTime / 1000);
                        console.log(`Part ${partNumber}/${totalParts} uploaded in ${elapsedTime} ms, ${uploadSpeed / (1024 * 1024)} MB/s`);

                        // Throttle if needed
                        const expectedTime = (bytesRead / MAX_UPLOAD_SPEED_BPS) * 1000;
                        if (elapsedTime < expectedTime) {
                            await new Promise(resolve => setTimeout(resolve, expectedTime - elapsedTime));
                        }

                        return {
                            part_number: partNumber,
                            etag: uploadResponse.headers.etag
                        };
                    })();

                    batchPromises.push(promise);
                }

                // Wait for this batch to complete and collect parts
                const batchParts = await Promise.all(batchPromises);
                parts.push(...batchParts.filter(part => part !== null));
            }

            return parts;
        };

        // Upload all parts
        const uploadedParts = await uploadParts();

        // Close file handle
        fs.closeSync(fileHandle);

        // Sort parts to ensure correct order
        const sortedParts = uploadedParts.sort((a, b) => a.part_number - b.part_number);

        // Complete multipart upload
        await axios.post(`${API_BASE_URL}/storage/complete_multipart_upload`,
            {
                s3_key: path.basename(localPath),
                upload_id: uploadId,
                parts: sortedParts
            },
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        // Create storage object
        await axios.post(`${API_BASE_URL}/storage`, {
            storage_object: {
                name: path.basename(localPath),
                s3_key: path.basename(localPath)
            }
        }, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        event.reply('upload-success', {
	     name: path.basename(localPath),
	     path: localPath
	});
    } catch (error) {
        console.error('Error during multipart upload:', error.response ? error.response.data : error.message);
        event.reply('upload-error', error.message);
    }
}

module.exports = uploadFile;
