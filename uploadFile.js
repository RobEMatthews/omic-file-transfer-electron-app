const fs = require('fs');
const path = require('path');
const axios = require('axios');

const MAX_UPLOAD_SPEED_BPS = 100 * 1024 * 1024; // 100 MB/s

async function uploadFile(localPath, event, abortController, accessToken) {
    console.log(`Starting upload for: ${localPath}`);

    try {
        const fileSize = fs.statSync(localPath).size;
        const partSize = 5 * 1024 * 1024; // 5 MB part size
        const numParts = Math.ceil(fileSize / partSize);
        const fileContent = fs.readFileSync(localPath);

        for (let partNumber = 0; partNumber < numParts; partNumber++) {
            const start = partNumber * partSize;
            const end = Math.min(start + partSize, fileSize);
            const partContent = fileContent.slice(start, end);

            console.log(`Requesting presigned URL for part ${partNumber + 1}/${numParts}...`);
            try {
                const response = await axios.get('https://app.staging.scientist.com/api/v2/storage/presigned_url', {
                    params: { s3_key: `${path.basename(localPath)}.part${partNumber + 1}` },
                    headers: { Authorization: `Bearer ${accessToken}` }
                });
                console.log('Presigned URL response:', response.data);
                const presignedUrl = response.data.url;
                console.log(`Received presigned URL for part ${partNumber + 1}: ${presignedUrl}`);

                console.log(`Uploading part ${partNumber + 1}/${numParts}...`);
                
		const startTime = Date.now();

		await axios.put(presignedUrl, partContent, {
                    headers: { 'Content-Type': 'application/octet-stream' },
                    onUploadProgress: (progressEvent) => {
                        const progress = Math.round((progressEvent.loaded / progressEvent.total) * 100);
                        event.reply('upload-progress', { progress });
                        console.log(`Part ${partNumber + 1} progress: ${progress}%`);
                    },
                    signal: abortController.signal,
                });

                const elapsedTime = Date.now() - startTime; // Time in ms
		const uploadSpeedBps = partContent.length / (elapsedTime / 1000); // Bytes per second

		console.log(`Part ${partNumber + 1} uploaded in ${elapsedTime} ms with speed ${uploadSpeedBps / (1024 * 1024)} MB/s`);

                // Calculate expected time for the current part based on the speed limit
                const expectedTime = (partContent.length / MAX_UPLOAD_SPEED_BPS) * 1000; // Expected time in ms

                // Throttle the upload if it was too fast
                if (elapsedTime < expectedTime) {
                    const delay = expectedTime - elapsedTime;
                    console.log(`Throttling for ${delay} ms to maintain upload speed limit...`);
                    await new Promise(resolve => setTimeout(resolve, delay)); // Introduce delay
                }
		
                console.log(`Part ${partNumber + 1} uploaded successfully.`);
            } catch (error) {
                console.error('Error requesting presigned URL or uploading part:', error.response ? error.response.data : error.message);
                throw error;
            }
        }

        // Create a storage object after successful upload
        console.log(`Creating storage object for ${path.basename(localPath)}...`);
        await axios.post('https://app.staging.scientist.com/storage', {
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
