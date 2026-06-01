const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

let server;
let serverModule;
let logFile;

function log(message) {
  try {
    if (!logFile) return;
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`);
  } catch {}
}

process.on('uncaughtException', error => log(`uncaughtException: ${error.stack || error.message}`));
process.on('unhandledRejection', error => log(`unhandledRejection: ${error?.stack || error}`));

const isDev = !app.isPackaged;
const rootDir = path.resolve(__dirname, '..');

async function isBackendAlreadyRunning() {
  try {
    const response = await fetch('http://127.0.0.1:3344/health');
    if (!response.ok) return false;
    const health = await response.json();
    if (health?.app?.name === 'blue-rag' && health?.app?.apiVersion >= 5) return true;
    const error = new Error('An older Blue RAG backend is already running on 127.0.0.1:3344. Close every Blue RAG window from Task Manager, then open this updated build again.');
    error.code = 'STALE_LOCAL_RAG_BACKEND';
    throw error;
  } catch (error) {
    if (error?.code === 'STALE_LOCAL_RAG_BACKEND') throw error;
    return false;
  }
}

async function startBackend() {
  logFile = path.join(app.getPath('userData'), 'local-rag.log');
  log('starting backend');
  process.env.RAG_DATA_DIR = process.env.RAG_DATA_DIR || path.join(app.getPath('userData'), 'rag-data');
  process.env.OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  process.env.RAG_LLM_MODEL = process.env.RAG_LLM_MODEL || 'qwen2.5:7b-instruct';
  process.env.RAG_EMBED_MODEL = process.env.RAG_EMBED_MODEL || 'bge-m3';
  process.env.RAG_PORT = process.env.RAG_PORT || '3344';

  if (await isBackendAlreadyRunning()) {
    log('backend already running; reusing existing service');
    return;
  }

  const serverPath = path.join(rootDir, 'dist', 'server.js');
  log(`loading server from ${serverPath}`);
  serverModule = await import(pathToFileURL(serverPath).href);
  server = await serverModule.startServer();
  log('backend listening');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 980,
    minHeight: 680,
    title: 'Blue RAG - Offline Client Knowledge Assistant',
    icon: path.join(rootDir, 'assets', 'icon.ico'),
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(rootDir, 'ui', 'dist', 'index.html'));
  }
}

ipcMain.handle('dialog:select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Choose a document folder to index'
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:select-model-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Choose a folder containing GGUF model files'
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:select-gguf-files', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    title: 'Choose GGUF model file - for split models choose 00001-of-xxxxx.gguf',
    filters: [{ name: 'GGUF models', extensions: ['gguf'] }]
  });
  if (result.canceled || !result.filePaths.length) return [];
  return result.filePaths;
});

ipcMain.handle('shell:open-path', async (_event, filePath) => {
  if (!filePath || typeof filePath !== 'string') return false;
  const result = await shell.openPath(filePath);
  return result === '' ? true : result;
});

app.whenReady().then(async () => {
  try {
    await startBackend();
    createWindow();
  } catch (error) {
    log(`startup failed: ${error.stack || error.message}`);
    dialog.showErrorBox('Blue RAG failed to start', error.stack || error.message);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', async () => {
  if (serverModule?.stopLocalRuntimes) await serverModule.stopLocalRuntimes();
  if (server) await server.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
