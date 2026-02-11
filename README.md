# Settle

Settle is a **keyboard-first notes app for Windows** built with **Rust + Tauri v2** and a lightweight **HTML/CSS/JS** frontend.

It’s designed for fast capture (daily notes) and later retrieval via a “second brain” view (summaries + categories + search).

## Features

- **Day Notes**: quick append-only capture with timestamps + tags.
- **Second Brain**:
  - daily summaries (timeline)
  - categories & entries derived from summaries
  - summaries are **grouped by day** (and categories are shown under each day).
- **Search** across raw notes + second brain entries.
- **LLM summarization** (OpenAI-compatible API):
  - auto mode: saves immediately
  - suggest mode: review & edit before saving
  - summaries are generated in the **same language as the notes** (dominant language detection).
- **Export**: JSON + Markdown.
- **Terminal-inspired UI** with multiple themes (light + dark).
- **Custom window chrome** (borderless titlebar, custom controls).

## Keyboard shortcuts

- **Save note**: `Shift+Enter` (or `Enter` if enabled in Settings)
- **Copy & clear input**: `Ctrl/Cmd+Enter`
- **Hide window**: `Esc`
- **Switch tabs**: `Ctrl/Cmd+1` (Day Notes), `Ctrl/Cmd+2` (Second Brain)
- **Search**: `Ctrl/Cmd+K`
- **Settings**: `Ctrl/Cmd+,`
- **Summarize Day**: `Ctrl/Cmd+E`

## Data storage

- Notes are stored in a local SQLite DB in your OS **app data directory**:
  - `%APPDATA%\\com.settle.app\\settle.sqlite3` (path is shown in Settings → Data)
- No cloud sync by default.

## Project layout

- `src-tauri/`: Rust backend (Tauri, SQLite, commands, LLM client, export, migrations)
- `src/`: frontend (static assets: `index.html`, `styles/`, `js/`)
- `scripts/`: helper scripts for Windows builds

## Development (Windows)

### Prerequisites

- Rust stable
- Tauri prerequisites for Windows (MSVC toolchain, WebView2 runtime, etc.)

### Run (dev)

Use the helper script (recommended on this machine; it clears proxy vars and avoids Cargo offline issues):

```bat
scripts\dev.cmd
```

### Build (debug)

```bat
scripts\build.cmd
```

## Production build (NSIS installer)

From the repo root:

```bat
cd src-tauri
cargo tauri build --ci -b nsis
```

Output:

- `src-tauri\\target\\release\\bundle\\nsis\\Settle_0.1.0_x64-setup.exe`
