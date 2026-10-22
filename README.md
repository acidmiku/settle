# Settle

**A local desktop editor for notes, code snippets, and Markdown.**

Open Settle and start writing. The editor fills the window, tabs hold your unfinished thoughts, and saved notes are a shortcut away. Everything stays on your device.

Built for Windows and macOS with Rust, Tauri 2, and plain HTML, CSS, and JavaScript. **Scratch** is the default design, with nine more available in Settings.

## Write, save, move on

Every tab is a place to write. Drafts recover automatically when you reopen Settle, including each tab's syntax selection and Markdown preview state.

- **Save a new note** with `Ctrl+S` on Windows or `Cmd+S` on macOS. Settle stores it in your library and keeps the same tab open. Keep writing and save again to update it; use `Ctrl/Cmd+N` for a new note. The Save button and Enter save shortcuts behave the same way.
- **Edit a saved note** by opening it from the saved-notes drawer or search. Save updates that note in place and keeps it open.
- **Copy + clear** sends the current text to the clipboard and clears the tab. If copying fails, your text stays put.
- **Hide and return** with the configurable global shortcut. Closing the window hides Settle; use Quit in the tray or app menu to exit.

Saved notes live in an optional drawer, in one continuous list separated by date headings, newest first. Browse **All notes**, **Unfiled**, or a folder. Long libraries load in pages. Search them from anywhere in the editor with `Ctrl/Cmd+K`.

Double-click a note's label in the drawer or its tab to **rename** it, or use the right-click menu. Names are separate from note text and included in search. Clear a name to use the first line again.

Create folders with **New folder**. Use **New note** inside a folder to save there, or a note's **Move to folder** menu to move an existing note. Folder menus offer rename and delete; deleting a folder keeps its notes in Unfiled.

The footer shows a **green Saved** dot when the current note matches its saved content, and a **red Not saved** dot for drafts or unsaved edits. Automatic draft backup is separate from saving a note to the library.

## Editor tools

### Syntax highlighting

The **Syntax** selector in the footer starts in Auto mode and detects the language locally. Choose a language yourself when needed, or select Plain text to turn highlighting off. Each tab remembers its choice.

Supported syntax includes JavaScript, TypeScript, JSON, HTML/XML, CSS, Python, Rust, PowerShell, Bash, SQL, YAML, INI/TOML, C, C++, C#, Java, Kotlin, Swift, Go, and Markdown. The selector contains the full list.

### Word wrap, line numbers, and find

**Word wrap** is enabled by default for every design and syntax. Toggle it in **Settings → Writing** to switch between wrapped lines and horizontal scrolling. The preference applies to all tabs and survives restart; wrapping never adds line breaks to your saved text.

Toggle **Line numbers** in the footer in any design. The preference applies across themes and survives restart. Wrapped paragraphs keep one number per logical line.

Use `Ctrl/Cmd+F` to find text in the current tab, then `F3` or `Shift+F3` to move through matches.

The footer shows the caret position and the note's **character count**. While text is selected, the count changes to the selection, such as `3 lines, 46 characters selected`. In WYSIWYG it shows words and characters of the visible text.

### Indentation

`Tab` indents in the source editor and `Shift+Tab` outdents. With several lines selected, both act on every selected line. Native Undo reverses each indent.

The **Tab size** control at the right of the footer sets the tab width to 2, 4, or 8. Turn on **Indent using spaces** in the same menu to insert spaces instead of tab characters. **Show tabs and spaces** marks each tab with an arrow and each space with a dot in the source editor without changing your text. These choices apply to all tabs and survive restart.

### Markdown preview

When Markdown is detected or selected, **Preview Markdown** appears in the footer. Toggle it to replace the editor with rendered headings, lists, tables, task checkboxes, and highlighted code blocks. **Edit Markdown** returns to the source.

Preview leaves your text unchanged. Web and email links open in the default application. Remote images appear as their alternative text, and scripts and embedded pages are removed.

### WYSIWYG Markdown editing

With Markdown selected or detected, click **WYSIWYG** beside the language selector to edit rendered text. Formatting controls appear below the tabs: headings, bold, italic, strikethrough, inline code, lists, checklists, quotes, links, code blocks, tables, rules, and undo/redo. Edits are stored as Markdown and use the normal save and draft-recovery paths. Each tab remembers its editing view.

Click **WYSIWYG** again to return to source, or **Preview Markdown** for the read-only view. Merely switching views preserves the original source exactly; visual edits may normalize Markdown formatting. Notes containing raw HTML stay in source mode to preserve their markup. Image references remain in the Markdown and display as labels without fetching remote images.

### Tab actions

Right-click a tab or the tab bar for:

| Action | Behavior |
| --- | --- |
| New tab | Open a fresh draft. |
| Rename note | Give the tab or saved note a name without changing its text. |
| Close tab | Close the targeted tab. Unsaved work offers **Save & close**, **Discard**, and **Cancel**. |
| Close all with saving | Save new drafts, update edited notes, and start with one empty tab. |
| Close all without saving | Confirm before discarding unsaved work. Previously saved notes remain. |

If saving all tabs fails, the tabs stay open. Retrying updates notes already saved instead of creating duplicates. The menu also opens with `Shift+F10` while a tab has focus.

Every tab also has its own close button. A failed save keeps that tab and its text open.

## Ten designs

Choose a design in **Settings → Design**. Each changes the palette, typography, and layout while preserving your open text.

| Design | Look and feel |
| --- | --- |
| Kiln | Dark industrial surface with an orange tool rail. |
| Blackbox | Near-black canvas, lime edge, spacious text. |
| Optic | Paper white, cobalt details, precise typography. |
| Phosphor | Deep green, mint text, clock, and active-line glow. |
| Sidecar | A compact window docked to the right, with orange accents. |
| Cobalt | Bright blue canvas, large type, white action bar. |
| **Scratch · default** | Graphite surface, pink accents, compact tabs. |
| Redline | Warm paper, red rail, oversized first-line title for plain text. |
| Frost | Cool paper, frosted chrome, cyan accents. |
| Tape | A wide, shallow yellow writing surface with black chrome. |

Sidecar and Tape resize the window to fit their layouts. Switching away restores the previous window bounds. Redline uses the full editor for code and Markdown.

## Keyboard shortcuts

Use `Ctrl` on Windows and `Cmd` on macOS.

| Action | Shortcut |
| --- | --- |
| Save / update note | `Ctrl/Cmd+S` |
| Save alternative | `Shift+Enter` |
| Copy + clear | `Ctrl/Cmd+Enter` |
| New tab | `Ctrl/Cmd+N` |
| Find in current tab | `Ctrl/Cmd+F` |
| Next / previous match | `F3` / `Shift+F3` |
| Search saved notes | `Ctrl/Cmd+K` |
| Toggle saved-notes drawer | `Ctrl/Cmd+Shift+H` |
| Settings | `Ctrl/Cmd+,` |
| Tab context menu | `Shift+F10` on a tab |
| Dismiss a menu, dialog, find bar, or drawer; otherwise hide | `Esc` |
| Show / hide Settle from another app | `Ctrl/Cmd+Shift+Space` |

Enable **Enter to save** in Settings to use Enter for saving and Shift+Enter for a new line. `Ctrl/Cmd+S` always saves. Change or disable the global shortcut in the same panel.

On macOS, Settle uses native window controls and an Edit menu, reopens from the Dock, and preserves the system `Cmd+H` shortcut.

## Updates and startup

In **Settings → Updates**, click **Check for updates** to check the latest stable release. If a newer version exists, **Install update** downloads it, verifies its signature, and restarts Settle. Drafts must finish backing up before installation starts; a failed backup or download leaves your text available for retry. Update checks only run when requested.

Enable **Settings → System → Start with OS** to open Settle when you sign in. It defaults to off and uses Windows startup registration or a macOS Launch Agent. Opening the app again brings its existing window forward.

On macOS, copy Settle into Applications before enabling startup or using in-app updates. Version 0.2.0 needs one manual upgrade to 0.2.1 or later to gain the updater.

## Your data

Notes, drafts, and settings are stored locally. Drafts are cached as you type and backed up to SQLite. Writing, highlighting, preview, and search work offline.

| Platform | Database |
| --- | --- |
| Windows | `%APPDATA%\com.settle.app\settle.sqlite3` |
| macOS | `~/Library/Application Support/com.settle.app/settle.sqlite3` |

**Settings → Your data** shows the actual database path and offers JSON and Markdown exports, including open drafts, note names, and folder information. Each export gets its own folder under the app-data directory's `exports/` folder. Existing notes and drafts are retained when upgrading; older notes initially appear in Unfiled.

Database upgrades use a separate migration history for the editor so older builds' migration numbers cannot skip new features. Upgrades also repair missing note-library fields from affected 0.2.2 installations, preserving existing notes, names, folders, drafts, and archived data.

## Development

Install stable Rust (1.90 or newer) and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). Windows needs the MSVC build tools and WebView2; macOS needs Xcode Command Line Tools. Run these commands from the repository root:

```sh
cargo install tauri-cli --locked
cargo tauri dev
```

The frontend and its bundled libraries are checked in, so running or building the app needs no Node build step. Node 22 or newer is used for tests and rebuilding the library bundle.

### Checks

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm ci
npx playwright install chromium webkit
npm test
npm run test:release
```

Rust tests exercise real SQLite databases, migrations, search, and exports. Playwright tests exercise Chromium and WebKit with a mock desktop bridge, covering editing, draft recovery, syntax, preview, shortcuts, tab actions, save failures, and all ten designs. CI runs these checks on Windows and macOS; browser tests do not replace native app testing.

### Bundled libraries

Highlight.js provides syntax highlighting; Marked and DOMPurify provide Markdown rendering and sanitization. Tiptap and ProseMirror provide WYSIWYG editing with local Markdown conversion. All libraries ship locally in `src/vendor/editor.js` and `src/vendor/wysiwyg.js`, with licenses in `src/vendor/LICENSES.txt`.

After changing their pinned dependencies or `scripts/vendor-entry.js`, rebuild the bundle:

```sh
npm ci
npm run vendor
```

CI checks that the generated bundle matches its sources. Local design references in `design_concepts/` are ignored by Git and are not needed to build the app.

For an interactive browser preview, run `node tests/server.js` and open `http://127.0.0.1:4173/preview`. It uses sample notes and isolated browser storage; it does not access the desktop database. The preview bridge is served from `tests/` and is excluded from desktop builds.

## Build installers

**Windows — NSIS installer**

```sh
cargo tauri build --ci -b nsis -- --locked
```

Output: `src-tauri/target/release/bundle/nsis/`.

**macOS — universal DMG for Apple Silicon and Intel**

Run on a Mac:

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
APPLE_SIGNING_IDENTITY=- cargo tauri build --ci --target universal-apple-darwin -b dmg -- --locked
```

Output: `src-tauri/target/universal-apple-darwin/release/bundle/dmg/`. The configured minimum macOS version is 12.3.

The installer workflow builds both platforms on manual dispatch or a `v*` tag. Signed builds need `TAURI_SIGNING_PRIVATE_KEY` (a key path or contents) and its optional `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in the environment. For unsigned local installers, override `bundle.createUpdaterArtifacts` to `false` in a local Tauri config.

GitHub Actions reads the signing key from the repository secret `TAURI_SIGNING_PRIVATE_KEY`. Before tagging, match the Cargo/Tauri versions and add `releases/vX.Y.Z.md`. Tagged builds publish installers, signatures, a universal Mac update archive, and `latest.json`. The manifest is generated only after both platforms succeed. Keep the private signing key backed up outside the repository: future updates must use the same key.

macOS builds currently use ad-hoc signing and are not notarized; distribution with Developer ID signing and notarization requires Apple credentials and the corresponding workflow configuration. Updater signatures are separate from Apple code signing. See the [Tauri macOS signing guide](https://v2.tauri.app/distribute/sign/macos/).
