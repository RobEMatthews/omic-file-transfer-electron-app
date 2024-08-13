require('dotenv').config();
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const express = require('express');
const uploadFile = require('./uploadFile');

const uploadControllers = new Map();
const TOKEN_STORAGE_PATH = path.join(__dirname, 'tokens.json');

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

  // Use fixed port 3000
  const actualPort = 3000;
  const authUrl = new URL(process.env.AUTHORIZATION_URL);
  authUrl.searchParams.append('client_id', process.env.CLIENT_ID);
  authUrl.searchParams.append('redirect_uri', `http://localhost:${actualPort}/callback`);
  authUrl.searchParams.append('response_type', 'code');
  console.log('Authorization URL:', authUrl.toString());

  // Load the authorization URL in the Electron window
  win.loadURL(authUrl.toString());

  // Listen for navigation events to handle the callback
  win.webContents.on('will-redirect', (event, newUrl) => {
    if (newUrl.startsWith(`http://localhost:${actualPort}/callback`)) {
      event.preventDefault();
      handleCallback(newUrl, win);
    }
  });

  // Clean up the app when all windows are closed
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
};

function handleCallback(callbackUrl, win) {
  const parsedUrl = new URL(callbackUrl);
  const code = parsedUrl.searchParams.get('code');

  if (code) {
    exchangeCodeForToken(code, win);
  }
}

function exchangeCodeForToken(code, win) {
  axios.post(process.env.TOKEN_URL, {
    grant_type: 'authorization_code',
    code: code,
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
    redirect_uri: `http://localhost:3000/callback`
  })
  .then(response => {
    console.log('Access Token:', response.data.access_token);
    const refreshToken = response.data.refresh_token;
    const expiresIn = response.data.expires_in;

    // Store tokens locally
    storeTokens(response.data.access_token, refreshToken, expiresIn);

    if (win) {
      win.loadFile('index.html');
    }
  })
  .catch(error => {
    handleError(error);
  });
}

function storeTokens(accessToken, refreshToken, expiresIn) {
  const expiryTime = Date.now() + expiresIn * 1000; // Calculate expiry time in milliseconds
  const tokens = { accessToken, refreshToken, expiryTime };
  fs.writeFileSync(TOKEN_STORAGE_PATH, JSON.stringify(tokens), 'utf8');
  console.log('Tokens stored locally.');
}

function loadTokens() {
  if (fs.existsSync(TOKEN_STORAGE_PATH)) {
    const tokens = JSON.parse(fs.readFileSync(TOKEN_STORAGE_PATH, 'utf8'));
    return tokens;
  }
  return null;
}

function isAccessTokenValid(tokens) {
  return tokens && tokens.expiryTime && Date.now() < tokens.expiryTime;
}

function refreshAccessToken(refreshToken, win) {
  axios.post(process.env.TOKEN_URL, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET
  })
  .then(response => {
    console.log('New Access Token:', response.data.access_token);
    storeTokens(response.data.access_token, response.data.refresh_token, response.data.expires_in);

    if (win) {
      win.loadFile('index.html');
    }
  })
  .catch(error => {
    console.error('Failed to refresh token:', error);
    // If refresh fails, redirect to login
    createWindow();
  });
}

function handleError(error) {
  if (error.response) {
    console.error('Error response:', error.response.data);
  } else if (error.request) {
    console.error('No response received:', error.request);
  } else {
    console.error('Error setting up request:', error.message);
  }
}

app.whenReady().then(() => {
  // Start the local server using Express
  const serverApp = express();
  const port = 3000;

  serverApp.get('/callback', (req, res) => {
    const code = req.query.code;
    if (code) {
      console.log('Authorization Code:', code);
      res.send('Authorization successful! You can close this window.');
    } else {
      res.send('Authorization failed. No code received.');
    }
  });

  serverApp.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
  });

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

ipcMain.on('upload-file', (event, filePath) => {
  const abortController = new AbortController();
  uploadControllers.set(filePath, abortController);
  uploadFile(filePath, event, abortController);
});

ipcMain.on('cancel-upload', (event, filePath) => {
  const abortController = uploadControllers.get(filePath);
  if (abortController) {
    abortController.abort();
    uploadControllers.delete(filePath);
  }
});
