import { closeSync, openSync, readSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ConfigurationError, OperationalError } from '../lib/errors.ts';

const CHUNK_SIZE = 1024 * 1024;

/** Marker identifying archives patched by this companion. */
export const MARKER = 'FRACTURED_REALMS_COMPANION_V1';

/** Prefix identifying archives patched by the predecessor bridge. */
export const FOREIGN_MARKER_PREFIX = 'CROSSOVER_BROWSER_GAMES_FRACTURED_REALMS_';

export interface Fingerprint {
  sha256: string;
  size: number;
  markerFound: boolean;
}

function markerBytes(marker: string | Uint8Array | undefined): Buffer | undefined {
  if (marker === undefined) return undefined;
  const bytes = typeof marker === 'string' ? Buffer.from(marker, 'utf8') : Buffer.from(new Uint8Array(marker));
  if (bytes.length === 0) throw new ConfigurationError('marker must not be empty');
  return bytes;
}

function readError(path: string, error: unknown): OperationalError {
  const detail = error instanceof Error && error.message ? `: ${error.message}` : '';
  return new OperationalError(`could not read file ${path}${detail}`, { cause: error });
}

/**
 * Compute a file's SHA-256 and byte size while optionally searching for a marker.
 *
 * Reading is bounded to one 1 MiB chunk plus at most marker.length - 1 bytes of
 * overlap, so marker matches spanning read boundaries are still detected without
 * loading the archive into memory.
 */
export function streamFingerprint(path: string, marker?: string | Uint8Array): Fingerprint {
  const needle = markerBytes(marker);
  const digest = createHash('sha256');
  const chunk = Buffer.allocUnsafe(CHUNK_SIZE);
  let size = 0;
  let markerFound = false;
  let overlap = Buffer.alloc(0);
  let fd: number;

  try {
    fd = openSync(path, 'r');
  } catch (error) {
    throw readError(path, error);
  }

  try {
    while (true) {
      let bytesRead: number;
      try {
        bytesRead = readSync(fd, chunk, 0, CHUNK_SIZE, null);
      } catch (error) {
        throw readError(path, error);
      }
      if (bytesRead === 0) break;

      const current = chunk.subarray(0, bytesRead);
      digest.update(current);
      size += bytesRead;

      if (needle !== undefined && !markerFound) {
        const searchable = overlap.length === 0 ? current : Buffer.concat([overlap, current]);
        markerFound = searchable.indexOf(needle) !== -1;
        if (needle.length > 1) {
          const overlapLength = needle.length - 1;
          overlap = Buffer.from(
            searchable.length <= overlapLength
              ? searchable
              : searchable.subarray(searchable.length - overlapLength),
          );
        }
      }
    }
  } finally {
    try {
      closeSync(fd);
    } catch (error) {
      throw readError(path, error);
    }
  }

  return { sha256: digest.digest('hex'), size, markerFound };
}
