const axios = require('axios');

async function listFiles(accessToken) {
  try {
    const response = await axios.get('https://app.staging.scientist.com/api/v2/storage', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    console.log('List Files Response:', response.data);
    return response.data;
  } catch (error) {
      console.error('Error listing files:', error.message);
      throw error;
  }
}

async function deleteFile(fileId, accessToken) {
  try {
    const response = await axios.delete(`https://app.staging.scientist.com/api/v2/storage/${fileId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (response.status === 200 && !response.data.error) {
      console.log(`File with ID ${fileId} deleted successfully.`);
    } else {
      console.error('Failed to delete file:', response.data);
    }
  } catch (error) {
    console.error('Error deleting file:', error.message);
    throw error;
  }
}

module.exports = { listFiles, deleteFile };

