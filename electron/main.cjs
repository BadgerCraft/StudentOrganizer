const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');

app.name = 'ontario-teacher-assessment';

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 960,
    minHeight: 640,
    title: 'Ontario Teacher Assessment & Classroom Suite',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: process.env.NODE_ENV === 'development'
    },
    show: false
  });

  // Remove default menu bar for clean teacher desktop experience
  if (process.env.NODE_ENV !== 'development') {
    if (process.platform === 'darwin') {
      // Native edit roles keep Command-C/V and standard Mac window actions available.
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        { role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }
      ]));
    } else {
      Menu.setApplicationMenu(null);
    }
  }

  // Load packaged local Vite build
  const indexPath = path.join(__dirname, '../dist/index.html');
  const bundleRoot = path.dirname(indexPath);
  // Desktop operation needs no network. Restrict file resources to the bundle.
  mainWindow.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    let allowed = false;
    try {
      const url = new URL(details.url);
      if (url.protocol === 'file:') {
        const relative = path.relative(bundleRoot, fileURLToPath(url));
        allowed = relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
      } else {
        allowed = ['data:', 'blob:'].includes(url.protocol);
      }
    } catch { /* Fail closed. */ }
    callback({ cancel: !allowed });
  });
  mainWindow.loadFile(indexPath);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Security Lockdown: Block unwanted new windows
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  // Security Lockdown: Block foreign navigation
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Only allow file:// protocol within the application bundle
    if (url.split('#')[0] !== pathToFileURL(indexPath).href) {
      event.preventDefault();
    }
  });

  return mainWindow;
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
