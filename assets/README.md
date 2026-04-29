# Assets

Source files for icons and other static art. Built artifacts (e.g. base64 PNGs
embedded in `src/`) are regenerated from these.

## Tray icon

Source: `tray-icon.svg`. The inlined base64 PNG in `src/tray.ts` is hand-built
by `gen-tray-icon.cjs` (qlmanage produces empty PNGs from this SVG on recent
macOS versions, so we render the silhouette directly):

```sh
node assets/gen-tray-icon.cjs
```

Paste the resulting base64 string into `ICON_BASE64` at the top of `src/tray.ts`.
