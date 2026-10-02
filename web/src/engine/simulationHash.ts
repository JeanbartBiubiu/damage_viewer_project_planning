/** 业务摘要使用稳定键排序；调用方只传入白名单业务字段。 */
export async function simulationHash(value: unknown): Promise<string> {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, canonical(child)]));
  };
  const raw = JSON.stringify(canonical(value));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
