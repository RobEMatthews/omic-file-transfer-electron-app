require('dotenv').config();
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const express = require('express');
const uploadFile = require('./uploadFile');
const { listFiles, deleteFile } = require('./fileManager');

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
  const requestData = new URLSearchParams();
  requestData.append('grant_type', 'authorization_code');
  requestData.append('code', code);
  requestData.append('client_id', process.env.CLIENT_ID);
  requestData.append('client_secret', process.env.CLIENT_SECRET);
  requestData.append('redirect_uri', `http://localhost:3000/callback`);

  console.log('Requesting token with data:', requestData); // Log request data

  axios.post(process.env.TOKEN_URL, requestData, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  })
  .then(response => {
    console.log('Token Response:', response.data); // Log response data

    const accessToken = response.data.access_token;
    const refreshToken = response.data.refresh_token;
    const expiresIn = response.data.expires_in;
    
    // Store tokens locally
    storeTokens(accessToken, refreshToken, expiresIn);

    if (win) {
      win.loadFile('index.html');
    }
  })
  .catch(error => {
    console.error('Error in token request:', error.response ? error.response.data : error.message);
    handleError(error);
  });
}

function storeTokens(accessToken, refreshToken, expiresIn) {
  //const defaultExpiryTime = 3600;
  const expiryTime = expiresIn ? Date.now() + expiresIn * 1000 : Date.now() //+ defaultExpiryTime * 1000; // Calculate expiry time in milliseconds
  const tokens = { accessToken, refreshToken, expiryTime };
  fs.writeFileSync(TOKEN_STORAGE_PATH, JSON.stringify(tokens), 'utf8');
  console.log('Tokens stored locally.');
}

function loadTokens() {
  if (fs.existsSync(TOKEN_STORAGE_PATH)) {
    const tokens = JSON.parse(fs.readFileSync(TOKEN_STORAGE_PATH, 'utf8'));
    console.log('Loaded Tokens:', tokens); // Debugging log
    return tokens;
  }
  console.log('No tokens found.'); // Debugging log
  return null;
}

function isAccessTokenValid(tokens) {
  const isValid = tokens && tokens.expiryTime && Date.now() < tokens.expiryTime;
  console.log('Access Token Valid:', isValid); // Debugging log
  return isValid;
  //return true;
}

function refreshAccessToken(refreshToken, win) {
  console.log('Attempting to refresh access token.'); // Debugging log
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
    const tokens = loadTokens();
    if (!tokens || !isAccessTokenValid(tokens)) {
        console.error('Invalid or expired token');
        event.reply('upload-error', 'Invalid or expired token');
        return;
    }
    const abortController = new AbortController();
    uploadControllers.set(filePath, abortController);
    uploadFile(filePath, event, abortController, tokens.accessToken);
});

ipcMain.on('cancel-upload', (event, filePath) => {
  const abortController = uploadControllers.get(filePath);
  if (abortController) {
    abortController.abort();
    uploadControllers.delete(filePath);
  }
});

ipcMain.handle('list-files', async (event) => {
    const tokens = loadTokens();
    if (!tokens || !isAccessTokenValid(tokens)) throw new Error('Invalid or expired token');
    
    return await listFiles(tokens.accessToken);
});

ipcMain.handle('delete-file', async (event, fileId) => {
    const tokens = loadTokens();
    if (!tokens || !isAccessTokenValid(tokens)) throw new Error('Invalid or expired token');
    
    await deleteFile(fileId, tokens.accessToken);
});


