# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm run dev          # run the CLI from source via tsx (e.g. `npm run dev -- ls`)
npm run dev:ui       # vite dev server for the UI on :5173, proxying /api → :7575
npm run build        # build CLI (tsc → dist/) and UI (vite → dist/ui/)
npm run build:ui     # UI-only: typecheck (tsconfig.ui.json) + vite build
npm test             # run the node:test suite (no watch mode)

# Run a single test file:
node --import tsx --test test/scanner.test.ts

# Run the built binary locally:
node dist/cli.js ls
node dist/cli.js              # default command: start the dashboard
node dist/cli.js tray         # macOS only
```

The default dashboard port is `7575` and auto-increments up to 10 times if busy (`startWithAutoPort` in `src/cli.ts`).

## Architecture

Two TypeScript build targets that ship together:

- **CLI / server** (`src/`, `tsconfig.json`, output `dist/`): Node ESM, target ES2022, `module: NodeNext`. Bundled binary is `dist/cli.js` (the `bin` entry in `package.json`).
- **UI** (`ui/`, `tsconfig.ui.json`, output `dist/ui/`): React 19 + Tailwind, bundled by Vite. Typecheck-only via `tsc -p tsconfig.ui.json` (`noEmit: true`); Vite emits the actual JS.

The server (`src/server.ts`) serves the built UI as static files from `dist/ui/` (resolved relative to `import.meta.url` → `<dist>/ui`). The CLI build outputs to `dist/`, the UI build outputs to `dist/ui/`, so the runtime path resolution works in production.

### Data flow

1. `src/scanner.ts::scanPorts()` shells out to `lsof +c 0 -nP -iTCP -sTCP:LISTEN`, parses each LISTEN row (`parseLsofOutput`), then enriches each row by spawning `ps` (for `command`, `etime`) and `lsof -d cwd` (for the process's working directory) per PID.
2. `findProjectRoot(cwd)` walks up from the cwd looking for `PROJECT_MARKERS` (`.git`, `package.json`, `pyproject.toml`, etc.) — this is what makes a port row "belong" to a project on disk.
3. `isDevService(row)` classifies via process-name prefix, command-token regex, or presence of a project marker. The `--dev` filter (default in CLI and UI) keys off this flag.
4. `src/server.ts` exposes `GET /api/ports` returning `{ success, data: { ports, total, identified_projects, dev_services, self_pid, refreshed_at } }`. The UI in `ui/App.tsx` polls this on mount and on the `r` keybinding.

### Tray (macOS only)

`src/tray.ts` is dynamically imported only on darwin. It uses `systray2` with a quirk worth knowing: under Node ESM interop, the class lives at `module.default.default` (one extra namespace level) — see the `(SysTrayModule as any).default?.default ?? …` fallback chain. Each tick tears down the previous `SysTray` instance and creates a fresh one because `update-menu` doesn't reliably redraw on macOS.

### CLI guard test

`test/cli-guard.test.ts` is platform-conditional — it skips on darwin and asserts that `tray` exits non-zero with "Tray is macOS only" on Linux. Keep this guarantee when changing `trayAction` in `src/cli.ts`.

## Project conventions

- Node ≥ 20. macOS full experience, Linux CLI-only, Windows unsupported (`os` field in `package.json`).
- TypeScript strict mode. ESM throughout (`"type": "module"`). All cross-file imports use the `.js` extension even though sources are `.ts` (NodeNext requirement).
- Two-space indent, LF line endings (enforced by `.editorconfig` / `.gitattributes`).
- Per CONTRIBUTING.md: small focused files (~200 line soft limit), no runtime dependency unless it pulls its weight, one topic per PR, new behavior needs a test.
- Out of scope for v1: Windows support, remote/multi-machine mode. Don't add code for these without prior discussion.
- Killing processes from the UI is supported via `POST /api/kill` (`{ pid, signal? }`, signal normalized to `SIGTERM`/`SIGKILL`, refuses to kill `self_pid`). The table's red skull button arms on first click and kills on the second.
