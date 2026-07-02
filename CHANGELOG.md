# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-07-02

### Added
- Persist the macOS tray across terminal close, logout, and reboot via a launchd LaunchAgent (`portwatchx tray --install` / `portwatchx tray --uninstall`).
- On-demand dashboard: the tray starts and stops the dashboard as a child process; new `portwatchx dashboard` subcommand runs the server headlessly.
- Single-instance guard so only one tray runs at a time.
- Kill a port's process directly from the dashboard (skull button with two-step confirm; `POST /api/kill`).
- Agent/CLI install manifest (`install.md`) and an npm publish GitHub Actions workflow.

### Changed
- The default `portwatchx` command is platform-branched: macOS starts the menu-bar tray; other platforms open the dashboard in the browser.
- The tray scans ports directly instead of polling the HTTP server.

## [0.1.0] - 2026-04-29

### Added
- Initial public release.
- Web dashboard for listening TCP ports with project-on-disk identification.
- `portwatchx ls` CLI with `--all` / `--dev` filters.
- `portwatchx tray` macOS menu-bar app.

[Unreleased]: https://github.com/isS/portwatchx/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/isS/portwatchx/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/isS/portwatchx/releases/tag/v0.1.0
