import type {
  EngineBundle,
  EngineInitMessage,
  EngineMeta,
  EngineRunInput,
  EngineRunOutput,
  EngineToWasmMessage
} from './types';

type RunState = {
  samples: EngineRunOutput['samples'];
  resolve: (output: EngineRunOutput) => void;
  reject: (error: Error) => void;
};

export class MvpEngineClient {
  private worker: Worker;

  private readyPromise: Promise<void> | null = null;

  private readonly runs = new Map<string, RunState>();

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<EngineToWasmMessage>) => {
      this.handleMessage(event.data);
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'Worker crashed');
      this.rejectAll(error);
    };
  }

  init(meta: EngineMeta, bundle: EngineBundle) {
    if (!this.readyPromise) {
      this.readyPromise = new Promise<void>((resolve, reject) => {
        const onReady = (event: MessageEvent<EngineToWasmMessage>) => {
          if (event.data.type === 'ready') {
            this.worker.removeEventListener('message', onReady as EventListener);
            resolve();
          } else if (event.data.type === 'error') {
            this.worker.removeEventListener('message', onReady as EventListener);
            reject(new Error(event.data.error.message));
          }
        };
        this.worker.addEventListener('message', onReady as EventListener);
        const message: EngineInitMessage = {
          type: 'init',
          meta,
          bundle,
          engineConfig: {
            hpAttrKey: 'hp'
          }
        };
        this.worker.postMessage(message);
      });
    }
    return this.readyPromise;
  }

  async run(input: EngineRunInput) {
    if (!this.readyPromise) {
      throw new Error('Engine not initialized');
    }
    await this.readyPromise;
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<EngineRunOutput>((resolve, reject) => {
      this.runs.set(runId, {
        samples: [],
        resolve,
        reject
      });
      this.worker.postMessage({
        type: 'run',
        runId,
        input
      });
    });
  }

  dispose() {
    this.rejectAll(new Error('Engine disposed'));
    this.worker.terminate();
  }

  private handleMessage(message: EngineToWasmMessage) {
    if (message.type === 'tick') {
      const state = this.runs.get(message.runId);
      if (state) {
        state.samples.push(...message.samples);
      }
      return;
    }

    if (message.type === 'done') {
      const state = this.runs.get(message.runId);
      if (!state) {
        return;
      }
      this.runs.delete(message.runId);
      state.resolve({
        result: message.result,
        samples: state.samples
      });
      return;
    }

    if (message.type === 'error') {
      const error = new Error(message.error.message);
      if (message.runId) {
        const state = this.runs.get(message.runId);
        if (state) {
          this.runs.delete(message.runId);
          state.reject(error);
          return;
        }
      }
      this.rejectAll(error);
    }
  }

  private rejectAll(error: Error) {
    for (const [runId, state] of this.runs.entries()) {
      this.runs.delete(runId);
      state.reject(error);
    }
  }
}
