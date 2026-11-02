const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Ensures the app groups correctly on the Windows taskbar and uses our icon
// rather than the generic Electron icon, even before the window paints.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.quodepalette.ico');
}

// icon.ico ships inside the asar via the "extraResources"/"files" config
// (see package.json), so it is present at runtime both in dev and in the
// packaged app - not just baked into the .exe's own resource section.
const ICON_PATH = path.join(__dirname, '..', 'build', 'icon.ico');

const LOG_PATH = path.join(app.getPath('userData'), 'quode-palette-ico-error.log');
function logError(label, err) {
  try {
    var line = '[' + new Date().toISOString() + '] ' + label + ': ' +
      (err && err.stack ? err.stack : String(err)) + os.EOL;
    fs.appendFileSync(LOG_PATH, line);
  } catch (e) { /* best effort only, never let logging itself crash the app */ }
  console.error(label, err);
}

// Catch anything unexpected in the main process so a bug here shows up as
// a real, visible error instead of silently leaving a blank window.
process.on('uncaughtException', function (err) { logError('uncaughtException', err); });

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 900,
    minWidth: 640,
    minHeight: 600,
    backgroundColor: '#14161b',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // Load the UI FIRST. Everything else (icon, menu) is best-effort and must
  // never be able to prevent the page from loading - a earlier version set
  // the icon before this call, and if that threw, loadFile() never ran,
  // producing exactly a blank window with just the configured background
  // color and the app's default title. Order matters.
  mainWindow.loadFile(path.join(__dirname, 'index.html')).catch(function (err) {
    logError('loadFile failed', err);
  });

  mainWindow.removeMenu();

  // Best-effort icon set for dev/unpackaged runs (Linux/macOS taskbars, and
  // Windows dev-mode via `npm start`). On a packaged Windows build the icon
  // embedded in the .exe by electron-builder already handles title bar and
  // taskbar regardless of whether this succeeds.
  try {
    if (fs.existsSync(ICON_PATH)) {
      mainWindow.setIcon(ICON_PATH);
    }
  } catch (err) {
    logError('setIcon failed (non-fatal)', err);
  }

  // If the page fails to load for any reason, show a real error instead of
  // a silent blank/black window.
  mainWindow.webContents.on('did-fail-load', function (event, errorCode, errorDescription, validatedURL) {
    logError('did-fail-load', new Error(errorCode + ' ' + errorDescription + ' (' + validatedURL + ')'));
    var safeMsg = String(errorDescription || 'Unknown error').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
    mainWindow.loadURL(
      'data:text/html;charset=utf-8,' + encodeURIComponent(
        '<html><body style="background:#14161b;color:#ff8f7a;font-family:Consolas,monospace;padding:24px;">' +
        '<h2>Quode Palette ICO failed to load</h2>' +
        '<p>' + safeMsg + ' (code ' + errorCode + ')</p>' +
        '<p style="color:#9a9fab;">A log has been written to:<br>' + LOG_PATH.replace(/\\/g, '\\\\') + '</p>' +
        '</body></html>'
      )
    );
  });

  // If the renderer process itself crashes (not just a load failure), log it
  // too rather than leaving a silently blank window.
  mainWindow.webContents.on('render-process-gone', function (event, details) {
    logError('render-process-gone', new Error(JSON.stringify(details)));
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch(function (err) {
  logError('app.whenReady failed', err);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC: native "Save As" dialog + disk write for the generated .ico ----
ipcMain.handle('save-ico', async (event, { base64, suggestedName }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showSaveDialog(win, {
    title: 'Save ICO File',
    defaultPath: suggestedName || 'favicon.ico',
    filters: [
      { name: 'Icon files', extensions: ['ico'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePath) {
    return { ok: false, canceled: true };
  }

  try {
    const buffer = Buffer.from(base64, 'base64');
    fs.writeFileSync(result.filePath, buffer);
    return { ok: true, path: result.filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ---- IPC: native "Save As" dialog + disk write for a single extracted PNG ----
ipcMain.handle('save-png', async (event, { base64, suggestedName }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showSaveDialog(win, {
    title: 'Save PNG File',
    defaultPath: suggestedName || 'icon.png',
    filters: [
      { name: 'PNG files', extensions: ['png'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePath) {
    return { ok: false, canceled: true };
  }

  try {
    const buffer = Buffer.from(base64, 'base64');
    fs.writeFileSync(result.filePath, buffer);
    return { ok: true, path: result.filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ---- IPC: native "choose folder" dialog + write every extracted PNG resolution ----
ipcMain.handle('save-png-batch', async (event, { files }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose a folder to save PNGs into',
    properties: ['openDirectory', 'createDirectory']
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return { ok: false, canceled: true };
  }

  const folder = result.filePaths[0];
  const saved = [];
  try {
    for (const f of files) {
      const safeName = String(f.name).replace(/[\\/:*?"<>|]/g, '_');
      const dest = path.join(folder, safeName);
      fs.writeFileSync(dest, Buffer.from(f.base64, 'base64'));
      saved.push(dest);
    }
    return { ok: true, folder: folder, count: saved.length, paths: saved };
  } catch (err) {
    return { ok: false, error: err.message, count: saved.length };
  }
});
