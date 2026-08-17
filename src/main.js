const { app, BrowserWindow, BrowserView, ipcMain } = require('electron');
const path = require('path');

const TERMINAL_HEIGHT = 180; // px reserved at top of window for the terminal UI

let mainWindow = null;
let tabs = []; // { id, view, url, title, loading }
let activeTabId = null;
let nextTabId = 1;

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function log(message) {
  send('log', message);
}

function tabsSnapshot() {
  return tabs.map((t) => ({
    id: t.id,
    url: t.url,
    title: t.title,
    active: t.id === activeTabId,
  }));
}

function broadcastTabs() {
  send('tabs-updated', tabsSnapshot());
}

function normalizeUrl(input) {
  if (!input) return null;
  let candidate = input.trim();
  if (!candidate) return null;
  const looksLikeUrl = /^https?:\/\//i.test(candidate) || /^[\w-]+(\.[\w-]+)+/.test(candidate);
  if (!looksLikeUrl) {
    return `https://www.google.com/search?q=${encodeURIComponent(candidate)}`;
  }
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  return candidate;
}

function layoutActiveView() {
  if (!mainWindow) return;
  const bounds = mainWindow.getContentBounds();
  const active = tabs.find((t) => t.id === activeTabId);
  if (!active) return;
  active.view.setBounds({
    x: 0,
    y: TERMINAL_HEIGHT,
    width: bounds.width,
    height: Math.max(bounds.height - TERMINAL_HEIGHT, 0),
  });
}

function attachView(tab) {
  mainWindow.setBrowserView(tab.view);
  layoutActiveView();
}

function createTab(rawUrl) {
  const id = nextTabId++;
  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });

  const tab = { id, view, url: '', title: 'New Tab', loading: false };
  tabs.push(tab);

  view.webContents.on('did-start-loading', () => {
    tab.loading = true;
    broadcastTabs();
  });
  view.webContents.on('did-stop-loading', () => {
    tab.loading = false;
    tab.url = view.webContents.getURL();
    broadcastTabs();
  });
  view.webContents.on('page-title-updated', (_e, title) => {
    tab.title = title || tab.url || 'New Tab';
    broadcastTabs();
  });
  view.webContents.on('did-navigate', (_e, url) => {
    tab.url = url;
    log(`Loaded ${url}`);
    broadcastTabs();
  });
  view.webContents.on('did-navigate-in-page', (_e, url) => {
    tab.url = url;
    broadcastTabs();
  });
  view.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return; // aborted, usually a redirect, ignore
    log(`Failed to load ${validatedURL || tab.url}: ${errorDescription}`);
  });

  switchTab(id);

  const target = normalizeUrl(rawUrl);
  if (target) {
    tab.url = target;
    view.webContents.loadURL(target);
    log(`Opening tab ${id}: ${target}`);
  } else {
    log(`Opened tab ${id} (blank)`);
  }

  broadcastTabs();
  return tab;
}

function closeTab(id) {
  const index = tabs.findIndex((t) => t.id === id);
  if (index === -1) {
    log(`No tab ${id}`);
    return;
  }
  const [tab] = tabs.splice(index, 1);
  if (mainWindow.getBrowserView() === tab.view) {
    mainWindow.setBrowserView(null);
  }
  tab.view.webContents.destroy();
  log(`Closed tab ${id}`);

  if (activeTabId === id) {
    activeTabId = null;
    const next = tabs[index] || tabs[index - 1] || tabs[0];
    if (next) {
      switchTab(next.id);
    }
  }
  broadcastTabs();
}

function switchTab(id) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) {
    log(`No tab ${id}`);
    return;
  }
  activeTabId = id;
  attachView(tab);
  log(`Switched to tab ${id}`);
  broadcastTabs();
}

function activeTab() {
  return tabs.find((t) => t.id === activeTabId) || null;
}

function handleCommand(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return;

  const [cmdRaw, ...rest] = trimmed.split(/\s+/);
  const cmd = cmdRaw.toLowerCase();
  const argStr = rest.join(' ');

  switch (cmd) {
    case 'help':
      log('Commands: go <url>, search <query>, back, forward, reload, stop, newtab [url], closetab <n>, tab <n>, tabs, clear, help');
      break;

    case 'go': {
      if (!argStr) { log('Usage: go <url>'); break; }
      const tab = activeTab();
      if (!tab) { log('No active tab. Use newtab first.'); break; }
      const target = normalizeUrl(argStr);
      tab.url = target;
      tab.view.webContents.loadURL(target);
      log(`Navigating to ${target}`);
      break;
    }

    case 'search': {
      if (!argStr) { log('Usage: search <query>'); break; }
      const tab = activeTab();
      if (!tab) { log('No active tab. Use newtab first.'); break; }
      const target = `https://www.google.com/search?q=${encodeURIComponent(argStr)}`;
      tab.view.webContents.loadURL(target);
      log(`Searching: ${argStr}`);
      break;
    }

    case 'back': {
      const tab = activeTab();
      if (tab && tab.view.webContents.canGoBack()) {
        tab.view.webContents.goBack();
      } else {
        log('Cannot go back.');
      }
      break;
    }

    case 'forward': {
      const tab = activeTab();
      if (tab && tab.view.webContents.canGoForward()) {
        tab.view.webContents.goForward();
      } else {
        log('Cannot go forward.');
      }
      break;
    }

    case 'reload': {
      const tab = activeTab();
      if (tab) {
        tab.view.webContents.reload();
        log('Reloading.');
      } else {
        log('No active tab.');
      }
      break;
    }

    case 'stop': {
      const tab = activeTab();
      if (tab) {
        tab.view.webContents.stop();
        log('Stopped.');
      }
      break;
    }

    case 'newtab': {
      createTab(argStr || null);
      break;
    }

    case 'closetab': {
      const n = parseInt(argStr, 10);
      if (!Number.isFinite(n)) { log('Usage: closetab <n>'); break; }
      closeTab(n);
      break;
    }

    case 'tab': {
      const n = parseInt(argStr, 10);
      if (!Number.isFinite(n)) { log('Usage: tab <n>'); break; }
      switchTab(n);
      break;
    }

    case 'tabs': {
      if (tabs.length === 0) { log('No open tabs.'); break; }
      tabs.forEach((t) => {
        const marker = t.id === activeTabId ? '*' : ' ';
        log(`${marker} [${t.id}] ${t.title || 'New Tab'} - ${t.url || ''}`);
      });
      break;
    }

    case 'clear': {
      send('clear-log');
      break;
    }

    default:
      log(`Unknown command: ${cmd}. Type "help" for a list of commands.`);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0d0f10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('resize', layoutActiveView);

  mainWindow.webContents.on('did-finish-load', () => {
    log('Terminal Browser ready. Type "help" for commands.');
    createTab(null);
  });

  ipcMain.on('command', (_event, text) => {
    handleCommand(text);
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
