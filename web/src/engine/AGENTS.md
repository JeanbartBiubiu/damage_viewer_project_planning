# Web Engine AGENTS.md

## 适用范围

本文件适用于 `web/src/engine/**`，包括 TinyGo V2 宿主桥接、通用引擎客户端和 Wasm 产物引用。

## 默认读写边界

1. 默认可写：`web/src/engine/**`。
2. `wasm/**` 默认只读参考；只有任务明确要求同步产物或 ABI 时才改 Wasm worktree。
3. 改桥接或通用客户端时同步读 `web/src/types/genericEngine.ts`。不要为已删除的旧战斗数据装配器回写依赖。

## 关键入口

1. `tinygoV2Bridge.ts`：低层 Wasm 加载、frame 编解码、required exports 校验。
2. `genericEngineClient.ts`：通用 ABI compile / run / release 客户端。
3. `wasm/tinygo_engine_v2.wasm`：前端当前消费的 Wasm 产物。

## 最小验证

1. 开发中先验证受影响适配逻辑；功能收尾按 `web/AGENTS.md` 完成检查，包含 `npm run test` 与 `npm run build`（在 `web/` 执行）。
2. 改 bridge 时核对 `requiredExports` 与 TinyGo 导出函数一致。

## 常见陷阱

1. 不要新建第二套 Wasm loader；优先扩展 `TinyGoV2Bridge`。
2. 不要修改 `CompileRequest` ABI 形状来迁就已删除的旧表结构。
3. 旧 Catalog materializer / Bundle adapter / combat-data assembler 已删除，不要恢复。
