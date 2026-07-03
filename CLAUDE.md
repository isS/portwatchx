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
node dist/cli.js                  # default: macOS starts the tray; else opens the dashboard
node dist/cli.js dashboard        # headless dashboard server (prints its bound port line)
node dist/cli.js tray             # macOS menu-bar tray (foreground)
node dist/cli.js tray --install   # install as a launchd LaunchAgent (persists across reboot)
node dist/cli.js tray --uninstall # remove the LaunchAgent
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

`src/tray.ts` and the tray path in `src/cli.ts::trayAction` are dynamically imported only on darwin.

- The tray scans ports **directly** via `scanPorts()` (`collectScanData`), not by polling the HTTP server.
- The dashboard is **on-demand**: the tray spawns `portwatchx dashboard` as a child process only when "Open Dashboard" is clicked (`src/dashboard.ts`), and stops it on "Stop Dashboard"/Quit. There is no always-on server.
- `portwatchx tray --install` writes a launchd LaunchAgent (`src/launchd.ts`) so the tray survives terminal close / logout / reboot. The plist invokes the **absolute node binary + absolute `dist/cli.js`** (not an `env node` shebang) so it works when node is under nvm; PATH is prepended with the node bin dir. `--uninstall` removes it. Quit ends it (`KeepAlive.SuccessfulExit=false` restarts only on crash).
- A pid-lock (`src/single-instance.ts`, at `~/Library/Application Support/portwatchx/tray.pid`) prevents a second tray instance; a second `tray` prints "already running" and exits.
- systray2 quirk: under Node ESM interop the class lives at `module.default.default`; each redraw tears down the previous `SysTray` instance because `update-menu` doesn't reliably redraw on macOS.

### CLI guard test

`test/cli-guard.test.ts` is platform-conditional — it skips on darwin and asserts that `tray` exits non-zero with "Tray is macOS only" on Linux. Keep this guarantee when changing `trayAction` in `src/cli.ts`.

## Project conventions

- Node ≥ 20. macOS full experience, Linux CLI-only, Windows unsupported (`os` field in `package.json`).
- TypeScript strict mode. ESM throughout (`"type": "module"`). All cross-file imports use the `.js` extension even though sources are `.ts` (NodeNext requirement).
- Two-space indent, LF line endings (enforced by `.editorconfig` / `.gitattributes`).
- Per CONTRIBUTING.md: small focused files (~200 line soft limit), no runtime dependency unless it pulls its weight, one topic per PR, new behavior needs a test.
- Out of scope: Windows support, remote/multi-machine mode. Don't add code for these without prior discussion.
- Killing processes from the UI is supported via `POST /api/kill` (`{ pid, signal? }`, signal normalized to `SIGTERM`/`SIGKILL`, refuses to kill `self_pid`). The table's red skull button arms on first click and kills on the second.

## Releasing (standard)

Published to npm as `portwatchx`, from `main`. Follow this exactly.

**Environment invariants (already configured — don't undo):**
- `package.json` `publishConfig.registry` is pinned to `https://registry.npmjs.org`. This is required because the machine's default npm registry may be a read-only mirror (e.g. `registry.npmmirror.com`); the pin makes `npm publish` target the official registry with no `--registry` flag.
- The `NPM_TOKEN` GitHub Actions secret is set, so `.github/workflows/publish.yml` publishes automatically on a `v*` tag push.

**Cut a release:**
1. On a feature branch, bump the version to a **new, unused** number: `npm version <patch|minor|major> --no-git-tag-version`. Verify it's unused: `git tag` and `npm view portwatchx version --registry https://registry.npmjs.org`.
2. Add a dated section to `CHANGELOG.md` and update the compare links at the bottom.
3. Open a PR and **squash-merge** to `main` (the repo disallows merge commits).
4. Tag the merged commit and push it — this triggers the publish workflow:
   ```sh
   git checkout main && git pull --ff-only
   git tag -a vX.Y.Z -m "portwatchx vX.Y.Z" && git push origin vX.Y.Z
   ```
5. CI runs `npm ci → build → test → npm publish`. Optionally `gh release create vX.Y.Z --notes-file -` from the changelog section.

**Manual publish fallback** (CI unavailable): from a clean `main` with the version bumped, `npm run build && npm publish` (no `--registry` flag needed thanks to the pin; requires a valid npmjs.org token — `npm whoami --registry https://registry.npmjs.org`).

**Never** publish a version that already exists, and never commit an `NPM_TOKEN` value to the repo.
