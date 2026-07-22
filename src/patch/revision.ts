import { createHash } from 'node:crypto';
import {
  ELECTRON_HOST_SOURCE,
  ENGINE_CLOSURE_SOURCE,
  ENGINE_EXPAND_SOURCE,
  ENGINE_FORMULAS_SOURCE,
  ENGINE_MODEL_SOURCE,
  ENGINE_QUEUE_SOURCE,
  ENGINE_SIMULATE_SOURCE,
  EXECUTOR_SOURCE,
  FRACTURED_ADAPTER_SOURCE,
  OVERLAY_SOURCE,
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
  EXECUTOR_SOURCE,
  ENGINE_MODEL_SOURCE,
  ENGINE_FORMULAS_SOURCE,
  ENGINE_CLOSURE_SOURCE,
  ENGINE_EXPAND_SOURCE,
  ENGINE_SIMULATE_SOURCE,
  ENGINE_QUEUE_SOURCE,
]);
