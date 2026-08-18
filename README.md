# EasyBrowse

A desktop web browser that has a terminal-style interface rather than the normal address bar and buttons; you enter commands and it carries out browsing tasks. It is built using Electron.

There is no need to install it, no tracking, no accounts, no unnecessary extra features, just a window that browses the web and accepts commands.

## Why

I was looking for something lightweight that had the feel of a tool rather than a product. Ordinary browsers have become heavy due to things like tab groups, syncing accounts, extension stores, and all those menus which you never use. This one is the opposite: it's a command line and the result is a webpage.

## Features

- Real tabs, backed by actual Chromium `BrowserView`s (not fake iframes)
- Spaces: group your tabs so you're not scrolling through 40 of them at once
- Save tabs so they come back automatically the next time you open the app
- Bookmarks
- Find in page
- Session history
- Favicons in the tab strip
- Right-click context menu (back/forward/reload, open link in new tab, copy, paste, inspect element)
- Links that try to open in a new window open in a new tab instead
- Downloads save straight to your Downloads folder
- Keyboard shortcuts for the stuff you do constantly
- Load real Chrome extensions (unpacked, not from a store)
- Hide the terminal bar entirely and get a clean fullscreen browser
- Zero setup, zero accounts, zero telemetry

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+T` | New tab |
| `Ctrl+W` | Close current tab |
| `Ctrl+L` | Focus the command bar |
| `Ctrl+F` | Focus the command bar with `find` pre-filled |
| `Ctrl+R` | Reload |
| `Alt+Left` / `Alt+Right` | Back / forward |
| `Ctrl+Space` | Show or hide the terminal bar |

It makes no difference whether the terminal bar or the loaded page has focus.

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
| `bookmark <n>` | Bookmark tab `n` |
| `unbookmark <n>` | Remove a bookmark |
| `bookmarks` | List bookmarks |
| `openbookmark <n>` | Open a bookmark in a new tab |
| `find <text>` | Find text on the current page |
| `findnext` / `findprev` | Jump between matches |
| `stopfind` | Clear the find highlight |
| `history` | Show recently visited pages this session |
| `clearhistory` | Clear session history |
| `loadext <path>` | Load an unpacked Chrome extension from a folder |
| `extensions` | List loaded extensions |
| `unloadext <n>` | Unload an extension |
| `clear` | Clear the terminal log |
| `hide` / `show` | Toggle the terminal bar |
| `help` | Show the command list in-app |

## Running it

```
npm install
npm start
```

That's all there is to it; a window appears with an empty tab and a terminal bar at the top.

## Building a standalone exe

```
npm install
npm run build
```

The output is a single portable .exe file and ends up in the dist/ folder. There is no installer and no need for any configuration—you just have to copy the file and then run it. When building this yourself for the first time on Windows, you might have to enable Developer Mode (under Settings > Privacy & Security > For developers) as the build process requires permission to create symlinks.

## Loading extensions

The loadext command requires a folder containing a manifest.json file, identical to the format used by the Chrome Web Store for unpacked extensions; Firefox .xpi files won't work in this case since they are a completely different format. If you don't wish to use the Chrome Web Store, most widely used extensions provide a Chromium version separately on their GitHub releases page.

## Project structure

```
src/
  In the Electron environment the main process handles windows, tabs, spaces, commands, the menu and downloads.
  preload.js connects the main and renderer processes through IPC.
  index.html    Terminal UI shell
  styles.css    Terminal styling
  renderer.js. Handles input, shows logs, manages the tab strip.
```

## Known limitations

- Windows only for now
- The exe isn't code-signed, so Windows SmartScreen will flag it on first run (click "More info" > "Run anyway")
- History and search state don't persist across restarts, only saved tabs and bookmarks do
- Extension support covers unpacked Chromium-format extensions; not every extension will behave perfectly since Electron's extension APIs aren't a 1:1 match with Chrome