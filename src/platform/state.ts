import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { OperationalError } from '../lib/errors.ts';

const STATE_DIRECTORY = 'fractured-realms-companion';

export interface StateDirOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

/** Return the platform-specific directory used for persistent companion state. */
export function stateDir(options: StateDirOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA;
    if (!localAppData || localAppData.trim().length === 0) {
      throw new OperationalError('LOCALAPPDATA is required on Windows');
    }
    return resolve(localAppData, STATE_DIRECTORY);
  }

  const home = options.home ?? homedir();
  const xdgStateHome = env.XDG_STATE_HOME;
  if (xdgStateHome && xdgStateHome.trim().length > 0) {
    return resolve(xdgStateHome, STATE_DIRECTORY);
  }
  return resolve(home, '.local', 'state', STATE_DIRECTORY);
}
