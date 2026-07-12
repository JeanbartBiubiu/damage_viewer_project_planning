# Web Engine AGENTS.md

## 适用范围

本文件适用于 `web/src/engine/**`，包括 TinyGo V2 前端宿主桥接、通用 Catalog 物化、通用引擎客户端、Bundle 适配、公式编译和 Wasm 产物引用。

## 默认读写边界

1. 默认可写：`web/src/engine/**`。
2. `wasm/**` 默认只读参考；只有任务明确要求同步产物或 ABI 时才改 Wasm worktree。
3. 改 Bundle / Catalog 输入形态时同步读 `web/src/types/api.ts`、通用 Wasm 验证页和 `wasm/tinygo_engine_v2/internal/model`。

## 关键入口

1. `tinygoV2Bridge.ts`：通用引擎仍复用的低层 Wasm 加载、frame 编解码、required exports 校验。
2. `genericCatalogMaterializer.ts`：发布 wasm-catalog 在浏览器侧的物化入口。
3. `genericEngineClient.ts`：通用 ABI compile / run / release 客户端。
4. `tinygoV2BundleAdapter.ts`：发布 Bundle 到 TinyGo V2 输入的适配层（Admin 发布预检等仍复用）。
5. `formulaCompiler.ts`：前端公式表达式编译辅助。
6. `benchmarkTypes.ts`：前端 benchmark/验证输入类型。
7. `wasm/tinygo_engine_v2.wasm`：前端当前消费的 Wasm 产物。

## 最小验证

1. 改 engine 代码后至少运行 `cd web; npm run test:wasm-generic` 与 `npm run build`。
2. 改 bridge 时核对 `requiredExports` 与 TinyGo 导出函数一致。
3. 改 adapter / materializer / client 时运行相关自动化测试，或对通用 Wasm 验证页（`#/wasm-validation-generic`）做 Catalog → materialize → compile/run/release smoke；不再要求 smoke 已删除的 M1/M2/M3/M4/V2 DPS 页面。

## 常见陷阱

1. 不要新建第二套 Wasm loader；优先扩展 `TinyGoV2Bridge`。
2. frame magic、schemaVersion、header 长度和 kind 不要随意改。
3. 旧 Rust/Katarina 链路与旧专用验证页已移除，不要恢复为新能力入口。
4. 英雄成长值来自基础值和 `statsByLevel`，不要只读单个面板字段。
