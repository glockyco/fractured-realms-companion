import { createHash } from 'node:crypto';
import {
  ELECTRON_HOST_SOURCE,
  EXECUTOR_SOURCE,
  FRACTURED_ADAPTER_SOURCE,
  OVERLAY_SOURCE,
  PLANNER_SOURCE,
} from '../generated/embedded.ts';

const PATCH_FORMAT_REVISION = 'fractured-realms-patch-v2';

export function computePayloadRevision(sources: readonly string[]): string {
  const hash = createHash('sha256');
  hash.update(PATCH_FORMAT_REVISION);
  for (const source of sources) {
    const value = Buffer.from(String(source), 'utf8');
    hash.update(String(value.length));
    hash.update(':');
    hash.update(value);
  }
  return hash.digest('hex');
}

export const COMPANION_REVISION = computePayloadRevision([
  ELECTRON_HOST_SOURCE,
  FRACTURED_ADAPTER_SOURCE,
  OVERLAY_SOURCE,
  PLANNER_SOURCE,
  EXECUTOR_SOURCE,
]);
