# Damage Viewer Web

`web/` 是 Damage Viewer 的前端工作台。它负责把后端通用 1v1 `combat-data` 维护、版本发布、图片缓存和 Wasm 模拟入口放到一个可联调、可验证的 Web 壳里。

它在整条链路里的位置是：

1. 读取后端 `current version`、公开 `combat-data/**`、images。
2. 提供 Admin combat-data 分表编辑页（细粒度 PUT）。
3. 按 `gameId + revision` 可选缓存 combat-data graph。
4. 在浏览器侧组装现有 TinyGo V2 `CompileRequest`，完成 compile / run / release。

## 当前主要页面

- `src/App.tsx`：应用外壳、路由、API 基址和本地状态
- `src/pages/OverviewPage.tsx`：系统总览、当前版本与 combat-data revision
- `src/pages/VersionPublishPage.tsx`：版本发布（`versions:publish`，记录 changeRevision）
- `src/pages/admin/combat-data/`：按资源表拆分的 combat-data 编辑页（`#/combat-data/<resource-id>`）
- `src/pages/WasmValidationGenericPage.tsx`：combat-data → 组装 → compile / run / release
- `src/pages/ImagesPage.tsx`：图片缓存与同步

## 关键入口地图

- `src/App.tsx`：应用壳层、页面切换和全局本地状态
- `src/config/navigation.ts`：导航项、公开/Admin 接口说明
- `src/services/apiClient.ts`：API 基址、games/current/images/publish
- `src/services/combatDataClient.ts`：Public/Admin combat-data 客户端
- `src/services/combatDataLoader.ts`：revision-safe 读取与缓存失效
- `src/engine/combatDataAssembler.ts`：combat-data → `CompileRequest`
- `src/engine/genericEngineClient.ts`：通用 ABI compile / run / release
- `src/engine/tinygoV2Bridge.ts`：低层 frame / loader
- `src/engine/wasm/`：Wasm 构建产物目录

## 开发范围

默认主写入范围：

- `web/**`
- 与前端构建、发布、缓存直接相关的 `tools/**`
- `文档记录/**` 中与前端直接相关的文档

默认只读参考：

- `server/**`
- `db/**`
- `wasm/**`
- `接口/**`

## 环境与配置

前置要求：

- Node.js `18+`
- npm

API 基址解析顺序：

1. 页面内手动输入并保存的地址
2. 环境变量 `VITE_API_BASE_URL`
3. 默认值 `http://localhost:8080`

说明：

- 页面内切换后的 API 基址会持久化到浏览器本地存储。
- Admin Token 也会持久化到浏览器本地存储，仅用于当前前端工作台联调。
- 若 `GET /api/games` 正常但 `GET .../combat-data/**` 全部 404，多半是连到了旧后端进程（常见于 8080 仍跑旧服务、新 backend worktree 在其他端口）；页面会给出明确诊断，请切换 API 基址，不要假设默认 8080 一定是新后端。

## 本地开发

```powershell
cd web
npm install
npm run dev
```

| 命令 | 作用 |
| --- | --- |
| `npm install` | 安装依赖 |
| `npm run dev` | 启动 Vite |
| `npm run lint` | 静态扫描：禁止旧 Bundle/Catalog/hero 等 REST 事实依赖 |
| `npm run typecheck` | TypeScript 工程检查 |
| `npm run test` | Vitest 单元测试 |
| `npm run build` | `tsc -b + vite build` |
| `npm run preview` | 预览生产构建 |

## 常用验证

```powershell
cd web
npm run lint
npm run typecheck
npm run test
npm run build
```

涉及页面或联调行为改动时，至少回归：

1. 总览页读取当前版本与 combat-data state
2. 版本发布页提交 publish，展示 changeRevision，刷新 current / state
3. combat-data 分表页（如 `#/combat-data/entities`）列表空态可用，PUT 后刷新 revision；`#/combat-data` 应跳到首个资源
4. 通用 Wasm 验证页：选两个 entity → 组装 → compile / run / release
5. 图片缓存页同步

## 常见问题

### 1. 页面能打开，但接口请求失败

- 确认后端服务是否已启动。
- 检查页面内 API 基址与 `VITE_API_BASE_URL`（工具栏与 combat-data 页会醒目展示当前基址）。
- 若浏览器缓存了旧地址，清理本地存储后重试。

### 2. `/api/games` 正常，但 combat-data 全部 404

- 这通常是旧后端进程 / 错误端口，而不是单条资源缺失。
- 重启当前 backend worktree 服务，或把 API 基址改到新后端端口（例如本机联调常见的 8081）。
- 前端不会自动改端口；需在工具栏手动应用。

### 3. Wasm 验证页没有实体可选

- 确认已通过 combat-data 实体页写入至少一个 entity。
- 确认 `GET /api/games/{gameId}/combat-data/entities` 可返回列表（允许为空）。
- 确认 `src/engine/wasm/tinygo_engine_v2.wasm` 存在。

### 4. 旧 Bundle / Catalog 去哪了

- 后端已删除 Bundle / Wasm Catalog 全量快照；Web 不再请求这些路径。
- 发布只冻结 `changeRevision` 到 `game_versions`，前端以 combat-data 最新主表为准组装。

## 协作说明

- 这不是独立仓，而是 monorepo 下的前端专用 worktree。
- 前端默认消费已经同步到 `src/engine/wasm/` 的 TinyGo V2 产物；本任务不改 Wasm ABI。
- 更细的协作边界见同目录 `AGENTS.md`。
