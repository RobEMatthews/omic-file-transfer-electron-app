require("dotenv").config();
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const http = require("http");
const AuthManager = require("./authManager");
const UploadManager = require("./uploadManager");
const FileManager = require("./fileManager");
const log = require("electron-log");

class Application {
  constructor() {
    this.window = null;
    this.authManager = new AuthManager();
    this.uploadManager = new UploadManager();
    this.fileManager = new FileManager();
    this.server = null;
  }

  createWindow() {
    this.window = new BrowserWindow({
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "preload.js"),
      },
    });

    this.window.on("closed", () => {
      this.window = null;
    });
  }

  async initialize() {
    await app.whenReady();
    this.createWindow();
    this.setupEventHandlers();
    this.setupIpcHandlers();
    await this.ensureServerRunning();
    await this.initializeWindow();
  }

  setupEventHandlers() {
    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") app.quit();
    });

    app.on("activate", async () => {
      if (!this.window) {
        this.createWindow();
        await this.initializeWindow();
      }
    });

    app.on("will-quit", () => {
      if (this.server) this.server.close(() => console.log("Server closed."));
    });
  }

  async ensureServerRunning() {
    if (!this.server || !this.server.listening) {
      await new Promise((resolve) => {
        this.startLocalServer();
        this.server.once("listening", resolve);
      });
    }
  }

  startLocalServer() {
    this.server = http.createServer(async (req, res) => {
      if (req.url.startsWith("/callback")) {
        const url = `http://localhost:${this.server.address().port}${req.url}`;
        try {
          await this.authManager.handleCallback(url);
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("Authentication successful! You can close this window.");
          if (this.window) this.window.loadFile("index.html");
        } catch (error) {
          console.error("Authentication failed:", error);
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("Authentication failed. Please try again.");
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    this.server.listen(0, () => {
      const port = this.server.address().port;
      console.log(`Auth server listening on port ${port}`);
      this.authManager.config.port = port;
      this.authManager.redirectUri = `http://localhost:${port}/callback`;
    });
  }

  async initializeWindow() {
    try {
      if (!this.window) {
        this.createWindow();
      }

      const tokens = this.authManager.loadTokens();

      if (tokens && this.authManager.isAccessTokenValid(tokens)) {
        await this.window.loadFile("index.html");
      } else if (tokens?.refreshToken) {
        try {
          await this.authManager.refreshAccessToken(tokens.refreshToken);
          await this.window.loadFile("index.html");
        } catch (error) {
          console.error("Refresh failed:", error);
          const authUrl = this.authManager.buildAuthUrl().toString();
          await this.window.loadURL(authUrl);
        }
      } else {
        const authUrl = this.authManager.buildAuthUrl().toString();
        await this.window.loadURL(authUrl).catch(async () => {
          console.log("Retrying auth initialization...");
          await this.initializeWindow();
        });
      }
    } catch (error) {
      console.error("Window initialization failed:", error);
      if (this.window && !this.window.isDestroyed()) {
        await this.window.loadFile("error.html");
      }
    }
  }

  async handleCallback(url) {
    try {
      await this.authManager.handleCallback(url);
      if (this.window) this.window.loadFile("index.html");

      if (this.server) {
        this.server.close(() => {
          console.log("Server stopped after successful authentication.");
          this.server = null;
        });
      }
    } catch (error) {
      console.error("Authentication failed:", error);
      if (this.window) this.window.loadFile("error.html");
    }
  }

  async handleLogout() {
    this.authManager.logout();

    if (this.server) {
      await new Promise((resolve) => {
        this.server.close(() => {
          console.log("Server closed during logout");
          this.server = null;
          resolve();
        });
      });
    }

    if (this.window && !this.window.isDestroyed()) {
      await this.window.webContents.session.clearStorageData();
      this.window.close();
    }

    await this.ensureServerRunning();
    await this.initializeWindow();
  }

  setupIpcHandlers() {
    ipcMain.on("upload-file", async (event, filePath) => {
      try {
        let tokens = this.authManager.loadTokens();

        if (!tokens || !this.authManager.isAccessTokenValid(tokens)) {
          if (tokens?.refreshToken) {
            await this.authManager.refreshAccessToken(tokens.refreshToken);
            tokens = this.authManager.loadTokens();
          } else {
            await this.handleLogout();
            throw new Error("Invalid or expired token");
          }
        }

        await this.uploadManager.initialize(tokens.accessToken);

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
        if (error.message === "Invalid or expired token") {
          await this.handleLogout();
        }
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
      try {
        const tokens = this.authManager.loadTokens();
        if (!tokens || !this.authManager.isAccessTokenValid(tokens)) {
          await this.handleLogout();
          throw new Error("Invalid or expired token");
        }
        return await this.fileManager.listFiles(tokens.accessToken);
      } catch (error) {
        if (error.message === "Invalid or expired token") {
          await this.handleLogout();
        }
        throw error;
      }
    });

    ipcMain.handle("delete-file", async (_, fileId) => {
      try {
        const tokens = this.authManager.loadTokens();
        if (!tokens || !this.authManager.isAccessTokenValid(tokens)) {
          await this.handleLogout();
          throw new Error("Invalid or expired token");
        }
        return await this.fileManager.deleteFile(fileId, tokens.accessToken);
      } catch (error) {
        if (error.message === "Invalid or expired token") {
          await this.handleLogout();
        }
        throw error;
      }
    });

    ipcMain.on("logout", () => this.handleLogout());
  }
}

const mainApp = new Application();
mainApp.initialize().catch((error) => {
  console.error("Failed to initialize application:", error);
  app.quit();
});
