# Web Services AGENTS.md

本文件适用于 `web/src/services/**`。后端、数据库和 Wasm 默认只读；改变接口字段、错误或鉴权语义前确认当前接口契约，并同步检查 `web/src/types/api.ts` 与消费页面。

## 约束

- `apiClient.ts` 统一处理同源 API 基址、玩家 Cookie、防跨站请求伪造值（CSRF）、游戏列表和错误。共用游戏读取及只读场景快照使用匿名请求。私有写入经 `maintenanceApiRequest.ts` 交给维护入口及已验证批次。维护共享约束见 `contracts/maintenance/README.md`。
- 图片链由 `imageClient.ts`、`imageCache.ts`、`resourceImage.ts` 负责；修正区域使用 `modifierZoneClient.ts`，其余管理客户端按同目录现有命名沿用。
- 游戏摘要只解析当前 `gameId`、`gameName`、可空 `representativeImageKey`，不恢复 `progressionSchema`。
- 不请求 `/combat-data/**`、`versions/current` 或旧发布接口，不恢复旧 Bundle 或 Catalog 缓存。

## 验证

运行受影响客户端测试并按 `web/AGENTS.md` 收尾。API 基址、认证、错误模型或缓存变化需要验证所有受影响页面；图片链变化至少验证图片管理和缓存刷新。
