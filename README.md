# Terminal Browser

A desktop web browser with a terminal-style interface instead of the usual address bar and buttons. You type commands, it does browser stuff. Built with Electron.

No install required to use it, no tracking, no accounts, no bloat. Just a window that browses the web and takes commands.

## Why

Wanted something lightweight that felt more like a tool than a product. Regular browsers have gotten heavy with tab groups, sync accounts, extension stores, and a dozen menus you never open. This is the opposite: a command line where the output happens to be a webpage.

## Features

- Real tabs, backed by actual Chromium `BrowserView`s (not fake iframes)
- Spaces: group your tabs so you're not scrolling through 40 of them at once
- Save tabs so they come back automatically the next time you open the app
- Load real Chrome extensions (unpacked, not from a store)
- Hide the terminal bar entirely and get a clean fullscreen browser (`Ctrl+Space` to bring it back)
- Zero setup, zero accounts, zero telemetry

## Commands

| Command | What it does |
|---|---|
| `go <url>` | Navigate the current tab |
| `search <query>` | Search Google from the current tab |
| `back` / `forward` / `reload` / `stop` | Standard nav controls |
| `newtab [url]` | Open a new tab, optionally straight to a URL |
| `closetab <n>` | Close tab number `n` |
| `tab <n>` | Switch to tab `n` |
| `tabs` | List tabs in the current space |
| `space <name>` | Switch to a space, creating it if it doesn't exist |
| `spaces` | List all spaces |
| `movetab <n> <space>` | Move a tab into a different space |
| `save <n>` | Save a tab so it reopens automatically next launch |
| `unsave <n>` | Remove a tab from the saved list |
| `saved` | List saved tabs |
| `loadext <path>` | Load an unpacked Chrome extension from a folder |
| `extensions` | List loaded extensions |
| `unloadext <n>` | Unload an extension |
| `clear` | Clear the terminal log |
| `hide` / `show` | Toggle the terminal bar (or just hit `Ctrl+Space`) |
| `help` | Show the command list in-app |

## Running it

```
npm install
npm start
```

That's it. A window opens with an empty tab and a terminal bar on top.

## Building a standalone exe

```
npm install
npm run build
```

Output lands in `dist/` as a single portable `.exe`. No installer, nothing to configure, just copy the file and run it. If you're building this yourself on Windows for the first time, you may need to turn on Developer Mode (Settings > Privacy & Security > For developers) since the build process needs permission to create symlinks.

## Loading extensions

`loadext` expects a folder with a `manifest.json` in it, the same format the Chrome Web Store uses for unpacked extensions. Firefox `.xpi` files won't work here, they're a different format entirely. Most popular extensions publish a Chromium build separately from their GitHub releases page if you don't want to go through the Chrome Web Store.

## Project structure

```
src/
  main.js       Electron main process: window, tabs, spaces, commands
  preload.js    IPC bridge between main and renderer
  index.html    Terminal UI shell
  styles.css    Terminal styling
  renderer.js   Input handling, log rendering, tab strip
```

## Known limitations

- Windows only for now
- The exe isn't code-signed, so Windows SmartScreen will flag it on first run (click "More info" > "Run anyway")
- No bookmarks or browsing history yet
- Extension support covers unpacked Chromium-format extensions; not every extension will behave perfectly since Electron's extension APIs aren't a 1:1 match with Chrome