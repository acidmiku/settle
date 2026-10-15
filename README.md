# Settle

**A local desktop editor for notes, code snippets, and Markdown.**

Open Settle and start writing. The editor fills the window, tabs hold your unfinished thoughts, and saved notes are a shortcut away. Everything stays on your device.

Built for Windows and macOS with Rust, Tauri 2, and plain HTML, CSS, and JavaScript. **Scratch** is the default design, with nine more available in Settings.

## Write, save, move on

Every tab is a place to write. Drafts recover automatically when you reopen Settle, including each tab's syntax selection and Markdown preview state.

- **Save a new note** with `Ctrl+S` on Windows or `Cmd+S` on macOS. Settle stores it in your dated notes and clears the tab for your next thought.
- **Edit a saved note** by opening it from the saved-notes drawer or search. Save updates that note in place and keeps it open.
- **Copy + clear** sends the current text to the clipboard and clears the tab. If copying fails, your text stays put.
- **Hide and return** with the configurable global shortcut. Closing the window hides Settle; use Quit in the tray or app menu to exit.

Saved notes live in an optional drawer, grouped by day. Search them from anywhere in the editor with `Ctrl/Cmd+K`.

## Editor tools

### Syntax highlighting

The **Syntax** selector in the footer starts in Auto mode and detects the language locally. Choose a language yourself when needed, or select Plain text to turn highlighting off. Each tab remembers its choice.

Supported syntax includes JavaScript, TypeScript, JSON, HTML/XML, CSS, Python, Rust, PowerShell, Bash, SQL, YAML, INI/TOML, C, C++, C#, Java, Kotlin, Swift, Go, and Markdown. The selector contains the full list.

### Line numbers and find

Toggle **Line numbers** in the footer in any design. The preference applies across themes and survives restart. Wrapped paragraphs keep one number per logical line.

Use `Ctrl/Cmd+F` to find text in the current tab, then `F3` or `Shift+F3` to move through matches. Code uses horizontal scrolling; prose wraps in designs that support it.

### Markdown preview

When Markdown is detected or selected, **Preview Markdown** appears in the footer. Toggle it to replace the editor with rendered headings, lists, tables, task checkboxes, and highlighted code blocks. **Edit Markdown** returns to the source.

Preview leaves your text unchanged. Web and email links open in the default application. Remote images appear as their alternative text, and scripts and embedded pages are removed.

### Tab actions

Right-click a tab or the tab bar for:

| Action | Behavior |
| --- | --- |
| New tab | Open a fresh draft. |
| Close tab | Close the targeted tab, asking before discarding unsaved text or edits. |
| Close all with saving | Save new drafts, update edited notes, and start with one empty tab. |
| Close all without saving | Confirm before discarding unsaved work. Previously saved notes remain. |

If saving all tabs fails, the tabs stay open. Retrying updates notes already saved instead of creating duplicates. The menu also opens with `Shift+F10` while a tab has focus.

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

Sidecar and Tape resize the window to fit their layouts. Switching away restores the previous window bounds. Scratch, Optic, and Phosphor keep text on unwrapped lines; other designs wrap prose. Redline uses the full editor for code and Markdown.

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

## Your data

Notes, drafts, and settings are stored locally. Drafts are cached as you type and backed up to SQLite. Writing, highlighting, preview, and search work offline.

| Platform | Database |
| --- | --- |
| Windows | `%APPDATA%\com.settle.app\settle.sqlite3` |
| macOS | `~/Library/Application Support/com.settle.app/settle.sqlite3` |

**Settings → Your data** shows the actual database path and offers JSON and Markdown exports, including open drafts. Each export gets its own folder under the app-data directory's `exports/` folder. Existing notes and drafts are retained when upgrading.

## Development

Install stable Rust (1.88 or newer) and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). Windows needs the MSVC build tools and WebView2; macOS needs Xcode Command Line Tools. Run these commands from the repository root:

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
```

Rust tests exercise real SQLite databases, migrations, search, and exports. Playwright tests exercise Chromium and WebKit with a mock desktop bridge, covering editing, draft recovery, syntax, preview, shortcuts, tab actions, save failures, and all ten designs. CI runs these checks on Windows and macOS; browser tests do not replace native app testing.

### Bundled libraries

Highlight.js provides syntax highlighting; Marked and DOMPurify provide Markdown rendering and sanitization. All three ship locally in `src/vendor/editor.js`, with licenses in `src/vendor/LICENSES.txt`.

After changing their pinned dependencies or `scripts/vendor-entry.js`, rebuild the bundle:

```sh
npm ci
npm run vendor
```

CI checks that the generated bundle matches its sources. Local design references in `design_concepts/` are ignored by Git and are not needed to build the app.

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

The installer workflow builds both platforms on manual dispatch or a `v*` tag. Tagged builds attach the installers to a GitHub release. macOS builds currently use ad-hoc signing and are not notarized; distribution with Developer ID signing and notarization requires Apple credentials and the corresponding workflow configuration. See the [Tauri macOS signing guide](https://v2.tauri.app/distribute/sign/macos/).
