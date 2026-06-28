# portwatchx

> See which local dev project is using each TCP port on your machine.

[![CI](https://github.com/isS/portwatchx/actions/workflows/ci.yml/badge.svg)](https://github.com/isS/portwatchx/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Running several Node / Python projects at once and forgetting which port belongs to which? **portwatchx** is a small, fast local dashboard that lists listening ports, the owning process, and — most importantly — the project directory on disk.

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

## Usage

```sh
portwatchx           # start the dashboard and open it in your browser
portwatchx ls        # print the port table to your terminal (macOS + Linux)
portwatchx tray      # menu-bar icon for quick access (macOS only)
```

## Requirements

- **Node.js ≥ 20**
- **macOS** (full experience) or **Linux** (CLI only)
- `lsof` available in `$PATH` (standard on macOS; install via your package manager on Linux if missing)

Windows is not supported.

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup and workflow.

## License

[MIT](./LICENSE) — © PortwatchX contributors
