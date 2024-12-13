const fs = require('fs');
const path = require('path');
const axios = require('axios');

const API_BASE_URL = 'https://app.staging.scientist.com/api/v2';
const MAX_UPLOAD_SPEED_BPS = 50 * 1000 * 1000;

async function getConcurrencyLimit(fileSize, accessToken) {
    const response = await axios.get(`${API_BASE_URL}/storage/concurrency_limit`, {
        params: { size_hint: fileSize },
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    return response.data;
}

async function initiateMultipartUpload(localPath, accessToken) {
    const response = await axios.post(`${API_BASE_URL}/storage/initiate_multipart_upload`,
        { s3_key: path.basename(localPath) },
        { headers: { Authorization: `Bearer ${accessToken}` } });
    return response.data.upload_id;
}

async function getPresignedUrl(localPath, partNumber, uploadId, accessToken) {
    const response = await axios.get(`${API_BASE_URL}/storage/presigned_url_for_part`, {
        params: { s3_key: path.basename(localPath), part_number: partNumber, upload_id: uploadId },
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    return response.data.url;
}

async function uploadPart(url, buffer, bytesRead, abortController, event, totalBytesUploaded, fileSize, uploadStart, partNumber) {
    const startTime = Date.now();
    const uploadResponse = await axios.put(url, buffer.slice(0, bytesRead), {
        headers: { 'Content-Type': 'application/octet-stream' },
        signal: abortController.signal,
    });

    const elapsedTime = Date.now() - startTime;
    const uploadSpeed = bytesRead / (elapsedTime / 1000);
    totalBytesUploaded += bytesRead;
    const progress = Math.round((totalBytesUploaded / fileSize) * 100);
    
    console.log(`Part ${partNumber} uploaded: ${progress}% complete at ${(uploadSpeed / (1024 * 1024)).toFixed(2)} MB/s`);

    event.reply('upload-progress', {
        progress,
        speed: (uploadSpeed / (1024 * 1024)).toFixed(2)
    });

    return uploadResponse.headers.etag;
}

async function completeMultipartUpload(localPath, uploadId, parts, accessToken) {
    const sortedParts = parts.sort((a, b) => a.part_number - b.part_number);
    await axios.post(`${API_BASE_URL}/storage/complete_multipart_upload`, {
        s3_key: path.basename(localPath),
        upload_id: uploadId,
        parts: sortedParts
    }, { headers: { Authorization: `Bearer ${accessToken}` } });
}

async function createStorageObject(localPath, accessToken) {
    await axios.post(`${API_BASE_URL}/storage`, {
        storage_object: { name: path.basename(localPath), s3_key: path.basename(localPath) }
    }, { headers: { Authorization: `Bearer ${accessToken}` } });
}

async function uploadFile(localPath, event, abortController, accessToken) {
    try {
        const fileName = path.basename(localPath);
        const fileSize = fs.statSync(localPath).size;
        const { concurrency_limit: concurrencyLimit, chunk_size: chunkSize } = await getConcurrencyLimit(fileSize, accessToken);

        console.log(`File size: ${(fileSize / (1024 * 1024)).toFixed(2)} MB`);
        console.log(`Concurrency limit: ${concurrencyLimit}`);
        console.log(`Chunk size: ${(chunkSize / (1024 * 1024)).toFixed(2)} MB`);

        const uploadId = await initiateMultipartUpload(localPath, accessToken);
        const fileHandle = fs.openSync(localPath, 'r');
        const parts = [];
        const totalParts = Math.ceil(fileSize / chunkSize);

        let totalBytesUploaded = 0;
        console.log(`Total number of parts: ${totalParts}`);

        for (let partBatch = 0; partBatch < Math.ceil(totalParts / concurrencyLimit); partBatch++) {
            const batchPromises = [];

            for (let i = 0; i < concurrencyLimit; i++) {
                const partNumber = partBatch * concurrencyLimit + i + 1;
                if (partNumber > totalParts) break;

                const promise = (async (partNumber) => {
                    const start = (partNumber - 1) * chunkSize;
                    const buffer = Buffer.alloc(chunkSize);
                    const bytesRead = fs.readSync(fileHandle, buffer, 0, chunkSize, start);
                    if (bytesRead === 0) return null;

                    const presignedUrl = await getPresignedUrl(localPath, partNumber, uploadId, accessToken);
                    const uploadStart = Date.now();
                    const etag = await uploadPart(presignedUrl, buffer, bytesRead, abortController, event, totalBytesUploaded, fileSize, uploadStart, partNumber);

                    totalBytesUploaded += bytesRead;
                    const progress = Math.round((totalBytesUploaded / fileSize) * 100);
                    console.log(`Total progress: ${progress}% complete`);

                    const elapsedTime = Date.now() - uploadStart;
                    const expectedTime = (bytesRead / MAX_UPLOAD_SPEED_BPS) * 1000;
                    if (elapsedTime < expectedTime) {
                        await new Promise(resolve => setTimeout(resolve, expectedTime - elapsedTime));
                    }

                    return { part_number: partNumber, etag };
                })(partNumber);

                batchPromises.push(promise);
            }

            const batchParts = await Promise.all(batchPromises);
            parts.push(...batchParts.filter(part => part !== null));
        }

        fs.closeSync(fileHandle);
        await completeMultipartUpload(localPath, uploadId, parts, accessToken);
        await createStorageObject(localPath, accessToken);

        event.reply('upload-success', { name: path.basename(localPath), path: localPath });
    } catch (error) {
        event.reply('upload-error', error.message);
    }
}

module.exports = uploadFile;

