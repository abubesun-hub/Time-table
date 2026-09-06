// Electron main process
// Minimal, secure default window that loads your existing index.html

const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const isDev = process.env.ELECTRON_START_URL || process.env.NODE_ENV === 'development';

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#121418',
    show: true,
    icon: path.join(__dirname, 'build', 'Jadwaly.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Optional: hide menu for a cleaner look
  win.removeMenu();

  // Open external links in default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const currentURL = win.webContents.getURL();
    if (url !== currentURL && /^https?:\/\//i.test(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  if (isDev && process.env.ELECTRON_START_URL) {
    win.loadURL(process.env.ELECTRON_START_URL);
  } else {
    // Load the landing page as the app entry point
    win.loadFile(path.join(__dirname, 'Main page.html'));
  }

  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Print: generate a PDF from provided HTML and open it with the default viewer (gives a real preview)
// This avoids Windows' system print dialog that often shows "No preview available" and inconsistent scaling.
ipcMain.handle('print:to-pdf', async (event, payload) => {
  try {
    const { html, title = 'Document', pageSize = 'A4', landscape = false } = payload || {};
    // Create an offscreen window to render the HTML
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
      },
    });
    // Load the provided HTML using a data URL
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(String(html || ''));
    await win.loadURL(dataUrl);
    // Give the page a brief moment to finish layout assets (fonts/images inline preferred)
    await new Promise((r) => setTimeout(r, 120));
    const pdf = await win.webContents.printToPDF({
      landscape: !!landscape,
      printBackground: true,
      pageSize: String(pageSize || 'A4').toUpperCase(),
    });
    const tmpDir = os.tmpdir();
    const filePath = path.join(tmpDir, `${(payload && payload.fileNameBase) || 'Jadwaly'}-${Date.now()}.pdf`);
    fs.writeFileSync(filePath, pdf);
    // Open with the default PDF viewer (provides preview and user can print from there)
    await shell.openPath(filePath);
    // Clean up
    setTimeout(() => { try { if (!win.isDestroyed()) win.destroy(); } catch {} }, 0);
    return { ok: true, path: filePath, title };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

// Preview in external browser: write HTML to a temp file and open with the default browser
ipcMain.handle('print:open-in-browser', async (event, payload) => {
  try {
    const { html, fileNameBase = 'Jadwaly', title = 'Preview' } = payload || {};
    const tmpDir = os.tmpdir();
    const safeBase = String(fileNameBase || 'Jadwaly').replace(/[^a-z0-9_-]/gi, '_');
    const filePath = path.join(tmpDir, `${safeBase}-${Date.now()}.html`);
    const fullHtml = String(html || '').replace('</head>', '<meta http-equiv="X-UA-Compatible" content="IE=edge"></head>');
    fs.writeFileSync(filePath, fullHtml, 'utf8');
    // Open with default handler for .html (usually the default browser)
    await shell.openPath(filePath);
    return { ok: true, path: filePath, title };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});
