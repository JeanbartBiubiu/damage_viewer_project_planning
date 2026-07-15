TASK_KEY: web-generic-1v1-combat-data-switch
DOC_TYPE: 测试记录
WORKSTREAM: web
STATUS: tracked
EXECUTION_MODEL: cursor-grok-4.5
LAST_TRACKED_AT: 2026-07-12

# Web 通用 1v1 combat-data 切换验证记录

更新时间：2026-07-12

## 1. 范围

验证 Web 侧 combat-data 客户端、payload 清理、revision 重读、组装器、Admin 对象资源适配与生产构建。

本会话修复 live smoke 发现的三处集成缺陷（progression-schema 对象适配、`generic-p0`、typeCatalog domain），并由主会话完成浏览器与当前后端联调复核。

## 2. 命令与结果（本会话实际执行）

工作目录：`C:\project\damage_web_dev\web`

| 命令 | 结果 |
| --- | --- |
| `npm run lint` | **通过**。`lint ok: scanned 39 production source files, no forbidden legacy REST/module refs` |
| `npm run typecheck` | **通过**（`tsc -b --pretty false`，exit 0） |
| `npm run test` | **通过**。6 files / 31 tests passed |
| `npm run build` | **通过**。`tsc -b && vite build` 成功产出 `dist/`（仅有 chunk size warning） |

### 2.1 单元测试覆盖（Vitest）

| 文件 | 覆盖点 |
| --- | --- |
| `src/services/adminPayload.test.ts` | 禁止字段剥离（camel/snake/嵌套）、expression 保持 object、effect detail 0/多个拒绝 |
| `src/services/combatDataClient.test.ts` | Public envelope、错误响应、Admin PUT 清理与响应 `currentRevision` |
| `src/services/combatDataLoader.test.ts` | revision 稳定、变化重读一次、二次仍变报错、缓存命中、invalidateAndReload |
| `src/engine/combatDataAssembler.test.ts` | 双实体组装、namespace、operation 展平、typeKey；默认 `schemaVersion=generic-p0`；`type/50001`→domain `type`、异前缀；无 `/` 的 typeKey 组装失败 |
| `src/pages/admin/combat-data/resourceRegistry.test.ts` | progression-schema **对象** → 单行 records → `recordToForm`；数组列表契约不变 |
| `src/engine/genericEngineClient.test.ts` | 既有 frame 解析回归 |

### 2.2 静态扫描

对 `web/src` 生产源码扫描旧路径/模块（排除 `*.test.ts`）：

`wasm-catalog`、`/bundle`、`owner-categories`、`getBundle`、`getWasmCatalog`、`getHeroes/Items/Skills`、`formula-profiles`、`coefficient-buckets`、`skill-mounts`、`GameDataBundle`、`WasmCatalogV1`、`genericCatalogMaterializer`、`tinygoV2DpsAdapter`、`bundleSnapshot`、`bundleCache`

结果：均 **无命中**（由 `npm run lint` 覆盖）。

## 3. Live smoke 缺陷对应（代码层）

| 缺陷 | 代码修复 | 单元回归 |
| --- | --- | --- |
| 成长 Schema 对象 envelope 显示空列表 | `adaptEnvelopeDataToRecords` | `resourceRegistry.test.ts` |
| `schema_version_unsupported` / `combat-data-v1` | 默认 `generic-p0` | `combatDataAssembler.test.ts` |
| `matcher_domain_error` domain=`game` | 从 typeKey 前缀推导 domain | `combatDataAssembler.test.ts` |

## 4. 主会话 live 联调

联调环境：当前 backend worktree 以 `http://localhost:8081` 启动，Web Vite 为 `http://127.0.0.1:5173`；8080 上的旧进程未作为验收后端。

| 场景 | 结果 |
| --- | --- |
| `GET /api/games` | 200，发现 `lol` |
| combat-data state/list/detail | 200；state revision 从 3 推进到 4；entity list/detail envelope 正确 |
| Admin PUT → Public GET | `PUT entities/codex_web_smoke_20260712` 返回 `currentRevision=4`；随后 Public detail 立即读到同一资源 |
| publish → current/state | 发布 `web-combat-data-smoke-20260712-1219`；响应 `changeRevision=4`，current version 与 `publishedRevision=4` 同步 |
| 总览 / combat-data 工作台 | 页面可加载；progression-schema 对象显示为单行 `LEVEL / 1..18 / Lv`，不再为空 |
| Wasm 验证 | revision 4 数据可完成 source/target 物化；CompileRequest 使用 `generic-p0`；TinyGo compile 成功，sessionId=`generic-session-1` |
| 版本发布页 | 展示 versionCode、releaseDate、changeRevision、publishedAt，并显示 current/published revision=4 |
| 图片缓存页 | 页面正常打开，空缓存状态可用 |

未执行：完整 Playwright spec 文件；本次用应用内浏览器逐页 smoke，并由 HTTP 请求完成 PUT/publish 闭环。

## 5. 风险与后续

1. 空库无 entity 时 Wasm 页为空态可用，但无法完成 compile smoke。
2. Admin 分表页为配置驱动通用表单，复杂 JSONB 仍以 JSON 文本编辑为主。
3. 当前数据库 smoke 资源仅用于联调，前端空列表逻辑不依赖其固定存在。

## 6. 分表路由与 404 诊断（2026-07-12 续）

### 目标

1. 退役双层 Tabs 汇总工作台；每个 registry 资源独立 `#/combat-data/<id>`。
2. contract-entry（state/list）在 games 已通且 404 时诊断旧后端/API 端口不匹配。

### 命令与结果（本会话 Cursor 执行）

工作目录：`C:\project\damage_web_dev\web`

| 命令 | 结果 |
| --- | --- |
| `npm run lint` | **通过**。`lint ok: scanned 40 production source files, no forbidden legacy REST/module refs` |
| `npm run typecheck` | **通过**（`tsc -b --pretty false`，exit 0） |
| `npm run test` | **通过**。7 files / 41 tests passed |
| `npm run build` | **通过**。`tsc -b && vite build` 成功产出 `dist/`（仅有 chunk size warning） |

### 新增单测

| 文件 | 覆盖点 |
| --- | --- |
| `src/pages/admin/combat-data/combatDataRoutes.test.ts` | 每资源唯一路由/导航；`effect-steps` 解析；裸 `#/combat-data` 默认跳转 |
| `src/services/combatDataClient.test.ts` | `formatCombatDataError`：contract-entry 404 → 旧后端提示；resource-detail 404 不改写 |

浏览器独立路由与 404 提示由主会话亲自 smoke，本记录不声称浏览器验收。
