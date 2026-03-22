/// <reference lib="webworker" />

import { KatarinaWasmBridge } from './wasmBridge';
import type {
  EngineError,
  EngineMeta,
  EngineRunMessage,
  EngineToWasmMessage,
  WasmToEngineMessage
} from './types';

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

let readyMeta: EngineMeta | null = null;
let bridge: KatarinaWasmBridge | null = null;
let hpAttrKey = 'hp';
let cancelledRunIds = new Set<string>();

ctx.onmessage = (event: MessageEvent<WasmToEngineMessage>) => {
  void handleMessage(event.data);
};

async function handleMessage(message: WasmToEngineMessage) {
  try {
    if (message.type === 'init') {
      readyMeta = message.meta;
      hpAttrKey = message.engineConfig?.hpAttrKey ?? 'hp';
      cancelledRunIds = new Set();
      bridge = await KatarinaWasmBridge.create(message.bundle, { hpAttrKey });
      postMessage({
        type: 'ready',
        meta: message.meta
      });
      return;
    }

    if (message.type === 'cancel') {
      cancelledRunIds.add(message.runId);
      return;
    }

    if (!readyMeta || !bridge) {
      throw invalidInput('Engine not initialized');
    }

    handleRun(message);
  } catch (error) {
    postError(toEngineError(error));
  }
}

function handleRun(message: EngineRunMessage) {
  if (cancelledRunIds.has(message.runId)) {
    postMessage({
      type: 'done',
      runId: message.runId,
      emittedAt: new Date().toISOString(),
      result: {
        stopReason: 'cancelled',
        totalDamageToEnemy: 0,
        totalDamageToSelf: 0,
        executedHits: 0,
        actionDurationMs: 0,
        actionLabel: 'cancelled'
      }
    });
    return;
  }

  const output = bridge!.run(message.input);
  output.samples.forEach((sample, index) => {
    postMessage({
      type: 'tick',
      runId: message.runId,
      seq: index + 1,
      emittedAt: new Date().toISOString(),
      progress: {
        simulatedMs: sample.tMs
      },
      samples: [sample]
    });
  });
  postMessage({
    type: 'done',
    runId: message.runId,
    emittedAt: new Date().toISOString(),
    result: output.result
  });
}

function postMessage(message: EngineToWasmMessage) {
  ctx.postMessage(message);
}

function postError(error: EngineError, runId?: string) {
  ctx.postMessage({
    type: 'error',
    runId,
    emittedAt: new Date().toISOString(),
    error
  });
}

function toEngineError(error: unknown): EngineError {
  if (error instanceof Error) {
    const code = error.name === 'INVALID_INPUT' || error.name === 'SEMANTIC_ERROR' ? error.name : 'RUNTIME_ERROR';
    return {
      code,
      message: error.message
    };
  }
  return {
    code: 'RUNTIME_ERROR',
    message: 'Unknown runtime error'
  };
}

function invalidInput(message: string): Error {
  const error = new Error(message);
  error.name = 'INVALID_INPUT';
  return error;
}
