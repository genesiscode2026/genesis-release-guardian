// Security regression tests for the GENESIS Release Guardian GitHub Action.
// These are source-scan invariants (no network, no keys) — they assert the
// action never exposes buyer credentials, never executes shell code, and never
// ships an unsafe dependency graph.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src', 'index.js'), 'utf8');
const action = readFileSync(join(root, 'action.yml'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

test('action uses node20 runtime and requires buyer private-key input', () => {
  assert.match(action, /using:\s*'?node20'?/);
  assert.match(action, /private-key:/);
  assert.match(action, /required:\s*true/);
});

test('no shell execution primitives are used', () => {
  assert.ok(!/child_process/.test(src), 'no child_process import');
  assert.ok(!/execSync|exec\(|spawn\(|execFile/.test(src), 'no exec/spawn calls');
});

test('no hardcoded private keys or seed phrases', () => {
  assert.ok(!/0x[0-9a-fA-F]{64}/.test(src), 'no 64-hex private key literal');
  assert.ok(!/(seed|mnemonic)\s*phrase/i.test(src), 'no seed phrase');
});

test('buyer key is masked and never interpolated into logs', () => {
  assert.ok(src.includes('mask(privateKey)'), 'mask() is invoked with the key');
  assert.ok(!src.includes('console.log(privateKey)'), 'private key is never printed directly');
  // The key must never be embedded in a log/error/warning string.
  assert.ok(!/(console\.log|::error::|::warning::)[^;\n]*privateKey/.test(src), 'key never interpolated into logs');
});

test('spending ceiling is enforced against the live challenge amount', () => {
  assert.match(src, /amountUsd\s*>\s*maxSpend/, 'ceiling check present');
  assert.match(src, /aborting before payment/, 'aborts before signing');
});

test('no @actions/* dependency (avoids vulnerable undici chain)', () => {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  assert.ok(!Object.keys(deps).some((d) => d.startsWith('@actions/')), 'no @actions/* deps');
});

test('action does not instruct pull_request_target anywhere', () => {
  assert.ok(!/pull_request_target/.test(action), 'no pull_request_target');
});
