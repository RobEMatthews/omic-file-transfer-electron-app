class FileManager {
  constructor(config) {
    this.config = {
      apiBaseUrl: 'https://app.scientist.com/api/v2',
      ...config
    };
  }

  async listFiles(accessToken) {
    try {
      const response = await axios.get(
        `${this.config.apiBaseUrl}/storage`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      return response.data;
    } catch (error) {
      console.error('Error listing files:', error);
      throw error;
    }
  }

  async deleteFile(fileId, accessToken) {
    try {
      const response = await axios.delete(
        `${this.config.apiBaseUrl}/storage/${fileId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      return {
        success: response.status === 200 || response.status === 204,
        fileId,
        fileName: response.data?.name || 'Unknown File'
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || 'Unknown error',
        fileId
      };
    }
  }
}

module.exports = FileManager;
