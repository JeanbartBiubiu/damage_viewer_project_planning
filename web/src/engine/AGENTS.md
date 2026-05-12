# Web Engine AGENTS.md

## 适用范围

本文件适用于 `web/src/engine/**`，包括 TinyGo V2 前端宿主桥接、Bundle 适配、公式编译和 Wasm 产物引用。

## 默认读写边界

1. 默认可写：`web/src/engine/**`。
2. `wasm/**` 默认只读参考；只有任务明确要求同步产物或 ABI 时才改 Wasm worktree。
3. 改 Bundle 输入形态时同步读 `web/src/types/api.ts`、Wasm 验证页和 `wasm/tinygo_engine_v2/internal/model`。

## 关键入口

1. `tinygoV2Bridge.ts`：Wasm 加载、frame 编解码、required exports 校验。
2. `tinygoV2BundleAdapter.ts`：发布 Bundle 到 TinyGo V2 输入的适配层。
3. `formulaCompiler.ts`：前端公式表达式编译辅助。
4. `benchmarkTypes.ts`：前端 benchmark/验证输入类型。
5. `wasm/tinygo_engine_v2.wasm`：前端当前消费的 Wasm 产物。

## 最小验证

1. 改 engine 代码后至少运行 `cd web; npm run build`。
2. 改 bridge 时核对 `requiredExports` 与 TinyGo 导出函数一致。
3. 改 adapter 时至少 smoke 受影响的 Wasm M1/M2/M3 验证页输入构造。

## 常见陷阱

1. 不要新建第二套 Wasm loader；优先扩展 `TinyGoV2Bridge`。
2. frame magic、schemaVersion、header 长度和 kind 不要随意改。
3. 旧 Rust/Katarina 链路已移除，不要恢复为新能力入口。
4. 英雄成长值来自基础值和 `statsByLevel`，不要只读单个面板字段。
