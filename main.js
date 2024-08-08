const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const uploadFile = require('./uploadFile');

const uploadControllers = new Map(); // Initialize the map

const createWindow = () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, // Disable Node.js integration
      contextIsolation: true, // Enable context isolation
    },
  });

  win.loadFile('index.html');
};

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
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

