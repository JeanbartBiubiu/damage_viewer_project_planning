TASK_KEY: web-console-non-wasm-iteration
DOC_TYPE: 详细设计
WORKSTREAM: web
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-18

# 前端开发任务清单-非Wasm优先

更新时间：2026-07-18

## 1. 目标

基于当前 `web/` 的实际落地情况，先把前端工作台的非 Wasm 能力收口，再进入下一轮增量开发。

**2026-07-18 当前结论**：冻结范围内 11 个静态页与 30 个 combat-data 页均已完成实现，41 路由的 mock 浏览器验收通过。一次性 PostgreSQL / Redis 环境中的真实 Admin 图片三态、400 / 409、batch 与两次 publish 验收也已通过。目标 live `test0221` 已持久化执行图片兼容迁移，34 个公共 GET 由迁移前 32/34 收口为迁移后 34/34；前后证据见 [非Wasm全页面验收记录-2026-07-18.md](../../测试记录/web/非Wasm全页面验收记录-2026-07-18.md)。planning、backend、web、wasm 的共享治理内容漂移也已归零，因此本任务整体完成。

本清单只覆盖：

1. 应用壳层与导航
2. 系统总览与版本发布
3. 图片缓存与图片管理闭环
4. Admin 资源管理页
5. 非 Wasm 的验证与文档收口

当前明确跳过：

- 旧 `Katarina MVP` 与 `场景模拟` 页面
- 旧 `worker.ts / wasmBridge.ts / wasm 构建链`
- 任何以 Wasm 运行结果为前置条件的页面增强

## 2. 前端现状盘点

### 2.1 已经具备的基础能力

1. 应用壳层已经能统一管理 `apiBaseUrl`、`adminToken`、`gameId` 和 hash 路由。
2. `系统总览` 独立读取 games、current version 与 combat-data state；一侧失败不会抹掉另一侧结果。
3. `版本发布` 已区分 no-current、inspect failure、发布失败、发布成功和 readback warning。
4. `图片缓存` 已具备 IndexedDB 本地缓存、全量/增量同步、清理、独立资产上传、本地预览和资源编辑页双向导航。
5. 11 个静态非 Wasm 页面保留各自任务流，并统一提供持久保存结果与下一步动作。
6. 30 个 canonical combat-data 页默认使用“关系引导”，保留“高级逐表”，并具备搜索、键盘选择、解析标签、上下游关系、复合/多跳作用域、创建子项和保存回执。
7. entities 与 attribute-definitions 已消费 Backend Rev4 `imageUri` 三态契约；实体成长批量保存明确省略该字段。

### 2.2 当前收口状态

当前无功能、环境或治理未闭项。`web-console-non-wasm-iteration` 已从 planning/master 真源映射三份文档并标记为完成，四个 canonical worktree 的治理检查均通过。

补充：disposable 环境真实 Admin PUT / publish 已通过；共享 `lol` 未用于验收写入。390px 移动导航也已收口为默认折叠、按需展开、路由选择后关闭；桌面保持完整侧栏常显，并有独立 E2E 与可视证据。

## 3. 已完成 / 冻结 / 继续推进的任务判断

| 分类 | 任务 | 判断 |
| --- | --- | --- |
| 已完成基座 | `web-core-editor-refactor` | 应用壳层、独立发布页、资源页 CRUD 结构已经落地，可视为已完成基座任务。 |
| 已完成基座 | `web-remaining-table-pages` | 6 个补齐页面已经落地，不再作为当前主线开发任务。 |
| 已完成 | `web-idb-cache-strategy` | 图片资产上传、缓存回写、entities / attribute-definitions 绑定与三态保存均已落地；disposable 写入与 live 数据库迁移后 34/34 公共读取均通过。 |
| 暂缓 | `web-bundle-compilation` | 该任务直接服务 Wasm 链路，当前迭代先不进入主开发顺序。 |
| 暂缓 | `web-scene-interaction` | 该任务依赖场景模拟与 Wasm，当前先不推进。 |

## 4. 建议的开发顺序

以下顺序就是后续迭代默认执行顺序。除非接口现状变化，否则按此顺序逐项推进。

### 任务 1：非 Wasm 工作面收口

**目标**

把当前真正要持续使用的页面收拢成一条稳定主线：`系统总览 -> 版本发布 -> 图片缓存 -> Admin 资源页`。

**包含内容**

1. 统一 README、页面说明和导航文案，明确当前迭代优先级是非 Wasm 工作面。
2. 文档中统一说明旧 `Katarina MVP / 场景模拟` 已删除，避免被误判为当前必验页面。
3. 收口全局空态与阻断态：
   - 未选择 `gameId`
   - 未填写 `adminToken`
   - 后端不可达
4. 让当前开发和回归流程默认只覆盖非 Wasm 页面。

**产出物**

1. 导航优先级与说明文案更新
2. README / 任务文档同步
3. 一套清晰的非 Wasm 页面进入顺序

**完成标准**

1. 新同学进入 `web/` 后，不会先被 Wasm 页面误导。
2. 所有非 Wasm 页面都能明确提示自己依赖的上下文。
3. 前端最小回归列表不再把 Wasm 页面当成当前强制项。

### 任务 2：版本发布页收口与校验增强

**目标**

把现有 `版本发布` 页面从“能操作”推进到“适合作为当前版本管理主入口”。

**包含内容**

1. 强化 `current version` 与 `combat-data /state` 的独立观察展示（不依赖 bundle meta）。
2. 明确区分以下四类关键语义：
   - 前置条件未满足（未选游戏 / 缺 Token / 空 versionCode）→ 本地禁用发布并给出明确原因
   - 尚无 current version（`GET .../versions/current` 返回 `ApiRequestError` status 404）→ `no-current`，不是 inspect failure
   - 发布 POST 失败 → 普通请求失败，展示发布错误
   - 发布 POST 成功但 current / combat-data 回读核验失败 → 仍保留发布成功，另示 verification warning
3. 页面 inspect 另呈现：未选游戏、加载中、已有 current version、非 404 的 inspect failure；一侧失败不得抹掉另一侧成功观察。
4. 发布后核验路径仅走非 Wasm：`#/overview` 与 `#/combat-data`；本页不再提供 Wasm 验证 CTA。

**产出物**

1. 更稳定的发布页交互说明（`versionPublishModel` + `VersionPublishPage` / `usePublishFlow` / `AdminPublishRail`）
2. 更清晰的发布后核验路径（overview + combat-data）
3. 失败态与空态的统一文案（POST 失败 ≠ 核验告警）

**完成标准**

1. 使用者能只通过这一页完成版本发布、当前版本检查。
2. 发布成功后，知道下一步去 `#/overview` / `#/combat-data` 核验，不依赖 Wasm 页面。
3. 发布失败时，错误能定位到接口、Token 或数据状态；核验失败不会把已成功的 POST 误标为发布失败。

### 任务 3：Admin 资源页通用体验补齐

**目标**

在不改接口语义的前提下，把 10 个 Admin 资源页从“已能 CRUD”提升到“可连续录入和维护”。

**包含内容**

1. 收口查询区、表格区、弹窗区的统一交互细节。
2. 增强表单校验与错误提示，减少只靠接口报错回退。
3. 补齐跨资源引用辅助（客户端选择辅助，非服务端参照强制）：
   - `ownerType / ownerId`
   - 类型挂载（`type-relations.typeId` → `types` 选择辅助已落地；`targetId` 随 `targetCategory` 按当前族按需可搜索辅助，未知/加载中/失败回退手输，新建态合法类别切换清空；非层级 / 非服务端 FK / 非 API 行为）
   - Provider/Ability 链十项与第二批十二项非自引用单列跨资源分表静态 `references` 已落地（既有资源 Select 辅助；仅客户端辅助，非服务端参照；无 PUT/path/API 变更）；四个同表直接 `providerId` 公式字段按当前表单 `providerId` 过滤 `provider-formulas`；三个 Ability 子表公式字段经 `abilityId` → abilities.`providerId` 两跳过滤同表 `provider-formulas`；其余仍为扁平当前局全量；明确排除同资源自引用、分表 `#/combat-data/effect-steps` 公式与静态 `references`、服务端 FK 强制；`#/effect-step-setup` 已对所选 Sequence→`providerId` 的运行时公式字段提供客户端 Select 辅助（失败回退手输；空作用域空 Select；两处未消费 `durationFormulaKey` 仍手输；无 API/PUT/后端 FK 变更）；仍为仅客户端辅助，无 API/PUT/后端 FK 变更；`type-relations` 行为不变
   - 英雄 / 技能 / 装备 / 属性之间的引用提示
   - 分表 `CombatDataResourcePage` 仅激活已注册的静态 `references` 与当前表单选中的 `dependentReferences`（可搜索 Select；自引用跳过；失败回退文本输入）
4. 统一保存后的刷新、提示与局部联动策略。
5. 优先处理当前最常用的基础内容页：
   - `heroes`
   - `skills`
   - `items`
   - `attribute-definitions`
   - `types`
   - `type-relations`

**产出物**

1. 一套统一的资源页交互约定
2. 更可用的表单校验与保存反馈
3. 跨资源引用的一致体验（注册引用 = 前端选择辅助，不替代后端约束）

**完成标准**

1. 常见录入动作不需要频繁打开接口文档确认字段格式。
2. 保存后页面能立即给出明确结果，并保持上下文连续。
3. 基础内容页之间的引用关系能在前端获得基础提示（辅助选择，非参照强制）。

### 任务 4：图片资源闭环接入资源编辑页

**目标**

在独立资产上传与本地缓存复用基础上，将 Backend Rev4 `imageUri` 契约接到资源维护链路。本轮代码实现已完成；live 环境仍需执行兼容迁移。

**本阶段已落地**

1. `#/images` 独立图片资产上传回路：稳定 URI → 本地裁切 → Admin `PUT /api/admin/games/{gameId}/images/{uri}` → `upsertRemoteImage` → 刷新缓存快照。
2. 复用既有原语（此前最初未接入可用回路）：公共读取同步、Admin 写入、IndexedDB 缓存与预览组件。
3. entities / attribute-definitions 的绑定、预览、选择、上传、清空、恢复 untouched/preserve 和字段级错误。
4. 实体创建页加载既有绑定；实体成长展示缩略图但批量写入省略 `imageUri`。
5. 图片页与资源编辑页双向导航；缓存未命中时保留稳定占位与补拉能力。

**已完成真实写入验收**

1. 一次性 PostgreSQL / Redis 环境已完成正式迁移幂等重跑、图片上传、实体与属性 preserve / set / clear、400 / 409、batch、两次 publish 和 `_log` 快照核对；环境已全部清理。

**已完成 live 环境验收**

1. 目标 `test0221` 已提交幂等图片引用兼容迁移；四个目标列与四个父表 FK 验证通过，34 个公共 GET 全部通过。

**产出物**

1. 独立图片资产上传 + 写服务器 + 写本地缓存的闭环
2. 资源页图片绑定 / 预览 / 回写能力
3. Web 三态序列化与 Backend 同游戏精确引用约定

**完成标准**

1. 资源编辑页能按后端契约绑定并展示图片，而不只是独立资产页可上传。
2. 图片保存后能立刻在对应资源页和图片页看到结果。
3. 图片缓存页成为资源维护链路的一部分，而不是仅独立资产管理页。

说明：仓库 schema/API、disposable 环境真实联调和目标 live 数据库兼容验证均已通过。

### 任务 5：非 Wasm 最小回归与文档收口

**目标**

为后续每次开发迭代建立固定的非 Wasm 回归清单，避免每次靠记忆回归。

**包含内容**

1. 形成固定的 smoke check 顺序：
   - `系统总览`
   - `版本发布`
   - `图片缓存`
   - 重点 Admin 页面
2. 按当前接口现状整理最小验证数据与验证动作。
3. 补齐 README 和相关设计文档中的“当前主线不含 Wasm”说明。
4. 让每个后续任务都能复用同一份验证清单。

**产出物**

1. 一份固定的非 Wasm 回归清单
2. README / 详细设计同步说明
3. 更稳定的开发完成定义

**完成标准**

1. 后续每次前端改动都能按同一顺序回归。
2. 当前任务是否完成可以不依赖 Wasm 页面判断。
3. 文档与代码主线保持一致。

**2026-07-18 实现检查点**

- 默认非 Wasm 回归路径已落到 [非Wasm最小回归清单.md](../../测试记录/web/非Wasm最小回归清单.md)；Wasm 保留为范围触发的额外门禁（如 `npm run smoke:wasm-generic`）。
- 41 路由实际执行结果见 [非Wasm全页面验收记录-2026-07-18.md](../../测试记录/web/非Wasm全页面验收记录-2026-07-18.md)；mock、live-read 与受控写证据分开记录。

## 5. 当前不进入迭代顺序的范围

以下内容保留现状，不纳入这一轮开发任务清单：

1. 已删除的旧 `KatarinaMvpPage` / `SimulationPage` 页面链路。
2. 新增正式场景模拟工作台。
3. `web/src/engine/**` 中 TinyGo V2 验证页以外的运行链扩展。
4. 未来场景模拟专用目录或页面。
5. `web/src/pages/admin/AdminPublishRail.tsx` 以外任何为 Wasm 运行链路服务的扩展。
6. `wasm/**` 与 TinyGo 构建产物刷新相关能力增强。

## 6. 执行建议

默认按以下顺序排期：

1. 任务 1：非 Wasm 工作面收口
2. 任务 2：版本发布页收口与校验增强
3. 任务 3：Admin 资源页通用体验补齐
4. 任务 4：图片资源闭环接入资源编辑页
5. 任务 5：非 Wasm 最小回归与文档收口

如果中途需要插入新任务，原则上也只允许插入到这 5 项中的某一项子任务下，不再单独开新的 Wasm 相关主线。
