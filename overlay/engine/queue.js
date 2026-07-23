/** Queue composition: plan a list of targets against carried-forward state. */
import { plan } from './expand.js';
import { simulate } from './simulate.js';

/** Plan targets sequentially, carrying optimistic inventory and XP to each target. */
export function resolveQueue(model, snapshot = {}, targets = []) {
  let projected = snapshot;
  const allSteps = []; const targetResults = []; let serial = 0;
  for (const target of Array.isArray(targets) ? targets : []) {
    const result = plan(model, projected, target);
    const prefix = `q${serial++}:`;
    const remap = new Map();
    for (const step of result.steps) remap.set(step.id, `${prefix}${step.id}`);
    const rewritten = result.steps.map((step) => ({ ...step, id: remap.get(step.id), deps: (step.deps ?? []).map((id) => remap.get(id) ?? id) }));
    allSteps.push(...rewritten);
    const projectedSimulation = simulate(model, projected, result.steps, { manualPolicy: 'instant' });
    projected = projectedSimulation.endState;
    targetResults.push({ target, ok: result.ok, steps: rewritten, ...(result.blocked ? { blocked: result.blocked } : {}), notes: result.notes ?? [] });
    if (!result.ok) break;
  }
  const optimistic = simulate(model, snapshot, allSteps, { manualPolicy: 'instant' });
  const scheduler = simulate(model, snapshot, allSteps, { manualPolicy: 'outstanding' });
  const readyAt = {};
  for (const step of allSteps) if (step.kind === 'manual') readyAt[step.id] = scheduler.readyAt?.[step.id] ?? 0;
  return {
    targets: targetResults, steps: allSteps, optimisticMs: optimistic.totalMs, schedulerMs: scheduler.totalMs,
    readyAt, perStep: optimistic.perStep, schedulerPerStep: scheduler.perStep,
    infeasibility: optimistic.infeasibility,
  };
}
