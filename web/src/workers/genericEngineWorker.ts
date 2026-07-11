import {
  TinyGoV2Bridge,
  type TinyGoV2Frame
} from '../engine/tinygoV2Bridge';

type WorkerRequestMessage =
  | { type: 'init'; wasmUrl: string; id: string }
  | { type: 'compile'; id: string; request: unknown }
  | { type: 'run'; id: string; request: unknown }
  | { type: 'release'; id: string; sessionId: string; expectedRulesHash?: string }
  | { type: 'terminate' };

type WorkerResponseMessage =
  | { type: 'ready'; id: string }
  | { type: 'compileResult'; id: string; frames: SerializedFrame[] }
  | { type: 'runResult'; id: string; frames: SerializedFrame[] }
  | { type: 'releaseResult'; id: string; frames: SerializedFrame[] }
  | { type: 'error'; id?: string; message: string; recreate?: boolean; frames?: SerializedFrame[] };

type SerializedFrame = {
  schemaVersion: number;
  kind: number;
  flags: number;
  payload: number[];
};

let bridge: TinyGoV2Bridge | null = null;

function serializeFrames(frames: TinyGoV2Frame[]): SerializedFrame[] {
  return frames.map((frame) => ({
    schemaVersion: frame.schemaVersion,
    kind: frame.kind,
    flags: frame.flags,
    payload: Array.from(frame.payload)
  }));
}

function postError(id: string | undefined, message: string, recreate = false, frames?: TinyGoV2Frame[]) {
  const response: WorkerResponseMessage = {
    type: 'error',
    id,
    message,
    recreate
  };
  if (frames) {
    response.frames = serializeFrames(frames);
  }
  self.postMessage(response);
}

async function ensureBridge(wasmUrl: string): Promise<TinyGoV2Bridge> {
  if (bridge) {
    return bridge;
  }
  bridge = await TinyGoV2Bridge.create({ wasmUrl, profile: 'generic' });
  return bridge;
}

self.onmessage = (event: MessageEvent<WorkerRequestMessage>) => {
  void handleMessage(event.data);
};

async function handleMessage(message: WorkerRequestMessage) {
  if (message.type === 'terminate') {
    bridge = null;
    self.close();
    return;
  }

  try {
    if (message.type === 'init') {
      await ensureBridge(message.wasmUrl);
      const response: WorkerResponseMessage = { type: 'ready', id: message.id };
      self.postMessage(response);
      return;
    }

    if (!bridge) {
      postError(message.id, 'worker bridge not initialized');
      return;
    }

    if (message.type === 'compile') {
      try {
        const frames = bridge.compile(message.request);
        const response: WorkerResponseMessage = {
          type: 'compileResult',
          id: message.id,
          frames: serializeFrames(frames)
        };
        self.postMessage(response);
      } catch (error) {
        const invocationError = error as { frames?: TinyGoV2Frame[]; message?: string };
        if (invocationError.frames?.length) {
          const response: WorkerResponseMessage = {
            type: 'compileResult',
            id: message.id,
            frames: serializeFrames(invocationError.frames)
          };
          self.postMessage(response);
          return;
        }
        postError(message.id, invocationError.message ?? 'compile failed');
      }
      return;
    }

    if (message.type === 'run') {
      // Run timeout is owned by the main-thread GenericEngineClient (30s).
      // Do not duplicate a Worker-side timer that can drift under sync Wasm.
      try {
        const frames = bridge.run(message.request);
        const response: WorkerResponseMessage = {
          type: 'runResult',
          id: message.id,
          frames: serializeFrames(frames)
        };
        self.postMessage(response);
      } catch (error) {
        const invocationError = error as { frames?: TinyGoV2Frame[]; message?: string };
        if (invocationError.frames?.length) {
          const response: WorkerResponseMessage = {
            type: 'runResult',
            id: message.id,
            frames: serializeFrames(invocationError.frames)
          };
          self.postMessage(response);
          return;
        }
        postError(message.id, invocationError.message ?? 'run failed');
      }
      return;
    }

    if (message.type === 'release') {
      try {
        const frames = bridge.releaseSession(message.sessionId, message.expectedRulesHash);
        const response: WorkerResponseMessage = {
          type: 'releaseResult',
          id: message.id,
          frames: serializeFrames(frames)
        };
        self.postMessage(response);
      } catch (error) {
        const invocationError = error as { frames?: TinyGoV2Frame[]; message?: string };
        if (invocationError.frames?.length) {
          const response: WorkerResponseMessage = {
            type: 'releaseResult',
            id: message.id,
            frames: serializeFrames(invocationError.frames)
          };
          self.postMessage(response);
          return;
        }
        postError(message.id, invocationError.message ?? 'release failed');
      }
    }
  } catch (error) {
    postError('id' in message ? message.id : undefined, error instanceof Error ? error.message : 'worker error', true);
  }
}

export {};
