const axios = require('axios');

async function listFiles(accessToken) {
  try {
    const response = await axios.get('http://app.scientist.com/api/v2/storage', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return response.data;
  } catch (error) {
      console.error('Error listing files:', error.message);
      throw error;
  }
}

async function deleteFile(fileId, accessToken) {
  try {
    await axios.delete(`http://app.scientist.com/api/v2/storage/${fileId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
     });
      console.log(`File with ID ${fileId} deleted successfully.`);
  } catch (error) {
    console.error('Error deleting file:', error.message);
    throw error;
  }
}

module.exports = { listFiles, deleteFile };

