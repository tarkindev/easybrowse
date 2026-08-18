const logEl = document.getElementById('log');
const inputEl = document.getElementById('command-input');
const tabListEl = document.getElementById('tab-list');
const spaceLabelEl = document.getElementById('space-label');

const history = [];
let historyIndex = -1;

function appendLog(message) {
  const line = document.createElement('div');
  line.textContent = message;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function clearLog() {
  logEl.innerHTML = '';
}

function renderTabs(tabs) {
  tabListEl.innerHTML = '';
  tabs.forEach((t) => {
    const chip = document.createElement('span');
    chip.className = 'tab-chip' + (t.active ? ' active' : '');
    chip.textContent = `[${t.id}] ${t.title || 'New Tab'}`;
    tabListEl.appendChild(chip);
  });
}

function renderSpace(name) {
  spaceLabelEl.textContent = name ? `space: ${name}` : '';
}

window.terminal.onLog(appendLog);
window.terminal.onClear(clearLog);
window.terminal.onTabsUpdated(renderTabs);
window.terminal.onSpaceUpdated(renderSpace);
window.terminal.onTerminalVisibility((visible) => {
  document.getElementById('terminal').style.display = visible ? 'flex' : 'none';
  if (visible) inputEl.focus();
});

inputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    const value = inputEl.value;
    if (value.trim()) {
      appendLog(`> ${value}`);
      history.push(value);
      historyIndex = history.length;
      window.terminal.sendCommand(value);
    }
    inputEl.value = '';
    return;
  }

  if (event.key === 'ArrowUp') {
    if (historyIndex > 0) {
      historyIndex -= 1;
      inputEl.value = history[historyIndex];
    }
    event.preventDefault();
    return;
  }

  if (event.key === 'ArrowDown') {
    if (historyIndex < history.length - 1) {
      historyIndex += 1;
      inputEl.value = history[historyIndex];
    } else {
      historyIndex = history.length;
      inputEl.value = '';
    }
    event.preventDefault();
  }
});

inputEl.focus();
