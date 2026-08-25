// Electron main process for the QRaft desktop app.
//
// Important design notes (read before changing):
//
// 1. We do NOT load the built app via the `file://` protocol. Chromium does
//    not reliably treat `file://` as a secure context, and `getUserMedia`
//    (the camera scanner) silently fails/black-screens on insecure origins.
//    Instead we spin up a tiny local HTTP server on 127.0.0.1 and load
//    `http://localhost:<port>` — localhost is always a secure context, so
//    the camera scanner behaves identically to the browser/dev version.
//
// 2. Electron denies ALL permission requests (camera, clipboard, etc.) by
//    default, even from localhost. We explicitly allow the ones this app
//    actually uses: camera ("media") for the QR scanner, and clipboard
//    read/write for the "copy" buttons. Everything else stays denied.

const { app, BrowserWindow, session, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const isDev = !!process.env.ELECTRON_START_URL;
const DEV_URL = process.env.ELECTRON_START_URL || 'http://localhost:3000';
const DIST_DIR = path.join(__dirname, '..', 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

let mainWindow = null;
let staticServer = null;

/**
 * Serves the built `dist` folder on 127.0.0.1 using an OS-assigned free
 * port, and resolves with the base URL once it's listening.
 */
function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url || '/', 'http://localhost');
        let filePath = decodeURIComponent(requestUrl.pathname);
        if (filePath === '/') filePath = '/index.html';

        const resolved = path.normalize(path.join(DIST_DIR, filePath));
        // Guard against path traversal outside of dist/.
        if (!resolved.startsWith(DIST_DIR)) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }

        fs.readFile(resolved, (err, data) => {
          if (err) {
            // Client-side routing fallback: serve index.html for unknown paths.
            fs.readFile(path.join(DIST_DIR, 'index.html'), (fallbackErr, fallbackData) => {
              if (fallbackErr) {
                res.writeHead(404);
                res.end('Not found');
                return;
              }
              res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] });
              res.end(fallbackData);
            });
            return;
          }
          const ext = path.extname(resolved).toLowerCase();
          res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
          res.end(data);
        });
      } catch (e) {
        res.writeHead(500);
        res.end('Internal error');
      }
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      staticServer = server;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function setUpPermissions() {
  const allowedPermissions = new Set(['media', 'clipboard-read', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(allowedPermissions.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return allowedPermissions.has(permission);
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 720,
    minHeight: 640,
    title: 'QRaft',
    backgroundColor: '#111827',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  Menu.setApplicationMenu(null);

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[QRaft] Window finished loading successfully.');
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('[QRaft] Failed to load app:', errorCode, errorDescription);
  });

  // Open any target="_blank" / window.open links in the OS browser instead
  // of a new Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Toggle DevTools with F12 (no menu bar to hang it off, so bind it directly).
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  if (isDev) {
    await mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const baseUrl = await startStaticServer();
    console.log(`[QRaft] Serving app at ${baseUrl}`);
    await mainWindow.loadURL(baseUrl);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    setUpPermissions();
    await createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (staticServer) staticServer.close();
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    if (staticServer) staticServer.close();
  });
}
