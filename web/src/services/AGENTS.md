# Web Services AGENTS.md

## 适用范围

本文件适用于 `web/src/services/**`，包括 API client、combat-data 客户端、revision 缓存与图片处理。

## 默认读写边界

1. 默认可写：`web/src/services/**`。
2. 后端实现、DB 和 Wasm 默认只读参考；改 endpoint 语义前先确认 combat-data 契约。
3. 改返回类型或 payload 时同步检查 `web/src/types/api.ts` 与 `web/src/types/combatData.ts`。

## 关键入口

1. `apiClient.ts`：API base URL、Bearer token、games/current/images/publish、错误模型。
2. `combatDataClient.ts`：Public envelope GET 与 Admin PUT（含 payload sanitize）。
3. `combatDataLoader.ts`：revision-safe 全量读取与一次重读。
4. `combatDataCache.ts`：IndexedDB，key = `gameId::revision`。
5. `adminPayload.ts`：禁止字段剥离与 effect-step detail 判别。
6. `imageCache.ts` / `resourceImage.ts`：图片缓存与上传前处理。

## 最小验证

1. 改 services 代码后至少运行 `cd web; npm run test` 与 `npm run build`。
2. 改缓存逻辑时 smoke Wasm 验证页与发布后刷新。
3. 改 API base URL、token 或错误模型时 smoke 总览页和 combat-data 分表页。
4. combat-data state/list 的 404：当 `GET /api/games` 已成功时，使用 `formatCombatDataError(..., 'contract-entry')` 提示旧后端/端口不匹配；单条 detail 404 使用 `'resource-detail'`，不要误判。

## 常见陷阱

1. API base URL 必须走 `resolveApiBaseUrl`。
2. Admin PUT 不得提交 `changeRevision/currentRevision/updatedAt` 等服务端字段。
3. Public `/state` 的 `data` 是对象；仅 `/entities/{id}` 与 `/progression-schema` 是对象，其余列表。
4. 旧 Bundle / Catalog IndexedDB 不再作为事实来源。
