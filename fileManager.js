const axios = require('axios');

async function listFiles(accessToken) {
  try {
    const response = await axios.get('https://app.scientist.com/api/v2/storage', {
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
    const response = await axios.delete(`https://app.scientist.com/api/v2/storage/${fileId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    return {
      success: response.status === 200 || response.status === 204,
      fileId: fileId,
      fileName: response.data?.name || 'Unknown File'
    };
  } catch (error) {
    console.error('Error deleting file:', error.message);

    return {
      success: false,
      error: error.response?.data?.message
        || `Deletion failed with status ${error.response?.status}`
        || 'Unknown error',
      fileId: fileId
    };
  }
}

module.exports = { listFiles, deleteFile };

