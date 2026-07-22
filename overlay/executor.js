/** Direct priority-scheduler executor. It intentionally never reads or writes actionQueue. */

const TERMINAL = new Set(['idle', 'complete', 'error']);
const MISMATCH_GRACE_MS = 1200;
const START_VERIFY_MS = 1500;

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function inventoryValue(state, itemId) {
  return Math.max(0, asNumber(state?.inventory?.[itemId], 0));
}

function thenable(value) {
  return value !== null && value !== undefined && typeof value.then === 'function';
}

function actionLabel(step) {
  return step?.label || step?.actionName || step?.actionId || step?.id || 'action';
}

function stepInterval(step) {
  const explicit = asNumber(step?.interval, 0);
  if (explicit > 0) return explicit;
  const expected = step?.expected;
  const duration = asNumber(expected?.ms, 0);
  const runs = asNumber(expected?.runs, 0);
  return duration > 0 && runs > 0 ? duration / runs : 0;
}

function expectedMs(step) {
  const value = step?.expected?.ms;
  return value === null || value === undefined ? null : Math.max(0, asNumber(value, 0));
}

function cloneState(state) {
  return state && typeof state === 'object' ? state : {};
}

/**
 * Build a scheduler over the exposed game API. Timers, clock, and engine
 * predicates are injectable so this module remains independent of the engine.
 * @param {{startAction: Function, stopAction: Function, getState: Function, subscribe: Function}} api
 * @param {{setTimeout?: Function, clearTimeout?: Function, now?: Function, onUpdate?: Function, liveBlocker: Function, factSatisfied: Function}} options
 */
export function createDirectExecutor(api, options = {}) {
  if (!api || typeof api.startAction !== 'function' || typeof api.stopAction !== 'function'
    || typeof api.getState !== 'function' || typeof api.subscribe !== 'function') {
    throw new TypeError('executor API requires startAction, stopAction, getState, and subscribe');
  }
  if (typeof options.liveBlocker !== 'function' || typeof options.factSatisfied !== 'function') {
    throw new TypeError('executor options require liveBlocker and factSatisfied');
  }

  const schedule = options.setTimeout ?? globalThis.setTimeout;
  const cancel = options.clearTimeout ?? globalThis.clearTimeout;
  const now = options.now ?? (() => Date.now());
  const onUpdate = typeof options.onUpdate === 'function' ? options.onUpdate : () => {};
  const formatBlocker = typeof options.formatBlocker === 'function' ? options.formatBlocker : (value) => String(value ?? '');

  let status = {
    phase: 'idle',
    message: '',
    totalSteps: 0,
    stepStatuses: {},
    runningStepId: null,
    completedSteps: 0,
    remainingMs: 0,
  };
  let steps = [];
  let stepState = new Map();
  let runningIndex = -1;
  let runningSince = 0;
  let runningMs = new Map();
  let runProgress = new Map();
  let progressSnapshot = null;
  let lastProgressAt = 0;
  let verifyTimer;
  let stallTimer;
  let mismatchTimer;
  let timeTimer;
  let progressTicker;
  let unsubscribe;
  let runToken = 0;
  let transitionBusy = false;
  let startPending = false;
  let terminalResolve;
  let terminalPromise = Promise.resolve();

  const currentState = () => {
    try { return cloneState(api.getState() ?? {}); } catch { return {}; }
  };

  const clearTimer = (timer) => {
    if (timer !== undefined) {
      try { cancel(timer); } catch { /* best effort */ }
    }
  };

  const clearStepTimers = () => {
    clearTimer(verifyTimer);
    clearTimer(stallTimer);
    clearTimer(mismatchTimer);
    clearTimer(timeTimer);
    clearTimer(progressTicker);
    verifyTimer = undefined;
    stallTimer = undefined;
    mismatchTimer = undefined;
    timeTimer = undefined;
    progressTicker = undefined;
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

  const matching = (state, step) => state?.activeSkill === step?.skillId
    && state?.activeAction === step?.actionId;

  const statusRecord = () => Object.fromEntries(steps.map((step, index) => [
    step.id,
    stepState.get(index) ?? 'pending',
  ]));

  const remainingMs = () => steps.reduce((total, step, index) => {
    if (stepState.get(index) === 'done') return total;
    const expected = expectedMs(step);
    return expected === null ? total : total + expected;
  }, 0);

  const armProgressTicker = () => {
    clearTimer(progressTicker);
    progressTicker = undefined;
    if (runningIndex < 0) return;
    const token = runToken;
    // Re-publish once a second so the running step's remaining-time countdown and
    // elapsed advance smoothly between the game's state-change callbacks.
    progressTicker = schedule(() => {
      progressTicker = undefined;
      if (token !== runToken || status.phase !== 'running' || runningIndex < 0) return;
      publish('running', status.message, currentState());
    }, 1000);
  };

  const publish = (phase, message, state = currentState()) => {
    const statuses = statusRecord();
    const completed = [...stepState.values()].filter((value) => value === 'done').length;
    const runningStep = runningIndex >= 0 ? steps[runningIndex] : null;
    let stepProgress = null; let stepProgressMax = null; let stepRemainingMs = null;
    if (phase === 'running' && runningStep) {
      stepProgressMax = Math.max(1, asNumber(runningStep?.expected?.runs, 1));
      stepProgress = Math.max(0, Math.min(stepProgressMax, runProgress.get(runningIndex) ?? 0));
      const expected = expectedMs(runningStep);
      if (expected !== null) {
        const elapsed = (runningMs.get(runningIndex) ?? 0) + Math.max(0, asNumber(now(), 0) - runningSince);
        stepRemainingMs = Math.max(0, expected - elapsed);
      }
    }
    status = {
      phase,
      message: message ?? '',
      totalSteps: steps.length,
      stepStatuses: statuses,
      runningStepId: runningIndex >= 0 ? steps[runningIndex]?.id ?? null : null,
      completedSteps: completed,
      remainingMs: Math.round(remainingMs()),
      stepProgress,
      stepProgressMax,
      stepRemainingMs,
    };
    if (phase === 'running' && runningStep) armProgressTicker();
    else { clearTimer(progressTicker); progressTicker = undefined; }
    try { onUpdate({ ...status }); } catch { /* UI observers must not break execution. */ }
    return state;
  };

  const isStopSatisfied = (step, index, state) => {
    const stop = step?.stop;
    if (!stop) return false;
    if (stop.type === 'itemQty') {
      return inventoryValue(state, stop.itemId) >= Math.max(0, asNumber(stop.qty, 0));
    }
    if (stop.type === 'xp') {
      return asNumber(state?.skillXp?.[stop.skillId], 0) >= asNumber(stop.xpAtLeast, 0);
    }
    if (stop.type === 'fact') {
      try { return options.factSatisfied(state, stop.fact) === true; } catch { return false; }
    }
    if (stop.type === 'runs') {
      return stepState.get(index) === 'running'
        && (runProgress.get(index) ?? 0) >= Math.max(0, asNumber(stop.runs, 0));
    }
    if (stop.type === 'time') {
      if (stepState.get(index) !== 'running') return false;
      const elapsed = (runningMs.get(index) ?? 0) + Math.max(0, asNumber(now(), 0) - runningSince);
      return elapsed >= Math.max(0, asNumber(stop.ms, 0));
    }
    return false;
  };

  const outputValue = (state, itemId) => itemId === 'gold'
    ? Math.max(0, asNumber(state?.gold, 0))
    : inventoryValue(state, itemId);

  const snapshotOutputs = (step, state) => {
    const ids = Object.keys(step?.expected?.produces ?? {});
    const result = {};
    for (const id of ids) result[id] = outputValue(state, id);
    return result;
  };

  const snapshotXp = (step, state) => asNumber(state?.skillXp?.[step?.stop?.skillId ?? step?.skillId], 0);

  const updateProgress = (state) => {
    if (runningIndex < 0 || !progressSnapshot) return false;
    const step = steps[runningIndex];
    const previousOutputs = progressSnapshot.outputs;
    const currentOutputs = snapshotOutputs(step, state);
    const progress = runProgress.get(runningIndex) ?? 0;
    const accumulator = progressSnapshot.accumulator;
    let advanced = false;
    for (const id of Object.keys(currentOutputs)) {
      const delta = currentOutputs[id] - (previousOutputs[id] ?? 0);
      if (delta > 0) {
        accumulator.outputs[id] = (accumulator.outputs[id] ?? 0) + delta;
        advanced = true;
      }
    }
    const currentXp = snapshotXp(step, state);
    const xpDelta = currentXp - progressSnapshot.xp;
    if (xpDelta > 0) {
      accumulator.xp += xpDelta;
      advanced = true;
    }
    progressSnapshot = { outputs: currentOutputs, xp: currentXp, accumulator };

    const expectedRuns = Math.max(1, asNumber(step?.expected?.runs, 1));
    const expectedOutputs = step?.expected?.produces ?? {};
    const outputIds = Object.keys(expectedOutputs).filter((id) => asNumber(expectedOutputs[id], 0) > 0
      && asNumber(expectedOutputs[id], 0) / expectedRuns > 0);
    let inferred = 0;
    const xpPerRun = asNumber(step?.xpPerRun ?? step?.xpGain
      ?? step?.expected?.xpPerRun ?? step?.expected?.xpGain, 0);
    if (xpPerRun > 0) {
      inferred = Math.floor(accumulator.xp / xpPerRun);
    } else if (outputIds.length) {
      // The bundle's expected output map contains deterministic outputs first
      // and rare-output EVs after them. A deterministic output is enough to
      // count completed game runs; requiring rare EV quantities would make a
      // run stop wait for luck that the action does not need.
      const id = step?.progressItemId && outputIds.includes(step.progressItemId)
        ? step.progressItemId : outputIds[0];
      inferred = Math.floor(
        (accumulator.outputs[id] ?? 0) / (asNumber(expectedOutputs[id], 0) / expectedRuns),
      );
    }
    if (inferred > progress) runProgress.set(runningIndex, inferred);
    if (advanced) lastProgressAt = asNumber(now(), 0);
    return advanced;
  };

  const actionBlocker = (state, step) => {
    try {
      const blocker = options.liveBlocker(state, step);
      return blocker == null ? null : String(blocker);
    } catch (cause) {
      return cause instanceof Error ? cause.message : 'action unavailable';
    }
  };

  const pickRunnable = (state) => {
    for (let index = 0; index < steps.length; index += 1) {
      if (stepState.get(index) !== 'pending') continue;
      const step = steps[index];
      if (step?.kind !== 'action') continue;
      if (actionBlocker(state, step) === null) return index;
    }
    return -1;
  };

  const blockingMessage = (state) => {
    const blockers = [];
    for (let index = 0; index < steps.length && blockers.length < 4; index += 1) {
      if (stepState.get(index) !== 'pending') continue;
      const step = steps[index];
      if (step?.kind === 'manual') blockers.push(actionLabel(step));
      else {
        const blocker = actionBlocker(state, step);
        if (blocker) blockers.push(`${actionLabel(step)}: ${formatBlocker(blocker)}`);
      }
    }
    return blockers.length ? `Waiting: ${blockers.join('; ')}` : 'Waiting for a step';
  };

  const stopGameAction = () => {
    try {
      const result = api.stopAction();
      if (thenable(result)) result.then(undefined, () => {});
    } catch { /* stopping is best effort during transitions and terminal cleanup */ }
  };

  const addRunningTime = () => {
    if (runningIndex < 0) return;
    const elapsed = Math.max(0, asNumber(now(), 0) - runningSince);
    runningMs.set(runningIndex, (runningMs.get(runningIndex) ?? 0) + elapsed);
    runningSince = asNumber(now(), 0);
  };

  const error = (message, token = runToken) => {
    if (token !== runToken) return;
    clearStepTimers();
    detach();
    if (runningIndex >= 0) addRunningTime();
    transitionBusy = false;
    publish('error', message, currentState());
    resolveTerminal();
  };

  const complete = (token = runToken) => {
    if (token !== runToken) return;
    clearStepTimers();
    detach();
    if (runningIndex >= 0) addRunningTime();
    runningIndex = -1;
    startPending = false;
    transitionBusy = false;
    publish('complete', 'Queue complete', currentState());
    resolveTerminal();
  };

  const armStallTimer = (token) => {
    clearTimer(stallTimer);
    stallTimer = undefined;
    if (runningIndex < 0) return;
    const limit = stepInterval(steps[runningIndex]) * 3;
    if (!Number.isFinite(limit) || limit <= 0) return;
    stallTimer = schedule(() => {
      stallTimer = undefined;
      if (token !== runToken || status.phase !== 'running' || runningIndex < 0) return;
      const state = currentState();
      if (!matching(state, steps[runningIndex])) {
        armStallTimer(token);
        return;
      }
      if (asNumber(now(), 0) - lastProgressAt >= limit) {
        stopGameAction();
        error('stalled — check bag space', token);
      } else {
        armStallTimer(token);
      }
    }, Math.max(1, limit - Math.max(0, asNumber(now(), 0) - lastProgressAt)));
  };

  const armTimeTimer = (token) => {
    clearTimer(timeTimer);
    timeTimer = undefined;
    if (runningIndex < 0) return;
    const stop = steps[runningIndex]?.stop;
    if (stop?.type !== 'time') return;
    const total = Math.max(0, asNumber(stop.ms, 0));
    const remaining = Math.max(0, total - (runningMs.get(runningIndex) ?? 0));
    timeTimer = schedule(() => {
      timeTimer = undefined;
      if (token !== runToken || status.phase !== 'running' || runningIndex < 0) return;
      const latest = currentState();
      process(latest, token);
    }, remaining);
  };

  const armMismatchTimer = (token) => {
    if (mismatchTimer !== undefined) return;
    mismatchTimer = schedule(() => {
      mismatchTimer = undefined;
      if (token !== runToken || status.phase !== 'running' || runningIndex < 0) return;
      const latest = currentState();
      const index = runningIndex;
      if (matching(latest, steps[index])) return;
      // The player changed actions. Return this unfinished step to the ready
      // set; it will restart immediately when startable, or remain waiting.
      transitionBusy = true;
      clearStepTimers();
      addRunningTime();
      stopGameAction();
      stepState.set(index, 'pending');
      runningIndex = -1;
      startPending = false;
      transitionBusy = false;
      process(currentState(), token);
    }, MISMATCH_GRACE_MS);
  };

  const finishRunning = (token) => {
    if (token !== runToken || runningIndex < 0 || transitionBusy) return;
    const index = runningIndex;
    transitionBusy = true;
    clearStepTimers();
    addRunningTime();
    stepState.set(index, 'done');
    stopGameAction();
    runningIndex = -1;
    startPending = false;
    transitionBusy = false;
    process(currentState(), token);
  };

  const preempt = (nextIndex, token) => {
    if (token !== runToken || transitionBusy || runningIndex < 0 || nextIndex === runningIndex) return;
    const previous = runningIndex;
    transitionBusy = true;
    clearStepTimers();
    addRunningTime();
    stopGameAction();
    stepState.set(previous, 'pending');
    runningIndex = -1;
    startPending = false;
    transitionBusy = false;
    process(currentState(), token, nextIndex);
  };

  const beginAction = (index, token) => {
    if (token !== runToken || transitionBusy || index < 0 || index >= steps.length) return;
    const step = steps[index];
    transitionBusy = true;
    runningIndex = index;
    stepState.set(index, 'running');
    startPending = true;
    runningSince = asNumber(now(), 0);
    runningMs.set(index, runningMs.get(index) ?? 0);
    runProgress.set(index, runProgress.get(index) ?? 0);
    progressSnapshot = {
      outputs: snapshotOutputs(step, currentState()),
      xp: snapshotXp(step, currentState()),
      accumulator: { outputs: {}, xp: 0 },
    };
    lastProgressAt = asNumber(now(), 0);
    clearStepTimers();
    publish('running', `Starting ${actionLabel(step)}`, currentState());

    let result;
    try { result = api.startAction(step.skillId, step.actionId); }
    catch (cause) {
      transitionBusy = false;
      error(cause instanceof Error ? cause.message : `Unable to start ${actionLabel(step)}`, token);
      return;
    }
    if (thenable(result)) {
      result.then(undefined, (cause) => error(cause instanceof Error ? cause.message : `Unable to start ${actionLabel(step)}`, token));
    }
    verifyTimer = schedule(() => {
      if (token !== runToken || runningIndex !== index || status.phase !== 'running') return;
      const latest = currentState();
      if (!matching(latest, step)) error(`Unable to start ${actionLabel(step)}`, token);
      else {
        clearTimer(verifyTimer);
        verifyTimer = undefined;
        startPending = false;
        armTimeTimer(token);
        armStallTimer(token);
        process(latest, token);
      }
    }, START_VERIFY_MS);
    const latest = currentState();
    if (matching(latest, step)) {
      clearTimer(verifyTimer);
      verifyTimer = undefined;
      startPending = false;
      transitionBusy = false;
      publish('running', `Running ${actionLabel(step)}`, latest);
      armTimeTimer(token);
      armStallTimer(token);
      process(latest, token);
    } else {
      transitionBusy = false;
      armTimeTimer(token);
      armStallTimer(token);
      process(latest, token);
    }
  };

  function process(state, token, preferredIndex = -1) {
    if (token !== runToken || transitionBusy || TERMINAL.has(status.phase)) return;
    const latest = cloneState(state);
    updateProgress(latest);

    for (let index = 0; index < steps.length; index += 1) {
      if (stepState.get(index) === 'done') continue;
      if (isStopSatisfied(steps[index], index, latest)) {
        if (index === runningIndex) finishRunning(token);
        else stepState.set(index, 'done');
      }
    }
    if (transitionBusy || token !== runToken || TERMINAL.has(status.phase)) return;
    if ([...stepState.values()].every((value) => value === 'done')) {
      complete(token);
      return;
    }

    if (runningIndex >= 0) {
      if (startPending) {
        if (matching(latest, steps[runningIndex])) {
          clearTimer(verifyTimer);
          verifyTimer = undefined;
          startPending = false;
          armTimeTimer(token);
          armStallTimer(token);
        }
        publish('running', `Starting ${actionLabel(steps[runningIndex])}`, latest);
        return;
      }
      const candidate = preferredIndex >= 0 ? preferredIndex : pickRunnable(latest);
      if (candidate >= 0 && candidate < runningIndex) {
        preempt(candidate, token);
        return;
      }
      if (!matching(latest, steps[runningIndex])) armMismatchTimer(token);
      else {
        clearTimer(mismatchTimer);
        mismatchTimer = undefined;
        armTimeTimer(token);
        armStallTimer(token);
      }
      publish('running', `Running ${actionLabel(steps[runningIndex])}`, latest);
      return;
    }

    const candidate = preferredIndex >= 0 && stepState.get(preferredIndex) === 'pending'
      && steps[preferredIndex]?.kind === 'action' && actionBlocker(latest, steps[preferredIndex]) === null
      ? preferredIndex : pickRunnable(latest);
    if (candidate >= 0) {
      beginAction(candidate, token);
      return;
    }
    publish('waiting', blockingMessage(latest), latest);
  }

  const observe = (state) => {
    if (TERMINAL.has(status.phase)) return;
    if (transitionBusy) {
      return;
    }
    process(state ?? currentState(), runToken);
  };

  const subscribe = (token) => {
    try {
      unsubscribe = api.subscribe((state) => {
        if (token !== runToken) return;
        observe(state ?? currentState());
      });
    } catch (cause) {
      error(cause instanceof Error ? cause.message : 'Unable to subscribe to game state', token);
    }
  };

  const run = (requestedSteps) => {
    // A new run supersedes the previous token and resolves its waiters. No
    // stale timer, promise, or subscription may mutate the new run.
    runToken += 1;
    const token = runToken;
    clearStepTimers();
    detach();
    stopGameAction();
    resolveTerminal();
    transitionBusy = false;
    steps = Array.isArray(requestedSteps) ? requestedSteps.map((step, index) => ({
      ...step,
      id: step?.id ?? `step-${index}`,
    })) : [];
    stepState = new Map(steps.map((_, index) => [index, 'pending']));
    runningMs = new Map(steps.map((_, index) => [index, 0]));
    runProgress = new Map(steps.map((_, index) => [index, 0]));
    runningIndex = -1;
    startPending = false;
    terminalPromise = new Promise((resolve) => { terminalResolve = resolve; });
    if (!steps.length) {
      complete(token);
      return terminalPromise;
    }
    publish('waiting', 'Waiting for a runnable step', currentState());
    subscribe(token);
    process(currentState(), token);
    return terminalPromise;
  };

  const stop = () => {
    runToken += 1;
    clearStepTimers();
    detach();
    stopGameAction();
    steps = [];
    stepState = new Map();
    runningMs = new Map();
    runProgress = new Map();
    runningIndex = -1;
    startPending = false;
    transitionBusy = false;
    publish('idle', 'Stopped', {});
    resolveTerminal();
  };

  return {
    run,
    stop,
    getStatus: () => ({ ...status, stepStatuses: { ...status.stepStatuses } }),
  };
}
