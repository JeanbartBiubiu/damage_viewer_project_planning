# Admin Pages AGENTS.md

## 适用范围

本文件适用于 `web/src/pages/admin/**`，包括后台资源页、资源页 shared hooks、发布辅助组件和 Admin 导航。

## 默认读写边界

1. 默认可写：`web/src/pages/admin/**`。
2. 改服务契约前先读 `web/src/services/apiClient.ts` 和 `web/src/types/api.ts`。
3. 改路由入口、菜单或 hash segment 时同步检查 `web/src/App.tsx` 和 `web/src/config/navigation.ts`。

## 关键入口

1. `adminResourceConfig.ts`：早期资源页配置。
2. `resources/shared/useCrudResourcePage.ts`：通用 CRUD 页面状态和保存流程。
3. `resources/shared/typeRelations.ts`：类型关系写入和读取辅助。
4. `resources/shared/useResourceImageCache.ts`：资源图片缓存和显示辅助。
5. 各资源目录的 `index.tsx`、`modal.tsx`、`table.tsx`、`search.tsx`、`columns.tsx`、`types.ts`。
6. `usePublishFlow.ts`、`AdminPublishRail.tsx`：Admin 侧发布辅助链路。

## 最小验证

1. 改 Admin 代码后至少运行 `cd web; npm run build`。
2. 改页面行为时，对受影响的 Admin 资源页做浏览器 smoke。
3. 涉及图片上传或资源图片显示时，同时 smoke 图片缓存页或对应缓存 hook。

## 常见陷阱

1. 保存资源时尽量保留未知字段，避免编辑器隐藏字段被覆盖丢失。
2. 类型挂载优先使用 `replaceTypeRelationsForTarget` 这类 relation 写入，不要只改主资源 payload。
3. 图片是 sidecar URI 资源，不要把图片 base64 直接塞进 hero、skill、item 或 attribute payload。
4. Admin Token 来自本地状态/本地存储，不要硬编码。
