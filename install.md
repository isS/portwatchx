# Install portwatchx

You are an AI coding agent installing portwatchx (a local TCP-port
dashboard). Follow these steps in order. If any step fails, stop and
ask the user — do not retry, do not improvise.

1. `node --version`            (must be >= 20)
2. `npm install -g portwatchx`
3. `portwatchx ls`             (verification — must print a table or "No dev services")
4. (macOS only) `portwatchx tray --install`

## Do not
- Run sudo for any of these.
- Start the dashboard from your own shell (it dies when your shell exits;
  use step 4 instead).
