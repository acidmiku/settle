# Settle — keyboard-first smart notebook

Desktop app built with **Rust + Tauri v2** and a lightweight web frontend.

## Dev prerequisites

- Rust (stable)
- Tauri prerequisites (platform toolchains)

## Run (dev)

From the repo root:

```bash
cd src-tauri
cargo run
```

If your environment sets proxy vars (e.g. `HTTP_PROXY`) or forces Cargo offline (e.g. `CARGO_NET_OFFLINE=true`),
use the helper script instead:

```bash
scripts\dev.cmd
```

This project serves the frontend as static assets from `../src/`.

## Project layout

- `src-tauri/`: Rust backend (Tauri, SQLite, commands, LLM, export)
- `src/`: Frontend (HTML/CSS/JS)

