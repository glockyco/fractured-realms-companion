#!/usr/bin/env node

const VERSION = '0.1.0';

function usage() {
  return `Usage: fractured-companion <command> [options]

Commands:
  doctor                 Check the local game installation
  refresh                Extract game data and update the patch
  restore                Restore the original game archive
  launch [--no-open]     Launch Fractured Realms with the companion

Options:
  --version              Print the CLI version
  --help                 Show this help
`;
}

const processLike = globalThis as typeof globalThis & { process?: { argv: string[] } };
const args = processLike.process?.argv.slice(2) ?? [];
if (args.includes('--version')) {
  console.log(VERSION);
} else {
  console.log(usage());
  console.error('The Fractured Realms Companion CLI is under construction.');
}
