import { closeSync, chmodSync, constants, copyFileSync, fsyncSync, linkSync, openSync, renameSync, statSync, unlinkSync, utimesSync, writeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

const { O_CREAT, O_EXCL, O_RDONLY, O_WRONLY } = constants;
const O_DIRECTORY = constants.O_DIRECTORY ?? 0;

const runtimeProcess = globalThis as typeof globalThis & { process?: { platform?: string } };

function temporaryPath(directory: string, name: string): { fd: number; path: string } {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const path = join(directory, `.${name}.${randomUUID()}.tmp`);
    try {
      return { fd: openSync(path, O_CREAT | O_EXCL | O_WRONLY, 0o600), path };
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') throw error;
    }
  }
  throw new Error(`could not create a unique temporary file beside ${name}`);
}

function removeTemporary(path: string | undefined): void {
  if (path === undefined) return;
  try { unlinkSync(path); } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') { /* cleanup is best effort */ }
  }
}

function flushFd(fd: number): void {
  fsyncSync(fd);
}

/** Flush directory namespace changes; Windows does not support directory fsync. */
export function syncDirectory(path: string): void {
  if (runtimeProcess.process?.platform === 'win32') return;
  const fd = openSync(path, O_RDONLY | O_DIRECTORY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}


function replaceFile(source: string, destination: string): void {
  if (runtimeProcess.process?.platform === 'win32') {
    try { unlinkSync(destination); } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error;
    }
  }
  renameSync(source, destination);
}

/** Write UTF-8 text using a durable same-directory replacement. */
export function atomicWriteText(path: string, text: string, mode = 0o600): void {
  const directory = dirname(path);
  const temporary = temporaryPath(directory, basename(path));
  let fd: number | undefined = temporary.fd;
  try {
    chmodSync(temporary.path, mode);
    const bytes = new TextEncoder().encode(text);
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset, null);
    flushFd(fd);
    closeSync(fd);
    fd = undefined;
    replaceFile(temporary.path, path);
    removeTemporary(temporary.path);
    syncDirectory(directory);
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* preserve original failure */ } }
    removeTemporary(temporary.path);
  }
}

function copyToTemporary(source: string, temporary: string): void {
  copyFileSync(source, temporary);
  const sourceStat = statSync(source);
  const sourceMode = sourceStat.mode & 0o7777;
  // copyFileSync may carry a read-only attribute to the temporary path. Make
  // it writable before opening the handle, then restore the source mode below.
  chmodSync(temporary, sourceMode | 0o200);
  // Windows requires a writable handle for fsyncSync. Open before restoring the
  // source mode so read-only sources still copy successfully on every platform.
  const fd = openSync(temporary, O_WRONLY);
  try {
    chmodSync(temporary, sourceMode);
    try { utimesSync(temporary, sourceStat.atime, sourceStat.mtime); } catch { /* unsupported timestamp precision */ }
    flushFd(fd);
  } finally {
    closeSync(fd);
  }
}

/** Copy a file through a durable same-directory replacement. */
export function atomicCopy(source: string, destination: string): void {
  const temporary = temporaryPath(dirname(destination), basename(destination));
  let fd: number | undefined = temporary.fd;
  try {
    closeSync(fd);
    fd = undefined;
    copyToTemporary(source, temporary.path);
    replaceFile(temporary.path, destination);
    removeTemporary(temporary.path);
    syncDirectory(dirname(destination));
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* preserve original failure */ } }
    removeTemporary(temporary.path);
  }
}

/** Copy a file only when destination is absent, publishing with a hard link. */
export function atomicCopyIfAbsent(source: string, destination: string): boolean {
  const temporary = temporaryPath(dirname(destination), basename(destination));
  let fd: number | undefined = temporary.fd;
  try {
    closeSync(fd);
    fd = undefined;
    copyToTemporary(source, temporary.path);
    try {
      linkSync(temporary.path, destination);
    } catch (error) {
      if ((error as { code?: string }).code === 'EEXIST') return false;
      throw error;
    }
    unlinkSync(temporary.path);
    syncDirectory(dirname(destination));
    return true;
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* preserve original failure */ } }
    removeTemporary(temporary.path);
  }
}
