import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

const execFile = promisify(execFileCb)

export const LABEL = 'com.portwatchx.tray'

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export type Runner = (cmd: string, args: string[]) => Promise<void>
const defaultRunner: Runner = async (cmd, args) => { await execFile(cmd, args) }

export function plistPath(home: string = homedir()): string {
  return join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`)
}

export function buildPlist(o: { nodePath: string; cliPath: string; nodeBinDir: string; logDir: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${xmlEscape(o.nodePath)}</string>
        <string>${xmlEscape(o.cliPath)}</string>
        <string>tray</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>StandardOutPath</key>
    <string>${xmlEscape(o.logDir)}/tray.log</string>
    <key>StandardErrorPath</key>
    <string>${xmlEscape(o.logDir)}/tray.err.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${xmlEscape(o.nodeBinDir)}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
`
}

function uid(): number {
  // getuid is present on darwin/linux; tray --install is darwin-gated upstream.
  return typeof process.getuid === 'function' ? process.getuid() : 0
}

export async function isInstalled(run: Runner = defaultRunner): Promise<boolean> {
  try {
    await run('launchctl', ['print', `gui/${uid()}/${LABEL}`])
    return true
  } catch {
    return false
  }
}

export async function installAgent(
  o: { nodePath: string; cliPath: string; nodeBinDir: string },
  run: Runner = defaultRunner,
  home: string = homedir(),
): Promise<string> {
  if (await isInstalled(run)) {
    throw new Error('already installed; run `portwatchx tray --uninstall` first')
  }
  const logDir = join(home, 'Library', 'Logs', 'portwatchx')
  await mkdir(logDir, { recursive: true })
  const path = plistPath(home)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, buildPlist({ ...o, logDir }), 'utf8')
  try {
    await run('plutil', ['-lint', path])
  } catch (err) {
    await rm(path, { force: true })
    throw new Error(`generated plist failed plutil -lint: ${err instanceof Error ? err.message : err}`)
  }
  await run('launchctl', ['bootstrap', `gui/${uid()}`, path])
  return path
}

export async function uninstallAgent(run: Runner = defaultRunner, home: string = homedir()): Promise<boolean> {
  const path = plistPath(home)
  const existed = existsSync(path)
  // Attempt bootout regardless of plist presence, so a loaded-but-fileless agent is still unloaded.
  try { await run('launchctl', ['bootout', `gui/${uid()}/${LABEL}`]) } catch { /* not loaded */ }
  await rm(path, { force: true })
  return existed
}
