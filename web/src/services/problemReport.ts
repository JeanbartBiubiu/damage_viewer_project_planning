import { WASM_IDENTITY } from '../engine/wasmIdentity';
import { SIMULATION_ADAPTER_VERSION } from '../engine/simulationAdapter';

type ReportSource = { gameId: string | null; mode: string; material: unknown; description?: string };
const SENSITIVE_FIELD = /authorization|password|cookie|csrf|secret|token|^grant$|totp|recovery.?codes|private.?key|api.?key|bearer/i;

function cleanText(value: string): string {
  return value.replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [已移除]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[已移除授权票据]')
    .replace(/((?:password|token|secret|csrf|cookie|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[已移除]');
}

/** 复制业务复现材料，不交付任何网络请求头、会话或计算授权。 */
export function sanitizeProblemMaterial(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return cleanText(value);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value === undefined) return null;
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) throw new Error('复现材料存在循环引用，无法导出。');
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map(item => sanitizeProblemMaterial(item, seen));
    return Object.fromEntries(Object.entries(value).filter(([key]) => !SENSITIVE_FIELD.test(key) && key !== 'headers')
      .map(([key, nested]) => [key, sanitizeProblemMaterial(nested, seen)]));
  } finally { seen.delete(value); }
}

export function issueRepository(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash
      || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname)) return null;
    return `https://github.com${url.pathname.replace(/\/$/, '')}`;
  } catch { return null; }
}

export function buildProblemReport(source: ReportSource) {
  return {
    format: 'damage-problem-report-v1', exportedAt: new Date().toISOString(),
    release: import.meta.env.VITE_RELEASE_ID?.trim() || '未知',
    gameVersion: import.meta.env.VITE_GAME_DATA_VERSION?.trim() || '未知',
    gameId: source.gameId, mode: source.mode,
    wasm: { ...WASM_IDENTITY }, adapterVersion: SIMULATION_ADAPTER_VERSION,
    description: cleanText(source.description ?? ''), material: sanitizeProblemMaterial(source.material)
  };
}

export function problemIssueUrl(repository: string, report: ReturnType<typeof buildProblemReport>): string {
  const allowed = issueRepository(repository);
  if (!allowed) throw new Error('问题反馈仓库地址不合法。');
  const url = new URL(`${allowed}/issues/new`);
  url.searchParams.set('title', `[计算反馈] ${report.gameId ?? '未选择游戏'}`);
  url.searchParams.set('body', `预期表现：\n\n实际表现：\n\n${report.description.slice(0, 1500)}\n\n发布：${report.release}\n资料版本：${report.gameVersion}\n场景：${report.mode}\n引擎：${report.wasm.sha256}\n适配器：${report.adapterVersion}\n\n请附上下载的复现材料，并补充必要的图片或视频。`);
  return url.toString();
}
