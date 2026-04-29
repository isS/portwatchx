import test from 'node:test'
import assert from 'node:assert'
import { parseLsofOutput } from '../src/scanner.ts'

test('parseLsofOutput: single IPv4 LISTEN line', () => {
  const input = [
    'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME',
    'node    12345 alice   20u  IPv4 0x1234   0t0  TCP 127.0.0.1:3000 (LISTEN)',
  ].join('\n')
  const rows = parseLsofOutput(input)
  assert.strictEqual(rows.length, 1)
  assert.deepStrictEqual(rows[0], {
    process: 'node',
    pid: 12345,
    user: 'alice',
    protocol: 'TCP',
    address: '127.0.0.1',
    port: 3000,
  })
})

test('parseLsofOutput: IPv6 wildcard listener', () => {
  const input = 'node    9999 bob  21u  IPv6 0xabc 0t0  TCP *:8080 (LISTEN)'
  const rows = parseLsofOutput(input)
  assert.strictEqual(rows.length, 1)
  assert.strictEqual(rows[0].address, '*')
  assert.strictEqual(rows[0].port, 8080)
})

test('parseLsofOutput: deduplicates identical (pid, protocol, port)', () => {
  const line = 'node 1 alice 20u IPv4 0x1 0t0 TCP 127.0.0.1:3000 (LISTEN)'
  const input = [line, line].join('\n')
  const rows = parseLsofOutput(input)
  assert.strictEqual(rows.length, 1)
})

test('parseLsofOutput: skips non-LISTEN lines and headers', () => {
  const input = [
    'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME',
    'node 1 alice 20u IPv4 0x1 0t0 TCP 1.2.3.4:1234->5.6.7.8:80 (ESTABLISHED)',
    '',
  ].join('\n')
  assert.strictEqual(parseLsofOutput(input).length, 0)
})

import { findProjectRoot } from '../src/scanner.ts'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('findProjectRoot: walks up to nearest marker', () => {
  const root = mkdtempSync(join(tmpdir(), 'pwx-'))
  const pkg = join(root, 'my-app')
  const nested = join(pkg, 'src', 'server')
  mkdirSync(nested, { recursive: true })
  writeFileSync(join(pkg, 'package.json'), '{}')

  assert.strictEqual(findProjectRoot(nested, root), pkg)
})

test('findProjectRoot: returns cwd itself when it has a marker', () => {
  const root = mkdtempSync(join(tmpdir(), 'pwx-'))
  const pkg = join(root, 'repo')
  mkdirSync(pkg, { recursive: true })
  writeFileSync(join(pkg, 'pyproject.toml'), '')

  assert.strictEqual(findProjectRoot(pkg, root), pkg)
})

test('findProjectRoot: stops at home directory without a marker', () => {
  const home = mkdtempSync(join(tmpdir(), 'pwx-home-'))
  const child = join(home, 'child', 'grandchild')
  mkdirSync(child, { recursive: true })
  // No marker anywhere; walk should stop at home and return the original path
  assert.strictEqual(findProjectRoot(child, home), child)
})

test('findProjectRoot: returns null for empty input', () => {
  assert.strictEqual(findProjectRoot('', '/tmp'), null)
})

import { isDevService } from '../src/scanner.ts'

test('isDevService: matches node process prefix', () => {
  assert.strictEqual(
    isDevService({ process: 'node', command: '', has_project_marker: false }),
    true,
  )
})

test('isDevService: matches by command token even if process is obscure', () => {
  assert.strictEqual(
    isDevService({ process: 'sh', command: '/bin/sh -c pnpm dev', has_project_marker: false }),
    true,
  )
})

test('isDevService: project marker alone is enough', () => {
  assert.strictEqual(
    isDevService({ process: 'ruby', command: '', has_project_marker: true }),
    true,
  )
})

test('isDevService: unknown process with no marker and no dev token is not dev', () => {
  assert.strictEqual(
    isDevService({ process: 'sshd', command: '/usr/sbin/sshd', has_project_marker: false }),
    false,
  )
})

import { parseEtime } from '../src/scanner.ts'

test('parseEtime: seconds only', () => {
  assert.strictEqual(parseEtime('45'), 45)
})

test('parseEtime: mm:ss', () => {
  assert.strictEqual(parseEtime('12:34'), 12 * 60 + 34)
})

test('parseEtime: hh:mm:ss', () => {
  assert.strictEqual(parseEtime('01:02:03'), 3600 + 120 + 3)
})

test('parseEtime: days-hh:mm:ss', () => {
  assert.strictEqual(parseEtime('2-03:04:05'), 2 * 86400 + 3 * 3600 + 4 * 60 + 5)
})

test('parseEtime: empty string returns 0', () => {
  assert.strictEqual(parseEtime(''), 0)
})

import { decodeLsofProcess } from '../src/scanner.ts'

test('decodeLsofProcess: passes plain names through', () => {
  assert.strictEqual(decodeLsofProcess('node'), 'node')
})

test('decodeLsofProcess: decodes \\x20 escape into space', () => {
  assert.strictEqual(decodeLsofProcess('Google\\x20Chrome'), 'Google Chrome')
})

test('decodeLsofProcess: decodes multiple escapes', () => {
  assert.strictEqual(decodeLsofProcess('A\\x20B\\x09C'), 'A B\tC')
})

test('parseLsofOutput: long process name (no truncation) parses correctly', () => {
  const input = 'com.docker.backend            9239 alice 2793u  IPv6 0x37 0t0  TCP *:9001 (LISTEN)'
  const rows = parseLsofOutput(input)
  assert.strictEqual(rows.length, 1)
  assert.strictEqual(rows[0].process, 'com.docker.backend')
  assert.strictEqual(rows[0].port, 9001)
})

test('parseLsofOutput: process name with escaped space is decoded', () => {
  const input = 'Google\\x20Chrome              17268 alice 59u  IPv4 0xef 0t0  TCP 127.0.0.1:52618 (LISTEN)'
  const rows = parseLsofOutput(input)
  assert.strictEqual(rows.length, 1)
  assert.strictEqual(rows[0].process, 'Google Chrome')
})
