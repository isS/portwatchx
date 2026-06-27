# Agent-driven install + tray persistence

**Status:** Approved — ready for implementation plan
**Date:** 2026-05-06 (reviewed & approved 2026-06-28)

**Approved decisions (2026-06-28):**
- Tray refactor goes ahead: tray calls `scanPorts()` directly; dashboard is an on-demand child, not an always-on server. No permanently-bound port.
- npm publish is **prepared but not executed by the agent**: package.json changes, the publish workflow, and `install.md` are written; the actual `npm publish` and the `NPM_TOKEN` repo secret are user-performed handoff steps (the agent cannot and will not publish). npm name `portwatchx` confirmed available (registry 404 on 2026-06-28).

## Problem

Two related issues with portwatchx today:

1. **Install via agent is non-deterministic.** README tells users to paste "install this" into a coding agent. Different agents (Claude Code, Codex, Cursor, Cline) take different paths; some skip the build, some try `npm link` with sudo, some don't verify. There's no machine-readable manifest the agent can follow.
2. **Tray and dashboard die when the launching terminal closes.** `portwatchx` and `portwatchx tray` run as foreground children of the user's shell. Closing the terminal kills them. A menu-bar tray that disappears on terminal close isn't really "installed".

This spec covers a single coherent fix: make `portwatchx` installable in one paste with a deterministic manifest, ship as an npm package, and run the tray as a macOS LaunchAgent so it survives terminal close, logout, and reboot.

## Goals

- One copy-paste install path that works the same across Claude Code, Codex, Cursor, Cline.
- One copy-paste CLI install path for users who don't want to use an agent.
- Tray persists across terminal close and reboot. Quit from the tray ends everything.
- Conservative: no sudo, no shell-rc edits, idempotent install/uninstall.

## Non-goals

- Linux tray support (still macOS-only; existing CLI fallback unchanged).
- Windows support.
- Auto-updating portwatchx itself (`npm update -g portwatchx` is the upgrade path).

(Note: "killing user processes from the UI" was a non-goal in the original draft; it shipped separately via `POST /api/kill` and is unrelated to this spec.)

## Components

**New files:**
- `install.md` (repo root) — machine-readable install manifest fetched by the agent. Plain Markdown, numbered steps, "do not" rules.
- `src/launchd.ts` — generates the `com.portwatchx.tray.plist`, runs `launchctl bootstrap`/`bootout`, manages the file at `~/Library/LaunchAgents/com.portwatchx.tray.plist`.
- `.github/workflows/publish.yml` — publishes to npm on `v*` tag push.

**Modified files:**
- `src/cli.ts` — default command branches by platform; add `tray --install` / `--uninstall` / `--foreground`; add explicit `dashboard` subcommand.
- `src/tray.ts` — tray now owns the dashboard child process; calls `scanPorts()` directly instead of HTTP-polling the server.
- `package.json` — drop `private: true`, add `publishConfig: { access: "public" }`.
- `README.md` — replace "Install with a coding agent" section with the two-mode install (Prompt + CLI).
- `CLAUDE.md` — no change (it's the dev guide; the install manifest is `install.md`).

**Deleted code paths:** the polling/HTTP loop in `src/cli.ts::trayAction` (server start + setInterval + `fetchScanData`). Tray uses scanner directly.

## Install UX

### README `## Install` section

```markdown
## Install

**Prompt mode** — paste into Claude Code, Codex, Cursor, or Cline:

    Install portwatchx — a local TCP-port dashboard.
    Manifest: https://raw.githubusercontent.com/isS/portwatchx/main/install.md
    Read the manifest and follow it exactly.
    Keep the work scoped to this install only.

**CLI mode** — paste into a terminal:

    npm install -g portwatchx
    portwatchx tray --install   # macOS only

What this does:
1. Installs portwatchx via npm
2. Verifies with `portwatchx ls`
3. (macOS) Loads the menu-bar tray as a LaunchAgent that survives reboot
```

### `install.md` (repo root)

```markdown
# Install portwatchx

You are an AI coding agent installing portwatchx (a local TCP-port
dashboard). Follow these steps in order. If any step fails, stop and
ask the user — do not retry, do not improvise.

1. node --version            (must be >= 20)
2. npm install -g portwatchx
3. portwatchx ls             (verification — must print a table or "No dev services")
4. (macOS only) portwatchx tray --install

## Do not
- Run sudo for any of these.
- Start the dashboard from your own shell (it dies when your shell exits;
  use step 4 instead).
```

## CLI surface

| Command | Behavior |
|---|---|
| `portwatchx` (default) | macOS: start tray. Linux: start dashboard in foreground (existing behavior). |
| `portwatchx ls` | Unchanged. |
| `portwatchx tray` | Explicit alias for default on macOS. |
| `portwatchx tray --install` | Write LaunchAgent plist, `launchctl bootstrap`. Idempotent: refuses if already installed. |
| `portwatchx tray --uninstall` | `launchctl bootout`, remove plist. Idempotent: succeeds with "not installed" message if absent. |
| `portwatchx dashboard` | Run only the dashboard server in foreground. Used by tray to spawn dashboard children, and by power users for headless / debugging. |

## Tray menu and lifecycle

```
portwatchx · 3 dev / 12 listening      [disabled header]
─────────────────────────────────
3000  project-a                        [click → open http://localhost:3000]
8080  project-b
…  (top 12 dev services)
─────────────────────────────────
All Listeners (12)                     [submenu]
─────────────────────────────────
Open Dashboard       [shown when no dashboard child running]
Stop Dashboard       [shown when dashboard child running]
Refresh
─────────────────────────────────
Quit
```

**Behaviors:**
- *Click port row*: open `http://localhost:<port>` in the default browser.
- *Open Dashboard*: spawn `portwatchx dashboard` as a detached child; child writes its bound port to stdout on startup; tray reads the port, opens the browser to it, flips the menu item to *Stop Dashboard*. On `child.on('exit')`, the menu item flips back automatically.
- *Stop Dashboard*: `child.kill('SIGTERM')`. Menu flips back.
- *Refresh*: trigger an immediate scan.
- *Quit*: kill any dashboard child, exit tray with code 0. LaunchAgent's `KeepAlive.SuccessfulExit: false` keeps launchd from relaunching after a clean quit.

**Implementation note:** the new tray calls `scanPorts()` directly. The HTTP poll path (`fetchScanData`) is removed.

## Persistence — launchd plist

**Location:** `~/Library/LaunchAgents/com.portwatchx.tray.plist`

**Plist (placeholders filled at install time):**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>                  <string>com.portwatchx.tray</string>
    <key>ProgramArguments</key>
    <array>
        <string>{ABSOLUTE_PATH_TO_NODE}</string>
        <string>{ABSOLUTE_PATH_TO_CLI_JS}</string>
        <string>tray</string>
    </array>
    <key>RunAtLoad</key>              <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>     <false/>
    </dict>
    <key>StandardOutPath</key>        <string>{HOME}/Library/Logs/portwatchx/tray.log</string>
    <key>StandardErrorPath</key>      <string>{HOME}/Library/Logs/portwatchx/tray.err.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>               <string>{NODE_BIN_DIR}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
```

**Why these settings:**
- `KeepAlive.SuccessfulExit: false` — restart on crash (exit code != 0), stay gone after explicit *Quit*.
- `ProgramArguments` invokes the **absolute node binary + absolute `cli.js`** directly, not the `portwatchx` shebang wrapper. Rationale: launchd execs with a stripped PATH, so a `#!/usr/bin/env node` shebang can't resolve `node` when it lives outside the static PATH (e.g. nvm at `~/.nvm/versions/node/<v>/bin`). Calling node by absolute path removes that dependency entirely.
- `EnvironmentVariables.PATH` — launchd strips PATH; the scanner shells out to `lsof` (`/usr/sbin`) and `ps` (`/bin`), both covered by the static entries. `{NODE_BIN_DIR}` is prepended so any child the tray spawns (the `dashboard` subprocess) can also find node.

**Path resolution at install time (decided 2026-06-28):**
- `{ABSOLUTE_PATH_TO_NODE}` = `process.execPath` (the running node's absolute path).
- `{NODE_BIN_DIR}` = `path.dirname(process.execPath)`.
- `{ABSOLUTE_PATH_TO_CLI_JS}` = the installed `dist/cli.js`. Resolve from `process.argv[1]` (realpath'd to follow the npm bin symlink), or from `import.meta.url` of the launchd module. Must be the real file, not the symlink.

**Install procedure (`portwatchx tray --install`):**
1. Resolve `process.execPath` (node) and the real `dist/cli.js` path (realpath of `process.argv[1]`).
2. Ensure `~/Library/Logs/portwatchx/` exists.
3. Generate plist; lint with `plutil -lint` before writing.
4. Write to `~/Library/LaunchAgents/com.portwatchx.tray.plist`.
5. `launchctl bootstrap gui/$UID <plist>`.
6. Print success message including the path of the plist for transparency.

**Uninstall (`--uninstall`):** `launchctl bootout gui/$UID/com.portwatchx.tray` → remove plist → exit 0. Logs are kept.

**Idempotency:**
- `--install` when already loaded: refuse with "already installed; run `portwatchx tray --uninstall` first".
- `--uninstall` when not loaded: print "not installed" and exit 0.

## npm publish

**`package.json` diff:**
```diff
- "private": true,
+ "publishConfig": { "access": "public" },
```

`files` array unchanged (`dist`, `README.md`, `LICENSE`, `CHANGELOG.md`). The npm tarball does not include `install.md` — the prompt points at the GitHub raw URL, which is always current.

**Release flow (MVP):**
- First release: manual `npm version <patch|minor|major> && npm publish` from a clean checkout, to validate the path.
- Subsequent releases: GitHub Actions on `v*` tag push, gated by `NPM_TOKEN` repo secret.

**Agent/user split (decided 2026-06-28):** the agent prepares everything that doesn't need credentials — `package.json` edits, `.github/workflows/publish.yml`, `install.md`. The two credentialed/irreversible steps are the user's:
1. Run the first `npm publish` (agent provides the exact commands).
2. Add the `NPM_TOKEN` repo secret on GitHub so the workflow can publish later.
Until step 1 is done, `install.md`'s `npm install -g portwatchx` will not resolve — this is expected and gated behind the user's publish.

**Workflow** (`.github/workflows/publish.yml`):
- Triggers on `push` of tags matching `v*`.
- Runs `npm ci`, `npm run build`, `npm test`, `npm publish --access public`.
- Uses `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`.

## Testing

**Unchanged:** `test/scanner.test.ts`, `test/server.test.ts`, `test/cli-guard.test.ts` (already covers the Linux tray rejection path).

**New (both darwin-skipped on non-darwin):**
- `test/launchd.test.ts` — `buildPlist({ nodePath, cliPath, nodeBinDir, logDir })` returns expected XML; verify `Label`, `ProgramArguments` is `[nodePath, cliPath, "tray"]`, `PATH` starts with `nodeBinDir`, `KeepAlive.SuccessfulExit=false`; `plutil -lint` accepts output.
- `test/cli-tray-install.test.ts` — `--install` writes the plist and invokes `launchctl` (mocked); `--uninstall` reverses it; idempotency cases (re-install refused; uninstall when absent succeeds).

**Manual verification** (documented in `CONTRIBUTING.md`):
- Real macOS: `tray --install` → plist exists → `launchctl list | grep com.portwatchx.tray` → tray icon visible in menu bar.
- Reboot → tray reappears.
- *Quit* from tray → `launchctl list` no longer lists service (KeepAlive only restarts on crash).
- `tray --uninstall` → plist gone, service unloaded, logs preserved.

CI does not run macOS-specific paths (no macOS runner needed for MVP).

## Out of scope (deferred)

- Tray badge / count in menu bar title.
- Notifications when a new dev service appears.
- Linux tray.
- AGENTS.md as a contributor guide (separate concern from install).
- Custom domain for the manifest URL (raw GitHub URL is fine).
