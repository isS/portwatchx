# portwatchx

> See which local dev project is using each TCP port on your machine.

[![CI](https://github.com/isS/portwatchx/actions/workflows/ci.yml/badge.svg)](https://github.com/isS/portwatchx/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Running several Node / Python projects at once and forgetting which port belongs to which? **portwatchx** is a small, fast local dashboard that lists listening ports, the owning process, and — most importantly — the project directory on disk.

## Install

### With a coding agent

Send your coding agent (Claude Code, Codex, Cursor, Cline, etc.) this repo and say **"install this"**:

```
https://github.com/isS/portwatchx
```

The agent will clone, run `npm install && npm run build`, and verify with `portwatchx ls`. Takes about 30 seconds.

### Manually

```sh
git clone https://github.com/isS/portwatchx
cd portwatchx
npm install && npm run build
npm link            # optional: makes `portwatchx` available globally
```

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
