require("dotenv").config();
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const AuthManager = require("./authManager");
const UploadManager = require("./uploadManager");
const FileManager = require("./fileManager");

class Application {
  constructor() {
    this.window = null;
    this.authManager = new AuthManager();
    this.uploadManager = new UploadManager();
    this.fileManager = new FileManager();
    this.setupProtocol();
    this.setupSingleInstance();
  }

  setupProtocol() {
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient("electron-app", process.execPath, [
          path.resolve(process.argv[1]),
        ]);
      }
    } else {
      app.setAsDefaultProtocolClient("electron-app");
    }
  }

  setupSingleInstance() {
    if (!app.requestSingleInstanceLock()) {
      app.quit();
      return;
    }

    app.on("second-instance", (event, commandLine) => {
      const url = commandLine.pop();
      if (url.startsWith("electron-app://")) {
        this.handleCallback(url);
      }
      if (this.window) {
        if (this.window.isMinimized()) this.window.restore();
        this.window.focus();
      }
    });
  }

  async initialize() {
    await app.whenReady();
    this.setupEventHandlers();
    this.initializeWindow();
  }

  setupEventHandlers() {
    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") {
        app.quit();
      }
    });

    app.on("activate", () => {
      if (!this.window) {
        this.initializeWindow();
      }
    });

    app.on("open-url", (event, url) => {
      event.preventDefault();
      this.handleCallback(url);
    });

    this.setupIpcHandlers();
  }

  setupIpcHandlers() {
    ipcMain.on("upload-file", async (event, filePath) => {
      try {
        const tokens = this.authManager.loadTokens();
        if (!tokens || !this.authManager.isAccessTokenValid(tokens)) {
          if (tokens?.refreshToken) {
            await this.authManager.refreshAccessToken(tokens.refreshToken);
          } else {
            throw new Error("Invalid or expired token");
          }
        }

        const uploadId = this.uploadManager.addUpload({
          path: filePath,
          name: path.basename(filePath),
        });

        this.uploadManager.setCallbacks({
          onProgress: (upload) => {
            event.reply("upload-progress", {
              progress: upload.progress,
              speed: upload.speed / (1024 * 1024), // Convert to MB/s
            });
          },
          onSuccess: (upload) => {
            event.reply("upload-success", {
              name: upload.file.name,
              path: upload.file.path,
            });
          },
          onError: (upload, error) => {
            event.reply("upload-error", {
              message: error.message,
              fileName: upload.file.name,
            });
          },
        });

        await this.uploadManager.startUpload(uploadId);
      } catch (error) {
        event.reply("upload-error", {
          message: error.message,
          fileName: path.basename(filePath),
        });
      }
    });

    ipcMain.on("cancel-upload", (event, filePath) => {
      const upload = this.uploadManager.uploads.find(
        (u) => u.file.path === filePath,
      );
      if (upload) {
        this.uploadManager.cancelUpload(upload.id);
      }
    });

    ipcMain.handle("list-files", async () => {
      const tokens = this.authManager.loadTokens();
      if (!tokens || !this.authManager.isAccessTokenValid(tokens)) {
        throw new Error("Invalid or expired token");
      }
      return this.fileManager.listFiles(tokens.accessToken);
    });

    ipcMain.handle("delete-file", async (event, fileId) => {
      const tokens = this.authManager.loadTokens();
      if (!tokens || !this.authManager.isAccessTokenValid(tokens)) {
        throw new Error("Invalid or expired token");
      }
      return this.fileManager.deleteFile(fileId, tokens.accessToken);
    });

    ipcMain.on("logout", () => {
      this.handleLogout();
    });
  }

  initializeWindow() {
    this.window = new BrowserWindow({
      width: 800,
      height: 600,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    const tokens = this.authManager.loadTokens();
    if (tokens && this.authManager.isAccessTokenValid(tokens)) {
      this.window.loadFile("index.html");
    } else if (tokens?.refreshToken) {
      this.authManager
        .refreshAccessToken(tokens.refreshToken)
        .then(() => this.window.loadFile("index.html"))
        .catch(() =>
          this.window.loadURL(this.authManager.buildAuthUrl().toString()),
        );
    } else {
      this.window.loadURL(this.authManager.buildAuthUrl().toString());
    }
  }

  async handleCallback(url) {
    try {
      await this.authManager.handleCallback(url);
      this.window?.loadFile("index.html");
    } catch (error) {
      console.error("Authentication failed:", error);
      this.window?.loadFile("error.html");
    }
  }

  handleLogout() {
    this.authManager.logout();
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.session
        .clearStorageData()
        .then(() => {
          this.window.close();
          this.initializeWindow();
        })
        .catch((error) => {
          console.error("Error clearing session:", error);
          this.window.close();
          this.initializeWindow();
        });
    } else {
      this.initializeWindow();
    }
  }
}

const mainApp = new Application();
mainApp.initialize().catch(console.error);
