#!/usr/bin/env node

import { mkdtempSync, rmSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

function fail(message) {
  process.stderr.write(`binary smoke failed: ${message}\n`);
  process.exitCode = 1;
}

const argument = process.argv[2];
if (!argument) {
  fail('usage: node scripts/smoke-binary.mjs PATH_TO_BINARY');
} else {
  const executable = resolve(process.cwd(), argument);
  const run = (args) => spawnSync(executable, args, {
    encoding: 'utf8',
    windowsHide: true,
  });
  const resultError = (result) => result.error instanceof Error ? result.error.message : undefined;
  const output = (result) => `${result.stdout ?? ''}`.trim();
  const version = run(['--version']);
  if (resultError(version)) {
    fail(`--version could not start ${basename(executable)}${extname(executable).toLowerCase() === '.exe' ? ' (.exe)' : ''}: ${resultError(version)}`);
  } else if (version.status !== 0 || version.signal !== null) {
    fail(`--version exited unsuccessfully (status=${version.status}, signal=${version.signal ?? 'none'}): ${output(version) || `${version.stderr ?? ''}`.trim()}`);
  } else if (!output(version)) {
    fail('--version succeeded but emitted no version');
  } else {
    const steamRoot = mkdtempSync(join(tmpdir(), 'fractured-companion-smoke-'));
    try {
      const doctor = run(['doctor', '--json', '--steam-root', steamRoot]);
      if (resultError(doctor)) {
        fail(`doctor --json could not start: ${resultError(doctor)}`);
      } else if (doctor.status === 0 || doctor.signal !== null) {
        fail(`doctor --json must exit nonzero for an empty Steam root (status=${doctor.status}, signal=${doctor.signal ?? 'none'})`);
      } else {
        let diagnostics;
        try {
          diagnostics = JSON.parse(output(doctor));
        } catch (error) {
          fail(`doctor --json emitted invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (diagnostics !== undefined && (!Array.isArray(diagnostics) || diagnostics.length === 0 || diagnostics.some((row) => (
          row === null || typeof row !== 'object' || typeof row.status !== 'string' || typeof row.check !== 'string' || typeof row.message !== 'string'
        )))) {
          fail('doctor --json did not emit a diagnostic row array');
        } else if (diagnostics !== undefined) {
          process.stdout.write(`Binary smoke passed: ${basename(executable)}\n`);
        }
      }
    } finally {
      rmSync(steamRoot, { recursive: true, force: true });
    }
  }
}
