# Web Services AGENTS.md

## 适用范围

本文件适用于 `web/src/services/**`，包括 API client、发布 Bundle 快照、IndexedDB 缓存、资源图片处理和类型目录服务。

## 默认读写边界

1. 默认可写：`web/src/services/**`。
2. 后端实现、DB 和 Wasm 默认只读参考；改 endpoint 语义前先确认接口契约和调用方。
3. 改返回类型或 payload 时同步检查 `web/src/types/api.ts`。

## 关键入口

1. `apiClient.ts`：API base URL、Bearer token、请求封装、错误模型和资源 endpoint。
2. `bundleSnapshot.ts`：current version + bundle 的统一读取入口。
3. `bundleCache.ts`、`imageCache.ts`：IndexedDB 缓存。
4. `resourceImage.ts`：资源图片 URI 和上传前处理。
5. `typeCatalog.ts`、`attributeDefinitions.ts`：共享目录/属性定义服务。

## 最小验证

1. 改 services 代码后至少运行 `cd web; npm run build`。
2. 改缓存或图片逻辑时 smoke 图片缓存页、Admin 图片上传或 Wasm 属性图显示。
3. 改 API base URL、token 或错误模型时 smoke 总览页和至少一个 Admin 资源页。

## 常见陷阱

1. API base URL 必须走 `resolveApiBaseUrl`，避免散落本地地址。
2. 图片远端 URI 不带 gameId 前缀；IndexedDB 本地 key 使用 `{gameId}_{uri}`。
3. 上传图片需要保持当前的规格化/裁剪约定，不要只做预览。
4. `bundleSnapshot.ts` 是 current + bundle 的统一入口，不要在页面里复制一套发布快照读取链。
