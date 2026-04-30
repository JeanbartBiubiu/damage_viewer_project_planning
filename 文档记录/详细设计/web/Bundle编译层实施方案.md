TASK_KEY: web-bundle-compilation
DOC_TYPE: 详细设计
WORKSTREAM: web
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-04-30

# 前端 Bundle 到 TinyGo V2 输入适配方案

## 1. 当前结论

旧的前端运行链路已经下线：`KatarinaMvpPage`、`SimulationPage`、旧 Worker 宿主、旧桥接层、旧 JS 降级 runtime 和旧 Wasm 产物均已移除。前端不再在 `npm run dev` 或 `npm run build` 时自动构建 Wasm。

当前保留的 Wasm 前端入口是 TinyGo V2 验证页：

1. `web/src/pages/WasmValidationPage.tsx`
2. `web/src/engine/tinygoV2Bridge.ts`
3. `web/src/engine/tinygoV2BundleAdapter.ts`
4. `web/src/engine/wasm/tinygo_engine_v2.wasm`

## 2. 当前目标

本任务不再建设旧 `BenchmarkBundle` 编译层。当前目标收缩为：

1. 从后端读取已发布 `GameDataBundle`。
2. 选择攻击方、目标方、等级和装备。
3. 将发布 Bundle 转成 TinyGo V2 的 M1 初始快照输入。
4. 调用 `engine_init` 与 `engine_snapshot_initial`。
5. 展示 TinyGo V2 输出 frame、actor 输入摘要和初始化快照，供人工逐字段比对。

正式战斗运行页面、完整场景模拟和多变体对比不属于当前前端主链。

## 3. 数据通路

```text
loadPublishedBundleSnapshot
  -> compileTinyGoV2ValidationInput
  -> TinyGoV2Bridge.create({ wasmUrl })
  -> engine_init
  -> engine_snapshot_initial
  -> decodeFramePayload
  -> WasmValidationPage 展示
```

`compileTinyGoV2ValidationInput` 只做 M1 需要的最小转换：

1. 属性定义归一化。
2. 英雄等级属性解析。
3. 装备属性叠加。
4. `EngineBundleV2` 最小 actor/action/formula/settings 输入。
5. `EngineRunInputV2` 初始 actor 选择和快照参数。

## 4. 文件职责

| 文件 | 职责 |
| --- | --- |
| `web/src/pages/WasmValidationPage.tsx` | 页面状态、选择器、frame 解码和结果展示 |
| `web/src/engine/tinygoV2BundleAdapter.ts` | 发布 Bundle 到 TinyGo V2 M1 输入的适配 |
| `web/src/engine/tinygoV2Bridge.ts` | TinyGo V2 ABI frame 编码、内存拷贝、outbox 解码 |
| `web/src/engine/wasm/tinygo_engine_v2.wasm` | 前端验证页消费的 TinyGo V2 产物 |
| `web/src/engine/benchmarkTypes.ts` | 历史类型兼容引用，当前不作为新运行输入真源 |
| `web/src/engine/formulaCompiler.ts` | 历史前端公式辅助，当前不驱动 TinyGo V2 主链 |

## 5. 维护规则

1. 不恢复旧 Worker/Client/Bridge 运行链路。
2. 不恢复旧 `BenchmarkBundle` 作为 TinyGo V2 输入。
3. 前端构建只跑 `tsc -b + vite build`，不隐式触发 Wasm 构建。
4. 如需刷新 TinyGo 产物，先在 `wasm/tinygo_engine_v2` 按 README 构建，再同步 `tinygo_engine_v2.wasm` 到前端产物目录。
5. 扩展到正式浏览器 Worker 宿主时，应以 `TinyGoV2Bridge` 和 TinyGo V2 frame/outbox 协议为基础，而不是恢复已删除的旧运行链。

## 6. 验证

前端侧最低验证：

```powershell
cd web
npm run build
```

若改动 `tinygoV2Bridge.ts`、`tinygoV2BundleAdapter.ts` 或 TinyGo ABI，还需要在浏览器中打开 `#/wasm-validation`，确认当前发布 Bundle 能完成 `engine_init` 和 `engine_snapshot_initial`。
