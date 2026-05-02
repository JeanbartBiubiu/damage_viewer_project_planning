TASK_KEY: planning-platform-roadmap
DOC_TYPE: 概要设计
WORKSTREAM: planning
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-04-30

# 平台推进计划：TinyGo V2 Wasm 验证 + 核心编辑后台

## 1. 当前结论

旧 Rust/Katarina Wasm 工程和前端旧运行链路已经下线。平台当前主线是：

1. Wasm 计算引擎落在 `wasm/tinygo_engine_v2`。
2. 前端 Wasm 入口收缩为 `WasmValidationPage`，先服务 M1 初始快照验证。
3. 后端和后台编辑页继续服务发布 Bundle 的数据闭环。
4. `web` 构建不再自动构建 Wasm；TinyGo 产物由 Wasm 模块构建后同步给前端消费。

## 2. 已落地状态

1. 前端已移除旧 `Katarina MVP` 页面、旧场景模拟页面、旧 Worker 宿主、旧桥接层和旧 Wasm 产物。
2. 前端保留 TinyGo V2 验证页，使用 `tinygoV2Bridge.ts` 和 `tinygoV2BundleAdapter.ts`。
3. `web/package.json` 的 `dev` / `build` 不再依赖 Wasm 构建脚本。
4. TinyGo V2 已提供 `engine_init`、`engine_snapshot_initial`、`engine_begin_run`、`engine_step`、`engine_abort_run` 与 outbox 相关 ABI。
5. 后台资源维护和版本发布仍通过现有 Admin API 与发布快照链路推进。

## 3. 当前主线

### Wasm

1. 继续在 `wasm/tinygo_engine_v2/**` 内实现 TinyGo V2 runtime、compile、ABI 和机制子系统。
2. M1 优先验证初始 actor 属性快照。
3. 后续再按里程碑推进 action 面板值、单技能结算和机制扩展。

### Web

1. 保持 `web/**` 可单独安装、启动和构建。
2. Wasm 页面优先服务人工字段比对，不恢复旧完整模拟页。
3. 版本发布后从 `current + bundle` 刷新验证输入。

### Server / Admin

1. 继续保证资源 CRUD 与发布链路稳定。
2. 发布 Bundle 需要保留 `versionCode`、`publishedAt`、`generatedAt` 等快照元信息。
3. 后续字段扩展以 Wasm 主文档和接口契约为准。

## 4. 关键入口

| 领域 | 入口 |
| --- | --- |
| TinyGo V2 模块 | `wasm/tinygo_engine_v2/README.md` |
| TinyGo V2 ABI | `wasm/tinygo_engine_v2/cmd/engine_wasm/main.go` |
| Wasm 主文档 | `文档记录/需求澄清/wasm/WASM需求澄清.md`、`文档记录/概要设计/wasm/WASM概要设计.md`、`文档记录/详细设计/wasm/WASM详细设计.md` |
| 前端验证页 | `web/src/pages/WasmValidationPage.tsx` |
| 前端 TinyGo bridge | `web/src/engine/tinygoV2Bridge.ts` |
| 前端 Bundle 适配 | `web/src/engine/tinygoV2BundleAdapter.ts` |
| 发布页 | `web/src/pages/VersionPublishPage.tsx` |
| 后端发布入口 | `server/data_manage/src/main/java/xyz/game/datamanage/controller/adminapi/VersionAdminController.java` |

## 5. 验证命令

Wasm 模块：

```powershell
cd wasm/tinygo_engine_v2
go test ./...
node .\scripts\smoke-node.mjs
```

前端：

```powershell
cd web
npm run build
```

如果刷新 TinyGo wasm 产物，还需要运行 `wasm/tinygo_engine_v2/scripts/build-wasm.ps1`，并确认前端 `src/engine/wasm/tinygo_engine_v2.wasm` 已同步。

## 6. 非目标

1. 不恢复旧 Rust/Katarina 工程。
2. 不恢复旧 `Katarina MVP` 页面或旧场景模拟页。
3. 不把前端构建重新绑定到 Wasm 构建。
4. 不把完整 1v1 场景模拟作为 M1/M2 的前置条件。
