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

    console.log(`File with ID ${fileId} deletion response:`, response.status);

    return {
      success: response.status === 200 || response.status === 204,
      fileId: fileId
    };
  } catch (error) {
    console.error('Error deleting file:', error.message);

    if (error.response) {
      console.error('Server responded with error:', error.response.data);
      return {
        success: false,
        error: error.response.data.message || `Deletion failed with status ${error.response.status}`,
        fileId: fileId
      };
    } else if (error.request) {
      console.error('No response received:', error.request);
      return {
        success: false,
        error: 'No response from server',
        fileId: fileId
      };
    } else {
      console.error('Error setting up request:', error.message);
      return {
        success: false,
        error: error.message,
        fileId: fileId
      };
    }
  }
}

module.exports = { listFiles, deleteFile };

