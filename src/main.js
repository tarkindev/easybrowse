const { app, BrowserWindow, BrowserView, ipcMain, globalShortcut, session, Menu } = require('electron');
const path = require('path');
const Store = require('electron-store');

const store = new Store();

const TERMINAL_HEIGHT = 180; // px reserved at top of window for the terminal UI

let mainWindow = null;
let tabs = []; // { id, view, url, title, loading, spaceId, favicon }
let spaces = []; // { id, name }
let activeTabId = null;
let activeSpaceId = null;
let nextTabId = 1;
let nextSpaceId = 1;
let terminalHidden = false;
let lastFindText = '';
let visitHistory = []; // { url, title, time }

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
    favicon: t.favicon || '',
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

function focusCommandBar(prefill) {
  setTerminalHidden(false);
  send('focus-input', prefill === undefined ? '' : prefill);
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

function attachContextMenu(view, tab) {
  view.webContents.on('context-menu', (_event, params) => {
    const template = [];

    template.push({ label: 'Back', enabled: view.webContents.canGoBack(), click: () => view.webContents.goBack() });
    template.push({ label: 'Forward', enabled: view.webContents.canGoForward(), click: () => view.webContents.goForward() });
    template.push({ label: 'Reload', click: () => view.webContents.reload() });
    template.push({ type: 'separator' });

    if (params.linkURL) {
      template.push({ label: 'Open Link in New Tab', click: () => createTab(params.linkURL, tab.spaceId) });
      template.push({ label: 'Copy Link', click: () => require('electron').clipboard.writeText(params.linkURL) });
      template.push({ type: 'separator' });
    }

    if (params.selectionText) {
      template.push({ label: 'Copy', click: () => view.webContents.copy() });
    }
    if (params.isEditable) {
      template.push({ label: 'Cut', click: () => view.webContents.cut() });
      template.push({ label: 'Paste', click: () => view.webContents.paste() });
    }
    if (params.selectionText || params.isEditable) {
      template.push({ type: 'separator' });
    }

    template.push({ label: 'Inspect Element', click: () => view.webContents.inspectElement(params.x, params.y) });

    Menu.buildFromTemplate(template).popup({ window: mainWindow });
  });
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

  const tab = { id, view, url: '', title: 'New Tab', loading: false, spaceId: targetSpaceId, favicon: '' };
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
  view.webContents.on('page-favicon-updated', (_e, favicons) => {
    tab.favicon = (favicons && favicons[0]) || '';
    broadcastTabs();
  });
  view.webContents.on('did-navigate', (_e, url) => {
    tab.url = url;
    log(`Loaded ${url}`);
    visitHistory.push({ url, title: tab.title, time: Date.now() });
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
  view.webContents.on('found-in-page', (_e, result) => {
    log(`Match ${result.activeMatchOrdinal} of ${result.matches}`);
  });
  view.webContents.setWindowOpenHandler(({ url }) => {
    createTab(url, tab.spaceId);
    return { action: 'deny' };
  });

  attachContextMenu(view, tab);

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

function addBookmark(id) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) {
    log(`No tab ${id}`);
    return;
  }
  const bookmarks = store.get('bookmarks', []);
  const exists = bookmarks.some((b) => b.url === tab.url);
  if (!exists) {
    bookmarks.push({ url: tab.url, title: tab.title || tab.url });
    store.set('bookmarks', bookmarks);
  }
  log(`Bookmarked "${tab.title}".`);
}

function removeBookmark(index) {
  const bookmarks = store.get('bookmarks', []);
  if (!bookmarks[index - 1]) {
    log(`No bookmark ${index}`);
    return;
  }
  const removed = bookmarks.splice(index - 1, 1)[0];
  store.set('bookmarks', bookmarks);
  log(`Removed bookmark "${removed.title}".`);
}

function listBookmarks() {
  const bookmarks = store.get('bookmarks', []);
  if (bookmarks.length === 0) {
    log('No bookmarks.');
    return;
  }
  bookmarks.forEach((b, i) => log(`${i + 1}. ${b.title} - ${b.url}`));
}

function openBookmark(index) {
  const bookmarks = store.get('bookmarks', []);
  const bookmark = bookmarks[index - 1];
  if (!bookmark) {
    log(`No bookmark ${index}`);
    return;
  }
  createTab(bookmark.url, activeSpaceId);
}

function findInPage(text) {
  const tab = activeTab();
  if (!tab) { log('No active tab.'); return; }
  if (!text) { log('Usage: find <text>'); return; }
  lastFindText = text;
  tab.view.webContents.findInPage(text);
}

function findStep(forward) {
  const tab = activeTab();
  if (!tab || !lastFindText) { log('No active search. Use find <text> first.'); return; }
  tab.view.webContents.findInPage(lastFindText, { forward, findNext: true });
}

function stopFind() {
  const tab = activeTab();
  if (tab) tab.view.webContents.stopFindInPage('clearSelection');
}

function showHistory() {
  if (visitHistory.length === 0) {
    log('No history yet this session.');
    return;
  }
  const recent = visitHistory.slice(-20).reverse();
  recent.forEach((h, i) => log(`${i + 1}. ${h.title || h.url} - ${h.url}`));
}

function handleCommand(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return;

  const [cmdRaw, ...rest] = trimmed.split(/\s+/);
  const cmd = cmdRaw.toLowerCase();
  const argStr = rest.join(' ');

  switch (cmd) {
    case 'help':
      log('Nav: go, search, back, forward, reload, stop. Tabs: newtab, closetab, tab, tabs. Spaces: space, spaces, movetab. Saved: save, unsave, saved. Bookmarks: bookmark, bookmarks, openbookmark, unbookmark. Find: find, findnext, findprev, stopfind. Other: history, extensions, loadext, unloadext, clear, hide, show. Shortcuts: Ctrl+T new tab, Ctrl+W close tab, Ctrl+L command bar, Ctrl+F find, Alt+Left/Right back/forward, Ctrl+Space toggle terminal.');
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

    case 'bookmark': {
      const n = parseInt(argStr, 10);
      if (!Number.isFinite(n)) { log('Usage: bookmark <n>'); break; }
      addBookmark(n);
      break;
    }

    case 'unbookmark': {
      const n = parseInt(argStr, 10);
      if (!Number.isFinite(n)) { log('Usage: unbookmark <n>'); break; }
      removeBookmark(n);
      break;
    }

    case 'bookmarks': {
      listBookmarks();
      break;
    }

    case 'openbookmark': {
      const n = parseInt(argStr, 10);
      if (!Number.isFinite(n)) { log('Usage: openbookmark <n>'); break; }
      openBookmark(n);
      break;
    }

    case 'find': {
      findInPage(argStr);
      break;
    }

    case 'findnext': {
      findStep(true);
      break;
    }

    case 'findprev': {
      findStep(false);
      break;
    }

    case 'stopfind': {
      stopFind();
      break;
    }

    case 'history': {
      showHistory();
      break;
    }

    case 'clearhistory': {
      visitHistory = [];
      log('History cleared.');
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

function setupDownloads() {
  session.defaultSession.on('will-download', (_event, item) => {
    const savePath = path.join(app.getPath('downloads'), item.getFilename());
    item.setSavePath(savePath);
    log(`Downloading ${item.getFilename()}...`);
    item.on('done', (_e, state) => {
      if (state === 'completed') {
        log(`Downloaded ${item.getFilename()} to Downloads.`);
      } else {
        log(`Download failed: ${item.getFilename()} (${state})`);
      }
    });
  });
}

function buildAppMenu() {
  const template = [
    {
      label: 'Browser',
      submenu: [
        { label: 'New Tab', accelerator: 'CommandOrControl+T', click: () => createTab(null, activeSpaceId) },
        { label: 'Close Tab', accelerator: 'CommandOrControl+W', click: () => { if (activeTabId) closeTab(activeTabId); } },
        { label: 'Focus Command Bar', accelerator: 'CommandOrControl+L', click: () => focusCommandBar('') },
        { label: 'Find in Page', accelerator: 'CommandOrControl+F', click: () => focusCommandBar('find ') },
        { type: 'separator' },
        { label: 'Back', accelerator: 'Alt+Left', click: () => { const t = activeTab(); if (t && t.view.webContents.canGoBack()) t.view.webContents.goBack(); } },
        { label: 'Forward', accelerator: 'Alt+Right', click: () => { const t = activeTab(); if (t && t.view.webContents.canGoForward()) t.view.webContents.goForward(); } },
        { label: 'Reload', accelerator: 'CommandOrControl+R', click: () => { const t = activeTab(); if (t) t.view.webContents.reload(); } },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  if (mainWindow) mainWindow.setMenuBarVisibility(false);
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

  buildAppMenu();
  setupDownloads();

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
