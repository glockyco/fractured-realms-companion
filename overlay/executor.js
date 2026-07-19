/** Direct action executor. It intentionally never reads or writes actionQueue. */

const TERMINAL = new Set(['idle', 'complete', 'error']);

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function inventoryValue(state, itemId) {
  const value = state?.inventory?.[itemId];
  return Math.max(0, asNumber(value, 0));
}

function thenable(value) {
  return value && typeof value.then === 'function';
}

/**
 * Build an executor over the narrow bundle API. Timers and clock are injectable
 * so callers can make progression deterministic without touching game state.
 */
export function createDirectExecutor(api, options = {}) {
  if (!api || typeof api.startAction !== 'function' || typeof api.stopAction !== 'function'
    || typeof api.getState !== 'function' || typeof api.subscribe !== 'function') {
    throw new TypeError('executor API requires startAction, stopAction, getState, and subscribe');
  }
  const schedule = options.setTimeout ?? globalThis.setTimeout;
  const cancel = options.clearTimeout ?? globalThis.clearTimeout;
  const now = options.now ?? (() => Date.now());
  const onUpdate = typeof options.onUpdate === 'function' ? options.onUpdate : () => {};

  let status = { phase: 'idle', currentStep: null, totalSteps: 0, message: '' };
  let steps = [];
  let index = -1;
  let target = 0;
  let stepStart = 0;
  let lastProduced = 0;
  let lastProgressAt = 0;
  let verifyTimer;
  let stallTimer;
  let unsubscribe;
  let runToken = 0;
  let transitionBusy = false;
  let terminalResolve;
  let terminalPromise = Promise.resolve();

  const stepDuration = (step) => Math.max(0, asNumber(step?.interval, 0)) * Math.max(0, asNumber(step?.count, 0));
  const progress = (current = state()) => {
    const step = steps[index];
    if (!step) {
      return {
        completedSteps: status.phase === 'complete' ? steps.length : 0,
        stepProduced: 0,
        stepTarget: 0,
        stepRemainingMs: 0,
        remainingMs: status.phase === 'complete' ? 0 : steps.reduce((sum, candidate) => sum + stepDuration(candidate), 0),
      };
    }
    const inventory = inventoryValue(current, step.produceItemId);
    const stepTarget = Math.max(0, target - stepStart);
    const stepProduced = Math.min(stepTarget, Math.max(0, inventory - stepStart));
    const outputPerRun = Math.max(1, asNumber(step.produceQty, 0) / Math.max(1, asNumber(step.count, 1)));
    const remainingRuns = Math.ceil(Math.max(0, target - inventory) / outputPerRun);
    const futureMs = steps.slice(index + 1).reduce((sum, candidate) => sum + stepDuration(candidate), 0);
    const stepRemainingMs = remainingRuns * Math.max(0, asNumber(step.interval, 0));
    return {
      completedSteps: Math.max(0, index),
      stepProduced,
      stepTarget,
      stepRemainingMs,
      remainingMs: stepRemainingMs + futureMs,
    };
  };

  const update = (phase, message, currentStep = index, current = state()) => {
    status = {
      phase,
      currentStep: currentStep == null ? null : currentStep,
      totalSteps: steps.length,
      message: message ?? '',
      ...progress(current),
    };
    try { onUpdate({ ...status }); } catch { /* UI observers must not break execution. */ }
  };

  const clearTimer = (timer) => {
    if (timer !== undefined) cancel(timer);
  };
  const clearStepTimers = () => {
    clearTimer(verifyTimer);
    clearTimer(stallTimer);
    verifyTimer = undefined;
    stallTimer = undefined;
  };
  const detach = () => {
    if (typeof unsubscribe === 'function') {
      try { unsubscribe(); } catch { /* stale subscriptions are harmless */ }
    } else if (unsubscribe && typeof unsubscribe.unsubscribe === 'function') {
      try { unsubscribe.unsubscribe(); } catch { /* stale subscriptions are harmless */ }
    }
    unsubscribe = undefined;
  };
  const resolveTerminal = () => {
    if (terminalResolve) {
      const resolve = terminalResolve;
      terminalResolve = undefined;
      resolve();
    }
  };

  const state = () => {
    try { return api.getState() ?? {}; } catch { return {}; }
  };
  const matching = (current, step) => current?.activeSkill === step?.skillId
    && current?.activeAction === step?.actionId;

  const error = (message) => {
    const current = state();
    clearStepTimers();
    detach();
    transitionBusy = false;
    update('error', message, index, current);
    resolveTerminal();
  };

  const complete = () => {
    clearStepTimers();
    detach();
    transitionBusy = false;
    status = {
      phase: 'complete',
      currentStep: steps.length ? steps.length - 1 : null,
      totalSteps: steps.length,
      completedSteps: steps.length,
      stepProduced: steps.length ? Math.max(0, target - stepStart) : 0,
      stepTarget: steps.length ? Math.max(0, target - stepStart) : 0,
      stepRemainingMs: 0,
      remainingMs: 0,
      message: 'Queue complete',
    };
    try { onUpdate({ ...status }); } catch { /* UI observers must not break execution. */ }
    resolveTerminal();
  };

  const stopGameAction = () => {
    try {
      const result = api.stopAction();
      if (thenable(result)) result.catch(() => {});
    } catch { /* stopping is best effort during terminal cleanup */ }
  };

  const armStallTimer = (token) => {
    clearTimer(stallTimer);
    stallTimer = undefined;
    const interval = Math.max(0, asNumber(steps[index]?.interval, 0));
    const limit = interval * 3;
    if (!Number.isFinite(limit) || limit <= 0) return;
    stallTimer = schedule(() => {
      if (token !== runToken || status.phase !== 'running') return;
      if (asNumber(now(), 0) - lastProgressAt >= limit) {
        stopGameAction();
        error('stalled — check bag space');
      } else {
        armStallTimer(token);
      }
    }, limit);
  };

  const finishStep = (token) => {
    if (token !== runToken || transitionBusy || status.phase !== 'running') return;
    transitionBusy = true;
    clearStepTimers();
    stopGameAction();
    const next = index + 1;
    const advance = (allowed) => {
      if (token !== runToken) return;
      if (allowed === false) {
        error('Next action is no longer available');
        return;
      }
      transitionBusy = false;
      if (next >= steps.length) complete();
      else beginStep(next, token);
    };
    if (next < steps.length && typeof options.canRun === 'function') {
      let result;
      try { result = options.canRun(steps[next], state()); } catch { result = false; }
      if (thenable(result)) result.then(advance, () => advance(false));
      else advance(result);
    } else {
      advance(true);
    }
  };

  const observe = (current) => {
    if (status.phase !== 'starting' && status.phase !== 'running') return;
    const step = steps[index];
    if (!step) return;
    const inventory = inventoryValue(current, step.produceItemId);
    if (inventory >= target) {
      if (status.phase === 'running') finishStep(runToken);
      return;
    }
    if (status.phase === 'starting') {
      if (matching(current, step)) {
        clearTimer(verifyTimer);
        verifyTimer = undefined;
        lastProduced = inventory;
        lastProgressAt = asNumber(now(), 0);
        update('running', `Running ${step.actionName}`, index, current);
        armStallTimer(runToken);
      }
      return;
    }
    if (inventory > lastProduced) {
      lastProduced = inventory;
      lastProgressAt = asNumber(now(), 0);
      update('running', `Running ${step.actionName}`, index, current);
      armStallTimer(runToken);
    }
    if (!matching(current, step)) {
      clearStepTimers();
      update('paused', 'action changed in game');
    }
  };

  const beginStep = (stepIndex, token) => {
    if (token !== runToken || stepIndex >= steps.length) {
      if (token === runToken) complete();
      return;
    }
    index = stepIndex;
    const step = steps[index];
    const current = state();
    stepStart = inventoryValue(current, step.produceItemId);
    target = stepStart + Math.max(0, asNumber(step.produceQty, 0));
    // A malformed/legacy step can still be executed using count and one output.
    if (target === stepStart && asNumber(step.count, 0) > 0) {
      target += asNumber(step.count, 0);
    }
    lastProduced = stepStart;
    lastProgressAt = asNumber(now(), 0);
    update('starting', `Starting ${step.actionName}`, index, current);

    const invokeStart = () => {
      if (token !== runToken) return;
      let result;
      try { result = api.startAction(step.skillId, step.actionId); }
      catch (cause) {
        error(cause instanceof Error ? cause.message : `Unable to start ${step.actionName}`);
        return;
      }
      if (thenable(result)) result.catch((cause) => error(cause instanceof Error ? cause.message : `Unable to start ${step.actionName}`));
      const timeout = 1500;
      verifyTimer = schedule(() => {
        if (token === runToken && status.phase === 'starting') {
          error(`Unable to start ${step.actionName}`);
        }
      }, timeout);
      observe(state());
    };
    if (typeof options.canRun === 'function') {
      let allowed;
      try { allowed = options.canRun(step, current); } catch { allowed = false; }
      if (thenable(allowed)) allowed.then((value) => value === false ? error('Action is no longer available') : invokeStart(), () => error('Action is no longer available'));
      else if (allowed === false) error('Action is no longer available');
      else invokeStart();
    } else invokeStart();
  };

  const subscribe = () => {
    try {
      unsubscribe = api.subscribe((current) => observe(current ?? state()));
    } catch (cause) {
      error(cause instanceof Error ? cause.message : 'Unable to subscribe to game state');
    }
  };

  const run = (requestedSteps) => {
    stopGameAction();
    clearStepTimers();
    detach();
    runToken += 1;
    const token = runToken;
    steps = Array.isArray(requestedSteps) ? requestedSteps.map((step) => ({ ...step })) : [];
    index = -1;
    terminalPromise = new Promise((resolve) => { terminalResolve = resolve; });
    if (!steps.length) {
      complete();
      return terminalPromise;
    }
    subscribe();
    beginStep(0, token);
    return terminalPromise;
  };

  const stop = () => {
    runToken += 1;
    clearStepTimers();
    detach();
    stopGameAction();
    steps = [];
    index = -1;
    transitionBusy = false;
    update('idle', 'Stopped', null, {});
    resolveTerminal();
  };

  const resume = () => {
    if (status.phase !== 'paused' || index < 0 || index >= steps.length) return;
    const token = runToken;
    const current = state();
    const currentInventory = inventoryValue(current, steps[index].produceItemId);
    const remaining = Math.max(0, target - currentInventory);
    if (remaining <= 0) {
      update('running', `Finishing ${steps[index].actionName}`, index, current);
      finishStep(token);
      return;
    }
    // Preserve target while recording remaining output for diagnostics. The
    // live game starts the same action again; no queue is involved.
    steps[index].produceQty = remaining;
    lastProduced = currentInventory;
    lastProgressAt = asNumber(now(), 0);
    update('starting', `Resuming ${steps[index].actionName}`, index, current);
    let result;
    try { result = api.startAction(steps[index].skillId, steps[index].actionId); }
    catch (cause) { error(cause instanceof Error ? cause.message : `Unable to resume ${steps[index].actionName}`); return; }
    if (thenable(result)) result.catch((cause) => error(cause instanceof Error ? cause.message : `Unable to resume ${steps[index].actionName}`));
    verifyTimer = schedule(() => {
      if (runToken === token && status.phase === 'starting') error(`Unable to start ${steps[index].actionName}`);
    }, 1500);
    observe(state());
  };

  const splice = (fromIndex, replacementSteps) => {
    if (TERMINAL.has(status.phase)) return false;
    if (!Number.isInteger(fromIndex) || fromIndex <= index) return false;
    steps = [
      ...steps.slice(0, Math.min(fromIndex, steps.length)),
      ...(Array.isArray(replacementSteps) ? replacementSteps.map((step) => ({ ...step })) : []),
    ];
    update(status.phase, status.message, index);
    return true;
  };

  return {
    run,
    stop,
    resume,
    splice,
    getStatus: () => ({ ...status }),
  };
}
