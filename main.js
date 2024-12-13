require('dotenv').config();
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const express = require('express');
const uploadFile = require('./uploadFile');
const { listFiles, deleteFile } = require('./fileManager');

const TOKEN_STORAGE_PATH = path.join(__dirname, 'tokens.json');
const uploadControllers = new Map();
const SERVER_PORT = 3000;

const createWindow = () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const authUrl = buildAuthUrl();
  console.log('Authorization URL:', authUrl.toString());
  win.loadURL(authUrl.toString());

  win.webContents.on('will-redirect', (event, newUrl) => {
    if (newUrl.startsWith(`http://localhost:${SERVER_PORT}/callback`)) {
      event.preventDefault();
      handleCallback(newUrl, win);
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
};

const buildAuthUrl = () => {
  const authUrl = new URL(process.env.AUTHORIZATION_URL);
  authUrl.searchParams.append('client_id', process.env.CLIENT_ID);
  authUrl.searchParams.append('redirect_uri', `http://localhost:${SERVER_PORT}/callback`);
  authUrl.searchParams.append('response_type', 'code');
  return authUrl;
};

const handleCallback = (callbackUrl, win) => {
  const code = new URL(callbackUrl).searchParams.get('code');
  if (code) exchangeCodeForToken(code, win);
};

const exchangeCodeForToken = (code, win) => {
  const requestData = new URLSearchParams();
  requestData.append('grant_type', 'authorization_code');
  requestData.append('code', code);
  requestData.append('client_id', process.env.CLIENT_ID);
  requestData.append('client_secret', process.env.CLIENT_SECRET);
  requestData.append('redirect_uri', process.env.REDIRECT_URI);

  axios.post(process.env.TOKEN_URL, requestData, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    .then(response => {
      console.log('Token Response:', response.data);
      const { access_token, refresh_token, expires_in } = response.data;
      storeTokens(access_token, refresh_token, expires_in);
      win.loadFile('index.html');
    })
    .catch(error => {
      console.error('Error in token request:', error.response ? error.response.data : error.message);
      handleError(error);
    });
};

const storeTokens = (accessToken, refreshToken, expiresIn) => {
  const expiryTime = Date.now() + (expiresIn ? expiresIn * 1000 : 3600 * 1000);
  const tokens = { accessToken, refreshToken, expiryTime };
  fs.writeFileSync(TOKEN_STORAGE_PATH, JSON.stringify(tokens), 'utf8');
  console.log('Tokens stored locally.');
};

const loadTokens = () => {
  if (fs.existsSync(TOKEN_STORAGE_PATH)) {
    const tokens = JSON.parse(fs.readFileSync(TOKEN_STORAGE_PATH, 'utf8'));
    console.log('Loaded Tokens:', tokens);
    return tokens;
  }
  console.log('No tokens found.');
  return null;
};

const isAccessTokenValid = (tokens) => {
  const isValid = tokens && tokens.expiryTime && Date.now() < tokens.expiryTime;
  console.log('Access Token Valid:', isValid);
  return isValid;
};

const refreshAccessToken = (refreshToken, win) => {
  console.log('Attempting to refresh access token.');
  axios.post(process.env.TOKEN_URL, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET
  })
    .then(response => {
      console.log('New Access Token:', response.data.access_token);
      storeTokens(response.data.access_token, response.data.refresh_token, response.data.expires_in);
      win.loadFile('index.html');
    })
    .catch(error => {
      console.error('Failed to refresh token:', error);
      createWindow();
    });
};

const handleError = (error) => {
  if (error.response) {
    console.error('Error response:', error.response.data);
  } else if (error.request) {
    console.error('No response received:', error.request);
  } else {
    console.error('Error setting up request:', error.message);
  }
};

const startExpressServer = () => {
  const serverApp = express();

  serverApp.get('/callback', (req, res) => {
    const code = req.query.code;
    if (code) {
      console.log('Authorization Code:', code);
      res.redirect('/');
    } else {
      res.send('Authorization failed. No code received.');
    }
  });

  serverApp.listen(SERVER_PORT, () => {
    console.log(`Server listening at http://localhost:${SERVER_PORT}`);
  });
};

const handleUploadFile = (event, filePath) => {
  try {
    const tokens = loadTokens();
    if (!tokens || !isAccessTokenValid(tokens)) {
      throw new Error('Invalid or expired token');
    }
    const abortController = new AbortController();
    uploadControllers.set(filePath, abortController);
    uploadFile(filePath, event, abortController, tokens.accessToken)
      .catch(error => {
        console.error('Upload failed:', error);
        event.reply('upload-error', error.message || 'Upload failed');
      });
  } catch (error) {
    console.error('Upload preparation error:', error);
    event.reply('upload-error', error.message);
  }
};

const handleCancelUpload = (event, filePath) => {
  const abortController = uploadControllers.get(filePath);
  if (abortController) {
    abortController.abort();
    uploadControllers.delete(filePath);
  }
};

const handleListFiles = async () => {
  const tokens = loadTokens();
  if (!tokens || !isAccessTokenValid(tokens)) throw new Error('Invalid or expired token');
  return await listFiles(tokens.accessToken);
};

const handleDeleteFile = async (event, fileId) => {
  const tokens = loadTokens();
  if (!tokens || !isAccessTokenValid(tokens)) throw new Error('Invalid or expired token');
  return await deleteFile(fileId, tokens.accessToken);
};

const handleLogout = (event) => {
  const tokenPath = path.join(__dirname, 'tokens.json');
  if (fs.existsSync(tokenPath)) {
    fs.unlinkSync(tokenPath);
    console.log('Tokens cleared.');
  }

  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    win.webContents.session.clearStorageData().then(() => {
      console.log('Session storage cleared.');
      win.close();
      createWindow();
    }).catch(error => {
      console.error('Error clearing session data:', error);
      win.close();
      createWindow();
    });
  }
};

app.whenReady().then(() => {
  startExpressServer();

  const tokens = loadTokens();
  if (tokens && isAccessTokenValid(tokens)) {
    console.log('Using stored access token.');
    const win = new BrowserWindow({
      width: 800,
      height: 600,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    win.loadFile('index.html');
  } else if (tokens && tokens.refreshToken) {
    refreshAccessToken(tokens.refreshToken);
  } else {
    createWindow();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});


ipcMain.on('upload-file', handleUploadFile);
ipcMain.on('cancel-upload', handleCancelUpload);
ipcMain.handle('list-files', handleListFiles);
ipcMain.handle('delete-file', handleDeleteFile);
ipcMain.on('logout', handleLogout);

