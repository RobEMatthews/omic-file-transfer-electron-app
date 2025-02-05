const fs = require("fs");
const path = require("path");
const axios = require("axios");
const log = require("electron-log");

class AuthManager {
  constructor(config) {
    this.config = {
      tokenStoragePath: path.join(__dirname, "tokens.json"),
      port: null,
      ...config,
    };
    this.redirectUri = null;
  }

  buildAuthUrl() {
    if (!this.redirectUri) {
      throw new Error("Redirect URI not initialized");
    }

    const authUrl = new URL(process.env.AUTHORIZATION_URL);
    authUrl.searchParams.append("client_id", process.env.CLIENT_ID);
    authUrl.searchParams.append("redirect_uri", this.redirectUri);
    authUrl.searchParams.append("response_type", "code");
    return authUrl;
  }

  async handleCallback(url) {
    const urlObj = new URL(url);
    const code = urlObj.searchParams.get("code");
    if (!code) throw new Error("No authorization code received");

    const requestData = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      redirect_uri: this.redirectUri,
    });

    const response = await axios.post(process.env.TOKEN_URL, requestData, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const { access_token, refresh_token, expires_in } = response.data;
    this.storeTokens(access_token, refresh_token, expires_in);
    return access_token;
  }

  storeTokens(accessToken, refreshToken, expiresIn) {
    const expiryTime =
      Date.now() + (expiresIn ? expiresIn * 1000 : 3600 * 1000);
    const tokens = { accessToken, refreshToken, expiryTime };
    fs.writeFileSync(
      this.config.tokenStoragePath,
      JSON.stringify(tokens),
      "utf8",
    );
  }

  loadTokens() {
    try {
      if (fs.existsSync(this.config.tokenStoragePath)) {
        return JSON.parse(
          fs.readFileSync(this.config.tokenStoragePath, "utf8"),
        );
      }
      return null;
    } catch (error) {
      console.error("Failed to load tokens:", error);
      return null;
    }
  }

  isAccessTokenValid(tokens) {
    return tokens?.expiryTime && Date.now() < tokens.expiryTime;
  }

  async refreshAccessToken(refreshToken) {
    try {
      const response = await axios.post(process.env.TOKEN_URL, {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
      });

      const { access_token, refresh_token, expires_in } = response.data;
      this.storeTokens(access_token, refresh_token, expires_in);
      return access_token;
    } catch (error) {
      log.error(
        "Refresh token request failed:",
        error.response?.data || error.message,
      );
      throw error;
    }
  }

  logout() {
    if (fs.existsSync(this.config.tokenStoragePath)) {
      fs.unlinkSync(this.config.tokenStoragePath);
    }
  }
}

module.exports = AuthManager;
