require("dotenv").config();
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const http = require("http");
const AuthManager = require("./authManager");
const UploadManager = require("./uploadManager");
const FileManager = require("./fileManager");

class Application {
  constructor() {
    this.window = null;
    this.authManager = new AuthManager();
    this.uploadManager = new UploadManager();
    this.fileManager = new FileManager();
    this.server = null; // HTTP server for localhost callback
  }

  async initialize() {
    await app.whenReady();
    this.setupEventHandlers();
    this.startLocalServer();
    this.initializeWindow();
  }

  setupEventHandlers() {
    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") app.quit();
    });

    app.on("activate", () => {
      if (!this.window) this.initializeWindow();
    });

    app.on("will-quit", () => {
      if (this.server) this.server.close(() => console.log("Server closed."));
    });
  }

  startLocalServer() {
    this.server = http.createServer(async (req, res) => {
      if (req.url.startsWith("/callback")) {
        const url = `http://localhost:${this.authManager.config.port}${req.url}`;
        try {
          await this.authManager.handleCallback(url);
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("Authentication successful! You can close this window.");
          if (this.window) this.window.loadFile("index.html");
        } catch (error) {
          console.error("Authentication failed:", error);
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("Authentication failed. Please try again.");
          if (this.window) this.window.loadFile("error.html");
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    const port = this.authManager.config.port;

    this.server.listen(port, () =>
      console.log(`Server listening on http://localhost:${port}`),
    );
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
      if (this.window) this.window.loadFile("index.html");
    } catch (error) {
      console.error("Authentication failed:", error);
      if (this.window) this.window.loadFile("error.html");
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

  setupIpcHandlers() {
    ipcMain.on("upload-file", async (event, filePath) => {
      try {
        const tokens = this.authManager.loadTokens();
        if (!tokens || !this.authManager.isAccessTokenValid(tokens)) {
          if (tokens?.refreshToken) {
            await this.authManager.refreshAccessToken(tokens.refreshToken);
          } else throw new Error("Invalid or expired token");
        }

        const uploadId = this.uploadManager.addUpload({
          path: filePath,
          name: path.basename(filePath),
        });

        this.uploadManager.setCallbacks({
          onProgress: (upload) =>
            event.reply("upload-progress", {
              progress: upload.progress,
              speed: upload.speed / (1024 * 1024), // Convert to MB/s
            }),
          onSuccess: (upload) =>
            event.reply("upload-success", {
              name: upload.file.name,
              path: upload.file.path,
            }),
          onError: (upload, error) =>
            event.reply("upload-error", {
              message: error.message,
              fileName: upload.file.name,
            }),
        });

        await this.uploadManager.startUpload(uploadId);
      } catch (error) {
        event.reply("upload-error", { message: error.message });
      }
    });

    ipcMain.on("cancel-upload", (event, filePath) => {
      const upload = this.uploadManager.uploads.find(
        (u) => u.file.path === filePath,
      );
      if (upload) this.uploadManager.cancelUpload(upload.id);
    });

    ipcMain.handle("list-files", async () => {
      const tokens = this.authManager.loadTokens();
      if (!tokens || !this.authManager.isAccessTokenValid(tokens)) {
        throw new Error("Invalid or expired token");
      }
      return await this.fileManager.listFiles(tokens.accessToken);
    });

    ipcMain.handle("delete-file", async (_, fileId) => {
      const tokens = this.authManager.loadTokens();
      if (!tokens || !this.authManager.isAccessTokenValid(tokens)) {
        throw new Error("Invalid or expired token");
      }
      return await this.fileManager.deleteFile(fileId, tokens.accessToken);
    });

    ipcMain.on("logout", () => this.handleLogout());
  }
}

const mainApp = new Application();
mainApp.initialize().catch(console.error);
