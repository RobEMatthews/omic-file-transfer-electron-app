require('dotenv').config();
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const uploadFile = require('./uploadFile');
const { listFiles, deleteFile } = require('./fileManager');

// Constants
const TOKEN_STORAGE_PATH = path.join(__dirname, 'tokens.json');
const PROTOCOL = 'electron-app';
const REDIRECT_URI = `${PROTOCOL}://callback`;
const uploadControllers = new Map();
let isLoginInProgress = false;

// Register protocol handler based on environment
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

// Ensure single instance
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  return;
}

// Window management
let mainWindow = null;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const authUrl = buildAuthUrl();
  mainWindow.loadURL(authUrl.toString());

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

// OAuth URL builder
const buildAuthUrl = () => {
  const authUrl = new URL(process.env.AUTHORIZATION_URL);
  authUrl.searchParams.append('client_id', process.env.CLIENT_ID);
  authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.append('response_type', 'code');
  return authUrl;
};

// Token management
const storeTokens = (accessToken, refreshToken, expiresIn) => {
  try {
    const expiryTime = Date.now() + (expiresIn ? expiresIn * 1000 : 3600 * 1000);
    const tokens = { accessToken, refreshToken, expiryTime };
    fs.writeFileSync(TOKEN_STORAGE_PATH, JSON.stringify(tokens), 'utf8');
  } catch (error) {
    console.error('Failed to store tokens:', error);
    throw error;
  }
};

const loadTokens = () => {
  try {
    if (fs.existsSync(TOKEN_STORAGE_PATH)) {
      return JSON.parse(fs.readFileSync(TOKEN_STORAGE_PATH, 'utf8'));
    }
    return null;
  } catch (error) {
    console.error('Failed to load tokens:', error);
    return null;
  }
};

const isAccessTokenValid = (tokens) => {
  return tokens?.expiryTime && Date.now() < tokens.expiryTime;
};

// Token refresh
const refreshAccessToken = async (refreshToken) => {
  try {
    const response = await axios.post(process.env.TOKEN_URL, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET
    });

    const { access_token, refresh_token, expires_in } = response.data;
    storeTokens(access_token, refresh_token, expires_in);
    return access_token;
  } catch (error) {
    console.error('Failed to refresh token:', error);
    throw error;
  }
};

// OAuth callback handling
const handleCallback = async (url) => {
  try {
    const urlObj = new URL(url);
    const code = urlObj.searchParams.get('code');
    if (!code) throw new Error('No authorization code received');

    const requestData = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      redirect_uri: REDIRECT_URI
    });

    const response = await axios.post(process.env.TOKEN_URL, requestData, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const { access_token, refresh_token, expires_in } = response.data;
    storeTokens(access_token, refresh_token, expires_in);
    mainWindow?.loadFile('index.html');
  } catch (error) {
    console.error('Token exchange failed:', error);
    mainWindow?.loadFile('error.html');
  }
};

// File upload handling
const handleUploadFile = async (event, filePath) => {
  try {
    const tokens = loadTokens();
    if (!tokens || !isAccessTokenValid(tokens)) {
      if (tokens?.refreshToken && !isLoginInProgress) {
        isLoginInProgress = true;
        try {
          await refreshAccessToken(tokens.refreshToken);
          isLoginInProgress = false;
          return handleUploadFile(event, filePath);
        } catch (error) {
          isLoginInProgress = false;
          event.reply('upload-error', 'Failed to refresh token. Please log in again.');
          return handleLogout();
        }
      }
      throw new Error('Invalid or expired token');
    }

    const existingController = uploadControllers.get(filePath);
    if (existingController) {
      existingController.abort();
      uploadControllers.delete(filePath);
    }

    const abortController = new AbortController();
    uploadControllers.set(filePath, abortController);

    await uploadFile(filePath, event, abortController, tokens.accessToken);
    uploadControllers.delete(filePath);
  } catch (error) {
    console.error('Upload failed:', error);
    event.reply('upload-error', error.message || 'Upload failed');
    uploadControllers.delete(filePath);
  }
};

// File management handlers
const handleListFiles = async () => {
  const tokens = loadTokens();
  if (!tokens || !isAccessTokenValid(tokens)) {
    throw new Error('Invalid or expired token');
  }
  return await listFiles(tokens.accessToken);
};

const handleDeleteFile = async (event, fileId) => {
  const tokens = loadTokens();
  if (!tokens || !isAccessTokenValid(tokens)) {
    throw new Error('Invalid or expired token');
  }
  return await deleteFile(fileId, tokens.accessToken);
};

const handleCancelUpload = (event, filePath) => {
  const controller = uploadControllers.get(filePath);
  if (controller) {
    controller.abort();
    uploadControllers.delete(filePath);
  }
};

// Logout handling
const handleLogout = () => {
  try {
    if (fs.existsSync(TOKEN_STORAGE_PATH)) {
      fs.unlinkSync(TOKEN_STORAGE_PATH);
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.session.clearStorageData()
        .then(() => {
          mainWindow.close();
          createWindow();
        })
        .catch(error => {
          console.error('Error clearing session:', error);
          mainWindow.close();
          createWindow();
        });
    } else {
      createWindow();
    }
  } catch (error) {
    console.error('Logout failed:', error);
    createWindow();
  }
};

// App event handlers
app.on('ready', () => {
  const tokens = loadTokens();
  if (tokens && isAccessTokenValid(tokens)) {
    mainWindow = new BrowserWindow({
      width: 800,
      height: 600,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    mainWindow.loadFile('index.html');
  } else if (tokens?.refreshToken) {
    refreshAccessToken(tokens.refreshToken)
      .then(() => {
        mainWindow = new BrowserWindow({
          width: 800,
          height: 600,
          webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
          },
        });
        mainWindow.loadFile('index.html');
      })
      .catch(() => createWindow());
  } else {
    createWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleCallback(url);
});

app.on('second-instance', (event, commandLine) => {
  const url = commandLine.pop();
  if (url.startsWith(`${PROTOCOL}://`)) {
    handleCallback(url);
  }

  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// IPC handlers
ipcMain.on('upload-file', handleUploadFile);
ipcMain.on('cancel-upload', handleCancelUpload);
ipcMain.handle('list-files', handleListFiles);
ipcMain.handle('delete-file', handleDeleteFile);
ipcMain.on('logout', handleLogout);

module.exports = app;
