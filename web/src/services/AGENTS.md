# Web Services AGENTS.md

## 适用范围

本文件适用于 `web/src/services/**`，包括 API client、当前管理客户端与图片处理。

## 默认读写边界

1. 默认可写：`web/src/services/**`。
2. 后端实现、DB 和 Wasm 默认只读参考；改 endpoint 语义前先确认当前管理接口契约。
3. 改返回类型或 payload 时同步检查 `web/src/types/api.ts` 与对应页面。

## 关键入口

1. `apiClient.ts`：接口基址、Bearer token、游戏列表与错误模型。`GET /api/games` 只解析 `gameId`、`gameName`、`gameImgUrl`。
2. `attributeClient.ts` / `characterClient.ts` / `equipmentClient.ts` / `skillCategoryClient.ts` / `damageTypeClient.ts` / `skillClient.ts` / `statusClient.ts`：当前管理客户端。
3. `imageClient.ts` / `imageCache.ts` / `resourceImage.ts`：图片管理接口、图片缓存与上传前处理。

## 最小验证

1. 开发中先验证受影响客户端；功能收尾按 `web/AGENTS.md` 完成检查，包含 `npm run test` 与 `npm run build`（在 `web/` 执行）。
2. 改 API base URL、token 或错误模型时 smoke 属性管理页和图片页。
3. 当前客户端不得请求 `/combat-data/**`、`versions/current` 或旧发布接口。

## 常见陷阱

1. API base URL 必须走 `resolveApiBaseUrl`。
2. 游戏摘要不要重新引入 `progressionSchema`。
3. 旧 Bundle / Catalog IndexedDB 不再作为事实来源。
