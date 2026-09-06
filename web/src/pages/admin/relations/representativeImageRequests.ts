import { getRepresentativeImage } from '../../../services/imageRelationClient';

// 所有表格共享名额，避免大量行同时挂载或切换页面时挤满连接。
const pending = new Set<() => void>();
const concurrency = 6;
let running = 0;

function drain() {
  while (running < concurrency && pending.size) {
    const start = pending.values().next().value!;
    pending.delete(start);
    start();
  }
}

export function readTableRepresentativeImage(
  apiBaseUrl: Parameters<typeof getRepresentativeImage>[0],
  gameId: Parameters<typeof getRepresentativeImage>[1],
  target: Parameters<typeof getRepresentativeImage>[2],
  token: string,
  signal: AbortSignal
): ReturnType<typeof getRepresentativeImage> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const cancelPending = () => {
      pending.delete(start);
      reject(signal.reason);
    };
    const start = () => {
      signal.removeEventListener('abort', cancelPending);
      running += 1;
      // 将同步参数错误也纳入释放名额的流程。
      void Promise.resolve()
        .then(() => getRepresentativeImage(apiBaseUrl, gameId, target, token, signal))
        .then(resolve, reject)
        .finally(() => {
          running -= 1;
          drain();
        });
    };
    signal.addEventListener('abort', cancelPending, { once: true });
    pending.add(start);
    drain();
  });
}
