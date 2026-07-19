#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { formatDoctor, runDoctor, type DoctorOptions } from './doctor.ts';
import { launchCompanion, type LaunchOptions } from './launch.ts';
import { refreshCompanion, type RefreshOptions } from './refresh.ts';
import { restoreCompanion, type RestoreOptions } from './restore.ts';

export const VERSION = '0.1.0';

const COMMANDS = new Set(['doctor', 'refresh', 'restore', 'launch']);
const OPTION_NAMES = new Set(['steam-root', 'bottle', 'json', 'no-open', 'no-patch', 'help', 'version']);
const COMMAND_ONLY = new Set(['json', 'no-open', 'no-patch']);
const STRING_OPTIONS = new Set(['steam-root', 'bottle']);

const USAGE = `Usage: fractured-companion <command> [options]

Commands:
  doctor                 Check the local game installation
  refresh                Extract game data and update the patch
  restore                Restore the original game archive
  launch                 Launch Fractured Realms with the companion

Options:
  --steam-root PATH      Use an explicit Steam installation root
  --bottle NAME          CrossOver bottle name (macOS)
  --json                 Emit doctor rows as JSON
  --no-open              Do not open the companion browser (launch)
  --no-patch             Extract data without patching (refresh)
  --help                 Show this help
  --version              Print the CLI version
`;

type Output = ((text: string) => unknown) | { write(text: string): unknown };

export interface CliDependencies {
  runDoctor?: typeof runDoctor;
  refreshCompanion?: typeof refreshCompanion;
  restoreCompanion?: typeof restoreCompanion;
  launchCompanion?: typeof launchCompanion;
  stdout?: Output;
  stderr?: Output;
}

type ParsedValues = {
  'steam-root'?: string;
  bottle?: string;
  json?: boolean;
  'no-open'?: boolean;
  'no-patch'?: boolean;
  help?: boolean;
  version?: boolean;
};

function write(output: Output, text: string): void {
  if (typeof output === 'function') { output(text); return; }
  output.write(text);
}

function usageError(stderr: Output, message: string): 2 {
  write(stderr, `${message}
${USAGE}`);
  return 2;
}

function parseCommand(argv: readonly string[], stderr: Output): { command?: string; values?: ParsedValues; code?: 2 } {
  const commandSpecificBeforeCommand = (() => {
    let commandSeen = false;
    let duplicate = new Set<string>();
    for (let index = 0; index < argv.length; index += 1) {
      const token = argv[index]!;
      if (token === '--') return 'the -- terminator is not supported';
      if (!token.startsWith('--')) {
        if (!commandSeen) commandSeen = true;
        continue;
      }
      const equals = token.indexOf('=');
      const name = token.slice(2, equals < 0 ? undefined : equals);
      if (!OPTION_NAMES.has(name)) return `unknown option '--${name}'`;
      if (duplicate.has(name)) return `duplicate option '--${name}'`;
      duplicate.add(name);
      if (COMMAND_ONLY.has(name) && !commandSeen) return `option '--${name}' must follow a command`;
      if (STRING_OPTIONS.has(name) && equals < 0) index += 1;
    }
    return undefined;
  })();
  if (commandSpecificBeforeCommand) return { code: usageError(stderr, commandSpecificBeforeCommand) };

  let parsed: ReturnType<typeof parseArgs>;
  try {
    const options: ParseArgsConfig['options'] = {
      'steam-root': { type: 'string' },
      bottle: { type: 'string' },
      json: { type: 'boolean' },
      'no-open': { type: 'boolean' },
      'no-patch': { type: 'boolean' },
      help: { type: 'boolean' },
      version: { type: 'boolean' },
    };
    parsed = parseArgs({ args: [...argv], options, strict: true, allowPositionals: true });
  } catch (error) {
    const message = error instanceof Error ? error.message.split(/\r?\n/u)[0] : String(error);
    return { code: usageError(stderr, message) };
  }
  const values = parsed.values as ParsedValues;
  const positionals = parsed.positionals;
  if (positionals.length > 1) return { code: usageError(stderr, 'only one command may be specified') };
  const command = positionals[0];
  if (command !== undefined && !COMMANDS.has(command)) return { code: usageError(stderr, `unknown command '${command}'`) };
  if (values.json && command !== 'doctor') return { code: usageError(stderr, "option '--json' is only valid for doctor") };
  if (values['no-open'] && command !== 'launch') return { code: usageError(stderr, "option '--no-open' is only valid for launch") };
  if (values['no-patch'] && command !== 'refresh') return { code: usageError(stderr, "option '--no-patch' is only valid for refresh") };
  return { command, values };
}

function commandOptions(values: ParsedValues): { steamRoot?: string; bottle?: string } {
  return {
    ...(values['steam-root'] === undefined ? {} : { steamRoot: values['steam-root'] }),
    ...(values.bottle === undefined ? {} : { bottle: values.bottle }),
  };
}

function operationalMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/[\r\n]+/gu, ' ').trim() || 'operation failed';
}

/** Execute one CLI invocation. Returns the process exit code. */
export async function main(argv: readonly string[] = process.argv.slice(2), deps: CliDependencies = {}): Promise<number> {
  const stdout = deps.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = deps.stderr ?? ((text: string) => process.stderr.write(text));
  const parsed = parseCommand(argv, stderr);
  if (parsed.code !== undefined) return parsed.code;
  const values = parsed.values!;
  if (values.help) { write(stdout, USAGE); return 0; }
  if (values.version) { write(stdout, `${VERSION}\n`); return 0; }
  const command = parsed.command;
  if (command === undefined) return usageError(stderr, 'a command is required');
  try {
    const common = commandOptions(values);
    if (command === 'doctor') {
      const doctor = deps.runDoctor ?? runDoctor;
      const result = await doctor(common as DoctorOptions);
      write(stdout, `${formatDoctor(result, values.json === true)}${result.rows.length ? '\n' : ''}`);
      return result.blocking ? 1 : 0;
    }
    if (command === 'refresh') {
      const refresh = deps.refreshCompanion ?? refreshCompanion;
      const result = await refresh({ ...common, noPatch: values['no-patch'] === true } as RefreshOptions);
      write(stdout, `Refreshed Fractured Realms build ${result.buildId}${result.changed ? ' (patched)' : ''}.\n`);
      return 0;
    }
    if (command === 'restore') {
      const restore = deps.restoreCompanion ?? restoreCompanion;
      const result = await restore(common as RestoreOptions);
      write(stdout, `Restored ${result.archivePath} (build ${result.buildId}).\n`);
      return 0;
    }
    const launch = deps.launchCompanion ?? launchCompanion;
    const result = await launch({ ...common, noOpen: values['no-open'] === true } as LaunchOptions);
    write(stdout, `Companion ready at ${result.url}.\n`);
    return 0;
  } catch (error) {
    write(stderr, `${operationalMessage(error)}\n`);
    return 1;
  }
}

export function isEntryPoint(argvPath?: string): boolean {
  if ((import.meta as ImportMeta & { main?: boolean }).main === true) return true;
  if (argvPath === undefined) {
    if (typeof process === 'undefined' || !Array.isArray(process.argv)) return false;
    argvPath = process.argv[1];
  }
  if (typeof argvPath !== 'string' || argvPath.length === 0) return false;
  try {
    return realpathSync(argvPath) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  void main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error: unknown) => {
    process.stderr.write(`${operationalMessage(error)}\n`);
    process.exitCode = 1;
  });
}
