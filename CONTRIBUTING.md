# Contributing

Thanks for wanting to contribute. This project aims to stay **small, focused, and opinionated** — please read through the [Scope](#scope) section below before opening a PR so your change lines up with the direction.

## Setup

```sh
git clone https://github.com/isS/portwatchx
cd portwatchx
npm install
```

## Develop

```sh
npm run dev          # watch mode for the CLI + UI
npm test             # run the test suite
npm run build        # build for production
```

## Code style

- TypeScript. Strict mode.
- Two-space indent, LF line endings — enforced by `.editorconfig` and `.gitattributes`.
- Prefer small, focused files. When a file grows past ~200 lines, that's usually a signal to split.
- No runtime dependencies unless they pull their weight. The install footprint is a feature.

## Pull requests

- One topic per PR. Unrelated refactors go in separate PRs.
- Include tests for new behavior. Bug fixes should start with a failing test that reproduces the bug.
- Commit messages: [Conventional Commits](https://www.conventionalcommits.org/) preferred (`feat:`, `fix:`, `docs:`, etc.), but not strictly enforced.
- The CI workflow (`.github/workflows/ci.yml`) must be green before merge.

## Reporting bugs

Use the [bug report template](https://github.com/isS/portwatchx/issues/new?template=bug_report.yml). Include your OS, Node version, and `portwatchx --version`.

## Scope

Features that are **in scope**:
- Improving port detection accuracy (parsing edge cases, new project markers, better process identification)
- UI polish and accessibility
- Performance

Features that are **out of scope** for v1:
- Windows support
- Killing processes from the UI
- Remote / multi-machine mode

If you're unsure, open a discussion before writing code.
