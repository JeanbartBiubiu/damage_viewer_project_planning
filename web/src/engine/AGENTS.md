# Web Engine AGENTS.md

## 适用范围

本文件适用于 `web/src/engine/**`，包括 TinyGo V2 宿主桥接、combat-data 组装、通用引擎客户端和 Wasm 产物引用。

## 默认读写边界

1. 默认可写：`web/src/engine/**`。
2. `wasm/**` 默认只读参考；只有任务明确要求同步产物或 ABI 时才改 Wasm worktree。
3. 改组装输入时同步读 `web/src/types/combatData.ts`、`web/src/types/genericEngine.ts` 与 Wasm 验证页。

## 关键入口

1. `tinygoV2Bridge.ts`：低层 Wasm 加载、frame 编解码、required exports 校验。
2. `combatDataAssembler.ts`：combat-data graph → `CompileRequest` / initial snapshot。
3. `genericEngineClient.ts`：通用 ABI compile / run / release 客户端。
4. `wasm/tinygo_engine_v2.wasm`：前端当前消费的 Wasm 产物。

## 最小验证

1. 改 engine 代码后至少运行 `cd web; npm run test` 与 `npm run build`。
2. 改 bridge 时核对 `requiredExports` 与 TinyGo 导出函数一致。
3. 改 assembler / client 时对通用 Wasm 验证页做 entity 选择 → 组装 → compile/run/release smoke。

## 常见陷阱

1. 不要新建第二套 Wasm loader；优先扩展 `TinyGoV2Bridge`。
2. 不要修改 `CompileRequest` ABI 形状来迁就后端表结构；在 assembler 内完成映射。
3. source/target 命名空间、typeId→typeKey、effect detail→operation 必须在 Web 侧完成。
4. 旧 Catalog materializer / Bundle adapter 已删除，不要恢复。
