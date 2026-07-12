TASK_KEY: web-combat-data-切面
DOC_TYPE: 详细设计
WORKSTREAM: web
STATUS: tracked
EXECUTION_MODEL: cursor-grok-4.5
LAST_TRACKED_AT: 2026-07-12

# Web 通用 1v1 combat-data 全面切换详细设计

更新时间：2026-07-12

## 1. 目标与边界

将 Web 从 Bundle / Wasm Catalog / hero-item-skill 专用数据面，切换到后端通用 1v1 `/combat-data/**`。

保留：

- TinyGo V2 ABI
- `genericEngineClient` / `tinygoV2Bridge`
- 现有 `CompileRequest` 形状（`types/genericEngine.ts`）

不改：

- 后端、DB、Wasm worktree、`.wasm` 产物
- 不提供 DELETE / batch / 旧双读兼容层

## 2. 接口映射

### 2.1 保留非 combat-data

| 能力 | 路径 |
| --- | --- |
| 游戏列表 | `GET /api/games` |
| 当前版本 | `GET /api/games/{gameId}/versions/current` |
| 图片 | `GET /api/games/{gameId}/images`；Admin `PUT .../images/{uri}` |
| 发布 | `POST /api/admin/games/{gameId}/versions:publish` |

发布响应字段：`versionCode` / `releaseDate` / `changeRevision` / `publishedAt`。不再等待 Bundle / Catalog / `dataHash`。

### 2.2 Public combat-data

基址：`/api/games/{gameId}/combat-data`

统一 envelope：

```json
{ "gameId": "...", "currentRevision": 1, "data": ... }
```

- `/state`、`/progression-schema`、`/entities/{entityId}` → `data` 为对象
- 其余 GET → `data` 为数组

错误：`{ "error": { "code", "message", "details" } }`

### 2.3 Admin combat-data

基址：`/api/admin/games/{gameId}/combat-data`

- 仅 PUT，单稳定 ID
- 响应 = 写入后行字段 + 顶层 `currentRevision`
- 请求体递归剥离：`changeRevision/currentRevision/publishedRevision/versionId/versionCode/startVersionId/endVersionId/isCurrent/dataHash/updatedAt` 及其 snake_case
- JSONB `expression/extend/payload` 保持 object，不字符串化
- effect-step：公共字段 + 恰好一个 detail key（九选一）

## 3. 前端模块

| 模块 | 职责 |
| --- | --- |
| `types/combatData.ts` | DTO、EffectStep 判别联合、`CombatDataGraph` |
| `services/adminPayload.ts` | 白名单剥离、effect detail 校验 |
| `services/combatDataClient.ts` | Public/Admin HTTP |
| `services/combatDataCache.ts` | IndexedDB `gameId::revision` |
| `services/combatDataLoader.ts` | revision-safe 读取（变化重读一次） |
| `engine/combatDataAssembler.ts` | Web→Wasm 组装 |
| `pages/admin/combat-data/**` | 按资源表拆分的编辑页（`#/combat-data/<id>`） |
| `pages/WasmValidationGenericPage.tsx` | 选 entity → 组装 → compile/run/release |

## 4. 缓存与 revision

1. 读取前取 `/state.currentRevision`。
2. 可选命中 IndexedDB `combat_data_db` / `graphs` / key=`{gameId}::{revision}`。
3. 全量拉取 graph 后复核 `/state`；变化则重读一次。
4. 第二次仍变化 → `CombatDataRevisionChangedError`。
5. 允许多 PUT 期间短暂半成品。
6. 发布后刷新 current version、combat-data state，并 bump Wasm 页 refresh seed。

旧 `bundle_db` / Catalog snapshot 不再作为事实来源（已删除）。

## 5. 组装算法（摘要）

输入：`CombatDataGraph` + `sourceEntityId/targetEntityId` + 可选 stage/overrides。

1. typeCatalog：直接使用稳定 `typeKey`；`domain = typeKey` 在首个 `/` 前的前缀（ABI 要求 `domain === typeKey.split('/',1)[0]`）。缺少 `/` 的 typeKey 在组装期抛前端错误，不伪造 `reserved`/`game` domain。
2. `CompileRequest.schemaVersion` 默认 `generic-p0`（TinyGo V2 generic ABI），可用 overrides 覆盖。
3. 物化 source/target：属性/资源槽（含 stage 绝对值）+ overrides。
4. 克隆 mounted providers，加 `source::` / `target::` 命名空间。
5. formulas 命名空间化；modifiers/listeners/operations 用 typeKey（引用保持稳定 key，不回退数字 ID）。
6. ability phases 按 `phaseOrder` 展平 effect steps → `OperationDefinition[]`。
7. provider tick sequences → tickSpec。
8. listener match types 聚合 any/all/none。
9. 输出现有 `CompileRequest` + `InitialSnapshot`。

## 6. Admin 工作台

- 分表独立路由：`#/combat-data/<resource-id>`（例：`#/combat-data/effect-steps`）
- `#/combat-data` 仅重定向到 registry 首个资源；不提供双层 Tabs 汇总编辑页
- 左侧导航按依赖域分组列出全部资源：基础定义 → 实体 → Provider → Ability → Effect
- 单页复用 `CombatDataPage` + `CombatDataResourcePage` + `resourceRegistry`；effect-step 走 `EffectStepEditor`
- 列表走 Public GET；保存走 Admin PUT
- 对象资源（如 `progression-schema`）：envelope `data` 为对象时适配为单行 records，再进入表单；数组资源保持数组契约不变
- type-relations 仅允许：`entity,attribute,resource,provider,ability,ability_phase,modifier,listener,effect_step,type`
- UI 明确区分后端基础约束 vs Wasm 能力校验
- `formatCombatDataError`：当 games 已通且 state/list 契约入口 404 时，诊断为旧后端/API 地址不匹配；单条 detail 404 不改写

## 7. 已删除旧数据面

生产代码不再请求或依赖：

- bundle / wasm-catalog / wasm-catalog-source / owner-categories
- heroes / items / skills / skill-mounts
- formula-profiles / formula-bindings / coefficient-buckets
- status / control 专用接口
- 对应页面、类型、缓存、Catalog materializer、Bundle/DPS adapter

## 8. 联调入口

1. 总览：`#/overview`
2. combat-data（示例）：`#/combat-data/entities`、`#/combat-data/effect-steps`；裸 `#/combat-data` → 首资源
3. 发布：`#/workspace`
4. Wasm：`#/wasm-validation-generic`
5. 图片：`#/images`

验证命令见同目录测试记录与 `web/README.md`。

## 9. Live smoke 缺陷修复（2026-07-12）

| 现象 | 修复 |
| --- | --- |
| 成长 Schema 对象 envelope 进不了工作台列表 | `adaptEnvelopeDataToRecords`：对象 → 单行；数组契约不变 |
| `schema_version_unsupported` ref=`combat-data-v1` | 默认 `schemaVersion=generic-p0` |
| `matcher_domain_error`（domain 被写成 `game`） | domain 从 typeKey `/` 前缀推导；无 `/` 明确失败 |

## 10. 分表路由与 404 诊断（2026-07-12）

| 现象 | 修复 |
| --- | --- |
| 单页双层 Tabs 塞入全部表不可接受 | 退役汇总工作台；每资源独立 hash |
| 8080 旧后端导致 combat-data 全 404，仅显示 `Resource not found` | `formatCombatDataError` 对 contract-entry 给出旧后端/端口提示，并醒目展示 API 基址 |