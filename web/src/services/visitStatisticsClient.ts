import { requestJson, resolveApiBaseUrl } from './apiClient';

export const VISITOR_STORAGE_KEY = 'damage-viewer.visitor-id';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let pageVisitorId: string | undefined;

export type VisitStatisticsDay = {
  date: string;
  pv: number;
  uv: number;
};

export function getVisitorId(): string {
  if (pageVisitorId) return pageVisitorId;
  try {
    const stored = window.localStorage.getItem(VISITOR_STORAGE_KEY);
    if (stored && UUID_PATTERN.test(stored)) return pageVisitorId = stored;
  } catch { /* 浏览器禁止存储时只在本页面保留编号。 */ }
  pageVisitorId = crypto.randomUUID();
  try { window.localStorage.setItem(VISITOR_STORAGE_KEY, pageVisitorId); } catch { /* 不阻塞页面。 */ }
  return pageVisitorId;
}

export async function recordPageVisit(apiBaseUrl = resolveApiBaseUrl()): Promise<void> {
  try {
    await requestJson<void>(apiBaseUrl, '/api/visits', {
      method: 'POST', body: JSON.stringify({ visitorId: getVisitorId() }),
      authentication: 'anonymous', cache: 'no-store'
    });
  } catch { /* 访问统计失败不影响页面，也不自动重试。 */ }
}

export async function listVisitStatistics(apiBaseUrl: string, signal?: AbortSignal): Promise<VisitStatisticsDay[]> {
  const response = await requestJson<VisitStatisticsDay[]>(apiBaseUrl, '/api/admin/visits/last30days', {
    authentication: 'session', cache: 'no-store', signal
  });
  return response.data;
}
