const { app, BrowserWindow, BrowserView, ipcMain, globalShortcut, session } = require('electron');
const path = require('path');
const Store = require('electron-store');

const store = new Store();

const TERMINAL_HEIGHT = 180; // px reserved at top of window for the terminal UI

let mainWindow = null;
let tabs = []; // { id, view, url, title, loading, spaceId }
let spaces = []; // { id, name }
let activeTabId = null;
let activeSpaceId = null;
let nextTabId = 1;
let nextSpaceId = 1;
let terminalHidden = false;

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function log(message) {
  send('log', message);
}

function activeSpaceTabs() {
  return tabs.filter((t) => t.spaceId === activeSpaceId);
}

function tabsSnapshot() {
  return activeSpaceTabs().map((t) => ({
    id: t.id,
    url: t.url,
    title: t.title,
    active: t.id === activeTabId,
  }));
}

function broadcastTabs() {
  send('tabs-updated', tabsSnapshot());
  const space = spaces.find((s) => s.id === activeSpaceId);
  send('space-updated', space ? space.name : '');
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
  const topOffset = terminalHidden ? 0 : TERMINAL_HEIGHT;
  if (!active) {
    return;
  }
  active.view.setBounds({
    x: 0,
    y: topOffset,
    width: bounds.width,
    height: Math.max(bounds.height - topOffset, 0),
  });
}

function setTerminalHidden(hidden) {
  terminalHidden = hidden;
  send('terminal-visibility', !terminalHidden);
  layoutActiveView();
}

function toggleTerminal() {
  setTerminalHidden(!terminalHidden);
}

function attachView(tab) {
  mainWindow.setBrowserView(tab.view);
  layoutActiveView();
}

function findSpaceByName(name) {
  const normalized = name.trim().toLowerCase();
  return spaces.find((s) => s.name.toLowerCase() === normalized);
}

function createSpace(name) {
  const trimmed = name.trim();
  const id = nextSpaceId++;
  const space = { id, name: trimmed };
  spaces.push(space);
  return space;
}

function getOrCreateSpace(name) {
  return findSpaceByName(name) || createSpace(name);
}

function activateSpace(spaceId) {
  activeSpaceId = spaceId;
  const spaceTabs = tabs.filter((t) => t.spaceId === spaceId);
  if (spaceTabs.length > 0) {
    switchTab(spaceTabs[0].id);
  } else {
    activeTabId = null;
    if (mainWindow) mainWindow.setBrowserView(null);
    broadcastTabs();
  }
}

function switchToSpaceByName(name) {
  const space = getOrCreateSpace(name);
  activateSpace(space.id);
  log(`Switched to space "${space.name}".`);
}

function createTab(rawUrl, spaceId) {
  const targetSpaceId = spaceId || activeSpaceId;
  const id = nextTabId++;
  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });

  const tab = { id, view, url: '', title: 'New Tab', loading: false, spaceId: targetSpaceId };
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
    if (errorCode === -3) return;
    log(`Failed to load ${validatedURL || tab.url}: ${errorDescription}`);
  });

  if (targetSpaceId === activeSpaceId) {
    switchTab(id);
  }

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
    const remaining = tabs.filter((t) => t.spaceId === tab.spaceId);
    if (remaining[0]) {
      switchTab(remaining[0].id);
    } else {
      broadcastTabs();
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
  activeSpaceId = tab.spaceId;
  attachView(tab);
  broadcastTabs();
}

function activeTab() {
  return tabs.find((t) => t.id === activeTabId) || null;
}

function moveTab(id, spaceName) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) {
    log(`No tab ${id}`);
    return;
  }
  const targetSpace = getOrCreateSpace(spaceName);
  tab.spaceId = targetSpace.id;
  log(`Moved tab ${id} to space "${targetSpace.name}".`);
  if (id === activeTabId) {
    activateSpace(activeSpaceId);
  } else {
    broadcastTabs();
  }
}

function saveTab(id) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) {
    log(`No tab ${id}`);
    return;
  }
  const space = spaces.find((s) => s.id === tab.spaceId);
  const spaceName = space ? space.name : 'default';
  const saved = store.get('savedTabs', []);
  const exists = saved.some((s) => s.url === tab.url && s.spaceName === spaceName);
  if (!exists) {
    saved.push({ url: tab.url, spaceName });
    store.set('savedTabs', saved);
  }
  log(`Saved tab ${id} (${tab.url}) to reopen next launch.`);
}

function unsaveTab(id) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) {
    log(`No tab ${id}`);
    return;
  }
  const space = spaces.find((s) => s.id === tab.spaceId);
  const spaceName = space ? space.name : 'default';
  const saved = store.get('savedTabs', []);
  const filtered = saved.filter((s) => !(s.url === tab.url && s.spaceName === spaceName));
  store.set('savedTabs', filtered);
  log(`Unsaved tab ${id}.`);
}

function listSaved() {
  const saved = store.get('savedTabs', []);
  if (saved.length === 0) {
    log('No saved tabs.');
    return;
  }
  saved.forEach((s, i) => log(`${i + 1}. [${s.spaceName}] ${s.url}`));
}

async function loadExtension(extPath) {
  try {
    const ext = await session.defaultSession.loadExtension(path.resolve(extPath), { allowFileAccess: true });
    const stored = store.get('extensions', []);
    if (!stored.includes(extPath)) {
      stored.push(extPath);
      store.set('extensions', stored);
    }
    log(`Loaded extension "${ext.name}".`);
  } catch (err) {
    log(`Failed to load extension: ${err.message}`);
  }
}

function listExtensions() {
  const loaded = session.defaultSession.getAllExtensions();
  if (loaded.length === 0) {
    log('No extensions loaded.');
    return;
  }
  loaded.forEach((ext, i) => log(`${i + 1}. ${ext.name} (${ext.id})`));
}

function unloadExtension(index) {
  const loaded = session.defaultSession.getAllExtensions();
  const ext = loaded[index - 1];
  if (!ext) {
    log(`No extension ${index}`);
    return;
  }
  session.defaultSession.removeExtension(ext.id);
  const stored = store.get('extensions', []);
  const filtered = stored.filter((p) => !p.toLowerCase().includes(ext.name.toLowerCase()));
  store.set('extensions', stored.length === filtered.length ? stored : filtered);
  log(`Unloaded extension "${ext.name}".`);
}

function handleCommand(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return;

  const [cmdRaw, ...rest] = trimmed.split(/\s+/);
  const cmd = cmdRaw.toLowerCase();
  const argStr = rest.join(' ');

  switch (cmd) {
    case 'help':
      log('Commands: go <url>, search <query>, back, forward, reload, stop, newtab [url], closetab <n>, tab <n>, tabs, space <name>, spaces, movetab <n> <space>, save <n>, unsave <n>, saved, loadext <path>, extensions, unloadext <n>, clear, hide, show, help. Ctrl+Space toggles the terminal.');
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
      createTab(argStr || null, activeSpaceId);
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
      const spaceTabs = activeSpaceTabs();
      if (spaceTabs.length === 0) { log('No open tabs in this space.'); break; }
      spaceTabs.forEach((t) => {
        const marker = t.id === activeTabId ? '*' : ' ';
        log(`${marker} [${t.id}] ${t.title || 'New Tab'} - ${t.url || ''}`);
      });
      break;
    }

    case 'space': {
      if (!argStr) { log('Usage: space <name>'); break; }
      switchToSpaceByName(argStr);
      break;
    }

    case 'spaces': {
      if (spaces.length === 0) { log('No spaces.'); break; }
      spaces.forEach((s) => {
        const count = tabs.filter((t) => t.spaceId === s.id).length;
        const marker = s.id === activeSpaceId ? '*' : ' ';
        log(`${marker} ${s.name} (${count} tab${count === 1 ? '' : 's'})`);
      });
      break;
    }

    case 'movetab': {
      const [nStr, ...spaceParts] = rest;
      const n = parseInt(nStr, 10);
      const spaceName = spaceParts.join(' ');
      if (!Number.isFinite(n) || !spaceName) { log('Usage: movetab <n> <space>'); break; }
      moveTab(n, spaceName);
      break;
    }

    case 'save': {
      const n = parseInt(argStr, 10);
      if (!Number.isFinite(n)) { log('Usage: save <n>'); break; }
      saveTab(n);
      break;
    }

    case 'unsave': {
      const n = parseInt(argStr, 10);
      if (!Number.isFinite(n)) { log('Usage: unsave <n>'); break; }
      unsaveTab(n);
      break;
    }

    case 'saved': {
      listSaved();
      break;
    }

    case 'loadext': {
      if (!argStr) { log('Usage: loadext <path to unpacked extension folder>'); break; }
      loadExtension(argStr);
      break;
    }

    case 'extensions': {
      listExtensions();
      break;
    }

    case 'unloadext': {
      const n = parseInt(argStr, 10);
      if (!Number.isFinite(n)) { log('Usage: unloadext <n>'); break; }
      unloadExtension(n);
      break;
    }

    case 'clear': {
      send('clear-log');
      break;
    }

    case 'hide': {
      setTerminalHidden(true);
      break;
    }

    case 'show': {
      setTerminalHidden(false);
      log('Terminal shown. Press Ctrl+Space to hide it again.');
      break;
    }

    default:
      log(`Unknown command: ${cmd}. Type "help" for a list of commands.`);
  }
}

async function restoreExtensions() {
  const stored = store.get('extensions', []);
  for (const extPath of stored) {
    try {
      const ext = await session.defaultSession.loadExtension(path.resolve(extPath), { allowFileAccess: true });
      log(`Restored extension "${ext.name}".`);
    } catch (err) {
      log(`Could not restore extension at ${extPath}: ${err.message}`);
    }
  }
}

function restoreSavedTabs() {
  const saved = store.get('savedTabs', []);
  if (saved.length === 0) return false;
  saved.forEach((s) => {
    const space = getOrCreateSpace(s.spaceName || 'default');
    createTab(s.url, space.id);
  });
  return true;
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

  mainWindow.webContents.on('did-finish-load', async () => {
    log('Terminal Browser ready. Type "help" for commands. Ctrl+Space toggles the terminal.');

    const defaultSpace = getOrCreateSpace('default');
    activeSpaceId = defaultSpace.id;

    await restoreExtensions();

    const restored = restoreSavedTabs();
    if (!restored) {
      createTab(null, defaultSpace.id);
    } else {
      activateSpace(defaultSpace.id);
    }
  });

  ipcMain.on('command', (_event, text) => {
    handleCommand(text);
  });
}

app.whenReady().then(() => {
  createWindow();
  globalShortcut.register('CommandOrControl+Space', toggleTerminal);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
