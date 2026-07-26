TASK_KEY: web-generic-1v1-combat-data-switch
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
- 不提供 DELETE、通用 batch、或旧双读兼容层
- **两处具名聚合写例外**：Entity Level Setup 使用 `PUT .../entities/{entityId}:batch`（见 §6.1）；Direct-damage Ability Setup 使用 `PUT .../providers/{providerId}/abilities/{abilityId}:direct-damage-setup`（见 §6.2）；其余资源仍为单稳定 ID PUT

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

- 仅 PUT；默认单稳定 ID
- **两处具名聚合写例外**：`PUT .../entities/{entityId}:batch`（Entity Level Setup；见 §6.1）与 `PUT .../providers/{providerId}/abilities/{abilityId}:direct-damage-setup`（Direct-damage Ability Setup；见 §6.2）
- 响应 = 写入后行字段 + 顶层 `currentRevision`（`:batch` 返回实体聚合；`:direct-damage-setup` 返回技能图聚合）
- 请求体递归剥离：`changeRevision/currentRevision/publishedRevision/versionId/versionCode/startVersionId/endVersionId/isCurrent/dataHash/updatedAt` 及其 snake_case（两处具名聚合写的 `expectedCurrentRevision` 保留）
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
| `pages/admin/entity-setup/**` | Entity Setup（`#/entity-setup`，单行 PUT 实体主行） |
| `pages/admin/entity-growth/**` | Entity Level Setup（`#/entity-growth`，单实体 `:batch`） |
| `pages/admin/provider-setup/**` | Provider Setup（`#/provider-setup`，单行 PUT 主档） |
| `pages/admin/entity-provider-mount/**` | Entity Provider Mount（`#/entity-provider-mount`，单行 PUT 挂载，body=`{}`） |
| `pages/admin/ability-setup/**` | Ability Setup（`#/ability-setup`，普通 Ability 主档单行 PUT；非效果图） |
| `pages/admin/effect-sequence-setup/**` | Effect Sequence Setup（`#/effect-sequence-setup`，普通 Effect Sequence 主档单行 PUT；非效果图） |
| `pages/admin/effect-step-setup/**` | Effect Step Setup（`#/effect-step-setup`，Sequence 优先的普通 Effect Step 单行 PUT；非聚合写） |
| `pages/admin/direct-damage-ability/**` | Direct-damage Ability Setup（`#/direct-damage-ability`，`:direct-damage-setup`） |
| `pages/WasmValidationGenericPage.tsx` | 选 entity → 组装 → compile/run/release |

## 4. 缓存与 revision

1. 读取前取 `/state.currentRevision`。
2. 可选命中 IndexedDB `combat_data_db` / `graphs` / key=`{gameId}::{revision}`。
3. 全量拉取 graph 后复核 `/state`；变化则重读一次。
4. 第二次仍变化 → `CombatDataRevisionChangedError`。
5. 允许多 PUT 期间短暂半成品。
6. 版本发布页（`#/workspace` / Version Publish）非 Wasm 核验路径：
   - 仅使用既有 `getCurrentVersion` / `getCombatDataState` / `publishVersion`；current 与 combat-data 独立观察（`Promise.allSettled`）。
   - 四类关键语义：前置条件未满足（本地禁用）；`versions/current` 404 → `no-current`；POST 失败 → 发布错误；POST 成功但回读失败 → 保留发布成功 + verification warning。
   - 发布后核验入口：`#/overview`、`#/combat-data`；不依赖 Wasm 验证 CTA / bundle meta。
   - 应用壳层仍可在发布成功后 bump 相关 refresh seed；本页核验不以 Wasm 为准。

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
- `resourceRegistry.references` / `dependentReferences` 仅作客户端跨资源选择辅助（可搜索 Select；自引用跳过；加载失败警告并回退原文本输入）；**不是**服务端参照完整性强制，也不替代现有表单校验 / PUT
- 对象资源（如 `progression-schema`）：envelope `data` 为对象时适配为单行 records，再进入表单；数组资源保持数组契约不变
- Provider/Ability 链十项分表（`providers`、`provider-lifecycles`、`provider-state-fields`、`provider-modifiers`、`provider-listeners`、`listener-match-types`、`abilities`、`ability-state-fields`、`ability-phases`、`ability-phase-effect-sequences`）与第二批十二项非自引用单列跨资源分表（`entity-attribute-stages`、`entity-resources`、`entity-resource-stages`、`entity-provider-mounts`、`provider-formulas`、`provider-tick-sequences`、`ability-parameters`、`ability-costs`、`ability-cooldowns`、`effect-sequences`、`execute-effect-details`、`listener-effect-sequences`）已注册静态 `references`：复用既有 `CombatDataResourcePage` 选择辅助（仅客户端 Select 辅助，非服务端参照检查；无 PUT/path/API 变更）；其中四个同表直接 `providerId` 公式字段（`provider-lifecycles.durationFormulaKey`、`provider-modifiers.valueFormulaKey` / `conditionFormulaKey`、`abilities.castConditionFormulaKey`）按当前表单 `providerId` 过滤 `provider-formulas` 选项，切换/清空 `providerId` 时清空对应公式字段；另有三个 Ability 子表公式字段（`ability-phases.durationFormulaKey`、`ability-costs.amountFormulaKey`、`ability-cooldowns.durationFormulaKey`）经 `abilityId` → abilities.`providerId` 两跳过滤同表 `provider-formulas`，切换/清空 `abilityId` 时清空对应公式字段；其余跨资源引用仍为扁平当前局全量；明确排除：同资源自引用、分表 `#/combat-data/effect-steps` 公式与静态 `references`、服务端 FK 强制；`#/effect-step-setup` 另有所选 Sequence→`providerId` 的客户端公式 Select 辅助（失败回退手输；空作用域空 Select；两处未消费 `durationFormulaKey` 仍手输；无 API/PUT/后端 FK 变更）；`type-relations` 声明与行为不变；加载失败/未知回退原 FieldDef 控件；未切换 provider/ability 时仍保留缺失当前选项
- type-relations：`typeId` 已注册客户端 `types` 选择辅助（可搜索 Select；非服务端参照强制）；`targetId` 随当前 `targetCategory` 按 registry `dependentReferences` 按需加载当前族可搜索选择辅助（未知/加载中/失败回退手输；新建态合法类别切换清空 `targetId`；仅客户端辅助，非服务端 FK 强制，不引入层级或 API 行为）；`targetCategory` 仍仅允许：`entity,attribute,resource,provider,ability,ability_phase,modifier,listener,effect_step,type`；本批未改 type-relations 行为
- UI 明确区分后端基础约束 vs Wasm 能力校验
- `formatCombatDataError`：当 games 已通且 state/list 契约入口 404 时，诊断为旧后端/API 地址不匹配；单条 detail 404 不改写

### Entity Setup（单行实体主行 PUT；非聚合写）

- 路由：`#/entity-setup`（数据管理静态入口；置于 overview 后、entity-growth 前；推荐静态序：`overview` → `entity-setup` → `entity-growth` → `provider-setup` → `entity-provider-mount` → `ability-setup` → `effect-sequence-setup` → `effect-step-setup` → `direct-damage-ability` → `workspace` → `images`；不改 registry 派生的分表导航）
- 模块：`pages/admin/entity-setup/**`；复用既有 `getCombatDataState` / `getEntities` / `putEntity`
- 契约：`PUT /api/admin/games/{gameId}/combat-data/entities/{entityId}`
- 精确 body：仅 `{ displayName, description }`（均已 trim；空白 description 显式传 `''`，后端映射为 null 以清空）；不传 revision / expectedCurrentRevision；无 entity kind/type
- ID：运营手输稳定 entityId（如 `hero_vayne`、`item_2510`），不强制前缀或新分类；已有同 ID 则更新，摘要只读展示既有 displayName / description，空白描述会清空已有值
- 行为：并发读取 state + entities；以显式 `entitiesLoaded` 判定读完（空数组仍算已读完）；game 切换重置 draft 与全部反馈
- 闭环：Entity Setup → `#/entity-growth` 等级成长；或 → `#/provider-setup` → `#/entity-provider-mount` → `#/ability-setup`（普通 Ability）或 `#/direct-damage-ability`（直伤图）
- 高级/诊断：分表 `#/combat-data/entities` 仍保留；推荐任务流改走本静态页

### Provider Setup（单行主档 PUT；非聚合写）

- 路由：`#/provider-setup`（数据管理静态入口；置于 entity-growth 后、entity-provider-mount 前；不改 registry 派生的分表导航）
- 模块：`pages/admin/provider-setup/**`；复用既有 `getCombatDataState` / `getTypes` / `getProviders` / `putProvider`
- 契约：`PUT /api/admin/games/{gameId}/combat-data/providers/{providerId}`
- 精确 body：仅 `{ providerKindTypeId, displayName }`（displayName 已 trim）；不传 revision / expectedCurrentRevision
- 类型解析：从 GET types 只接受 `typeKey.startsWith('provider_kind/')` 且 `typeId` 为有限整数的条目；UI 以 typeKey 选择，保存时映射为 typeId
- ID：运营输入 stem（`^[a-z0-9][a-z0-9_]*$`，拒绝 `provider_` 前缀）→ 生成只读 `provider_<stem>`；已有同 ID 则更新，摘要只读展示既有 displayName / providerKindTypeId，不反向回填/拆分稳定 ID
- 闭环：`#/entity-setup`（若尚无实体）→ Provider Setup → `#/entity-provider-mount` 挂载 → `#/ability-setup` 普通 Ability 或 `#/direct-damage-ability` 直伤图

### Entity Provider Mount（单行挂载 PUT；非聚合写）

- 路由：`#/entity-provider-mount`（数据管理静态入口；置于 provider-setup 后、ability-setup 前；不改 registry 派生的分表导航）
- 模块：`pages/admin/entity-provider-mount/**`；复用既有 `getCombatDataState` / `getEntities` / `getProviders` / `getEntityProviderMounts` / `putEntityProviderMount`
- 契约：`PUT /api/admin/games/{gameId}/combat-data/entities/{entityId}/provider-mounts/{providerId}`
- 精确 body：必须为 `{}`；不传 revision / expectedCurrentRevision；不新增 client API/type
- 行为：并发读取 state / entities / providers / mounts；以显式 `entitiesLoaded` / `providersLoaded` / `mountsLoaded` 标志判定读完（空数组≠已读完）；下拉仅选已有实体与 Provider（稳定 ID / 显示名，zh-CN 排序），不创建 Entity/Provider、不手填 ID
- 重复关系：所选 pair 已在 mounts 中时 UI 标明「已挂载 / 无需保存」并禁用 Save（后端 upsert 对重复 PUT 会推进 revision）
- 保存成功：展示扁平 `entityId` / `providerId` / `currentRevision`，并刷新依赖
- 闭环：挂载后 → `#/ability-setup`（普通 Ability 主档）或 `#/direct-damage-ability`（直伤图快捷入口）
- 高级/诊断：分表 `#/combat-data/entity-provider-mounts` 仍保留；推荐闭环改走本静态页

### Ability Setup（普通 Ability 主档单行 PUT；非聚合写；非效果图构建器）

- 路由：`#/ability-setup`（数据管理静态入口；置于 entity-provider-mount 后、effect-sequence-setup 前；不改 registry 派生的分表导航）
- 模块：`pages/admin/ability-setup/**`；复用既有 `getCombatDataState` / `getTypes` / `getProviders` / `getAbilities` / `putAbility`（不新增 client/type）
- 契约：`PUT /api/admin/games/{gameId}/combat-data/abilities/{abilityId}`
- 精确 body：必填 `{ providerId, abilityKey, abilityKindTypeId, displayName }`；仅当 trim 后非空时附加 `castConditionFormulaKey`；**省略**该可选字段即让后端映射为 null 以清空；不传 `expectedCurrentRevision` / `changeRevision` / graph·phase·effect·cost·cooldown 或其它元数据
- 类型解析：从 GET types 只接受 `typeKey.startsWith('ability_kind/')` 且 `typeId` 为有限整数的条目；UI 持久化 typeKey，保存时解析为 typeId；遗留 Ability 的旧 kind 无法映射到可用选项时拦截更新
- 行为：并发读取 state / types / providers / abilities；显式 `typesLoaded` / `providersLoaded` / `abilitiesLoaded`（空数组仍算已读完）；先选已有 Provider，可选 Ability 下拉仅列该 Provider 下已有行；选中已有 Ability 回填 key/name/kind/可选公式并锁定 Provider，直至清除该选择；**从不重命名**遗留/当前 `abilityId`
- 新建 ID：仅当 Provider 匹配 `^provider_([a-z0-9][a-z0-9_]*)$` 且 abilityKey 匹配 `^[a-z0-9][a-z0-9_]*$` 时推导 `ability_<stem>_<abilityKey>`；不符合 `provider_<stem>` 的 Provider 不可新建，仅可更新已有 Ability（UI 说明原因）
- 碰撞：新建时若推导目标 `abilityId` 已存在则拦截；任意保存若**其它** Ability（≠ 当前目标 ID）占用同一 `providerId` + trim 后 `abilityKey` 则拦截；有意更新且 key 不变不自拦；提示用户改选已有 Ability 或更换 key
- 边界：本页是普通单行主档 PUT，**不是**具名聚合写，也**不是**通用效果图构建器；下一站序列主档见 `#/effect-sequence-setup`；直伤图快捷入口仍为 `#/direct-damage-ability`（`:direct-damage-setup`）；相位/参数/冷却等高级分表仍为诊断入口
- 闭环：`#/provider-setup` → `#/entity-provider-mount` → Ability Setup → `#/effect-sequence-setup`；需要直伤图时改走或续走 `#/direct-damage-ability`

### Effect Sequence Setup（普通 Effect Sequence 主档单行 PUT；非聚合写；非效果图构建器）

- 路由：`#/effect-sequence-setup`（数据管理静态入口；置于 ability-setup 后、effect-step-setup 前；不改 registry 派生的分表导航）
- 模块：`pages/admin/effect-sequence-setup/**`；复用既有 `getCombatDataState` / `getProviders` / `getEffectSequences` / `putEffectSequence`（不新增 client/type）
- 契约：`PUT /api/admin/games/{gameId}/combat-data/effect-sequences/{sequenceId}`
- 精确 body：必填 `{ providerId, sequenceKey, displayName }`（displayName 始终传 trim 后字符串，含空串；后端 optionalText 将空白映射为 null 以清空）；不传 revision / expectedCurrentRevision / step·detail·binding·formula·type 或任何图数据；不新增聚合路由
- ID：新建仅当 Provider 匹配 `^provider_([a-z0-9][a-z0-9_]*)$` 且 sequenceKey 匹配 `^[a-z0-9][a-z0-9_]*$` 时推导 `sequence_<stem>_<sequenceKey>`（仅新记录约定，测试不得假设遗留 ID 可由 key 反推）；非标准 Provider 不可新建，仅可选已有 Sequence 更新；有意更新时**保留**所选行精确 `sequenceId`（不是 ID 重命名），并锁定 Provider
- 碰撞：新建时若推导目标 `sequenceId` 已存在则拦截；任意保存若**其它** Sequence（≠ 当前目标 ID）占用同一 `providerId` + trim 后 `sequenceKey` 则拦截；有意更新且 provider/key 不变不自拦
- 行为：并发读取 state / providers / sequences；显式 `providersLoaded` / `sequencesLoaded`（空数组仍算已读完）；先选已有 Provider，可选 Sequence 下拉仅列该 Provider 下已有行；选中回填并锁定 Provider，清除后回到当前 Provider 下的新建
- 边界：本页只写序列主行，**不是** Effect Step / 绑定 / 直伤图；普通步骤工作台见 `#/effect-step-setup`（非标准 Sequence ID 在该页仅可更新已有 Step），直伤聚合入口见 `#/direct-damage-ability`；分表 `#/combat-data/effect-steps` 仍为高级/诊断
- 闭环：`#/ability-setup` → Effect Sequence Setup → `#/effect-step-setup`；需要直伤图时改走或续走 `#/direct-damage-ability`

### Effect Step Setup（普通 Effect Step 单行 PUT；Sequence 优先；非聚合写；非效果图构建器）

- 路由：`#/effect-step-setup`（数据管理静态入口；置于 effect-sequence-setup 后、direct-damage-ability 前；不改 registry 派生的分表导航）
- 模块：`pages/admin/effect-step-setup/**` + 复用/扩展 `combat-data/EffectStepEditor.tsx`（可选语义 typeKey 选项；可选 `providerFormulaRecords` 公式 Select；原始分表仍走数值 typeId 与手输公式）；复用既有 `getCombatDataState` / `getTypes` / `getEffectSequences` / `getEffectSteps` / `getProviderFormulas` / `putEffectStep`（不新增 client/type/聚合路由）
- 契约：`PUT /api/admin/games/{gameId}/combat-data/effect-steps/{stepId}`
- 精确 body：必填 `sequenceId`、`stepOrder`、`operationTypeId`、`targetSelectorTypeId`；仅当 trim 后非空时附加可选 `conditionFormulaKey`；**恰好一个** detail 家族对象（十一选一）。普通修订写：清除该 step 既有全部 detail 家族后只写入本次提交的那一个。不传 revision / expectedCurrentRevision / sequence 主档 / phase·listener 绑定或其它图元数据
- 身份：稳定主键为 `stepId`；唯一约束 `(game_id, sequence_id, step_order)` 在保存前本地校验；有意更新不得自撞序
- 流程：先选已有 Effect Sequence；再可选该序列下已有 Step。选中已有 Step = 有意更新并锁定 Sequence；清除 Step 选择后回到当前 Sequence 下的新建模式
- 新建 ID（仅标准 Sequence）：`sequenceId` 须匹配 `^sequence_([a-z0-9][a-z0-9_]*)$`。可选 `stepKey`：空白 → 主步骤 `step_<stem>`；非空且匹配 `^[a-z0-9][a-z0-9_]*$` → `step_<stem>_<stepKey>`。两种推导 ID 均做碰撞检查。非标准 Sequence **新建禁用**（UI 明示仅可更新）；有意更新时**原样保留**所选 `stepId`，从不由 key 反推/重命名
- `stepOrder`：默认 = 当前序列已有最大 order + 1，可编辑；任意保存若**其它**同序列 Step（≠ 目标 stepId）占用该 order 则拦截
- 类型：从 GET types 按前缀加载语义选项（`operation/`、`selector/`、`damage/`、`value_policy/`、`provider_action/`、`event/`、`ability_control_action/`、`state_scope/`、`repeat_scope/`）；UI 持久化 typeKey，仅在最终 body 构造时解析为 typeId；必选/默认 typeKey 无法解析时清晰拦截，**从不编造**数值 ID
- 公式辅助（仅客户端；无 API/PUT/后端 FK 变更）：并发加载 `provider-formulas`，失败仅本地警告并回退手输（`providerFormulaRecords=undefined`）；成功后按所选 Effect Sequence 的 `providerId` 过滤选项（空作用域渲染空 Select，从不因未解析 owner 回退全量）。覆盖字段：`conditionFormulaKey`；`amountFormulaKey`（`damageDetail` / `healDetail` / `resourceDetail` / `attributeDetail` / `shieldDetail` / `abilityControlDetail` / `stateDetail`）；`providerDetail.stacksFormulaKey`。`shieldDetail.durationFormulaKey` 与 `providerDetail.durationFormulaKey` 仍为手输。切换 Sequence / draft 替换仍是清除过期公式值的机制
- Detail → 推荐 operation（可覆盖；仅因不匹配推荐值不拦截保存）：
  - `damageDetail` → `operation/damage`
  - `healDetail` → `operation/heal`
  - `resourceDetail` → `operation/resource_change`
  - `attributeDetail` → `operation/attribute_change`
  - `shieldDetail` → `operation/shield`
  - `providerDetail` → 初始 `operation/apply_provider`；所选 `provider_action/apply|refresh|expire` 分别对应 `operation/apply_provider|refresh_provider|expire_provider`
  - `eventDetail` → `operation/emit_event`
  - `abilityControlDetail` → `operation/cooldown_change`
  - `stateDetail` → `operation/state_change`
  - `repeatDetail` → `operation/repeat`
  - `executeDetail` → `operation/execute_threshold`
- 边界：本页是普通单步 PUT，**不是**具名聚合写，也**不是**通用效果图构建器；直伤图快捷入口仍为 `#/direct-damage-ability`；分表 `#/combat-data/effect-steps` 仍为高级/诊断（原始手输，无上述 Sequence→provider 公式 Select 辅助）
- 闭环：`#/effect-sequence-setup` → Effect Step Setup；需要直伤图时改走 `#/direct-damage-ability`

### 6.1 Entity Level Setup（具名聚合写例外之一）

- 路由：`#/entity-growth`（数据管理静态入口；置于 entity-setup 后、provider-setup 前；不改 registry 派生的分表导航）
- 模块：`pages/admin/entity-growth/**` + `putEntityBatch`（`services/combatDataClient.ts`）
- 契约：`PUT /api/admin/games/{gameId}/combat-data/entities/{entityId}:batch`
- 行为：选实体后按人类可读标签编辑单条 attribute/resource 的 LEVEL 1..18 曲线；一次 Save = 一次聚合 PUT（带 `expectedCurrentRevision` 与不变的 display 元数据）；省略的关系不动；不做 delete/replace；本切片不提交 providerMounts
- Schema 门禁：仅当 `progressionKind === LEVEL` 且 `stageMin/Max === 1/18` 可编辑；否则链到 `#/combat-data/progression-schema`
- 入口：选择实体区提供 `#/entity-setup` 链，便于在列表无目标实体时先创建主行
- 分表 `#/combat-data/entities` 等仍保留为高级/诊断入口；不恢复 all-resource 或双 Tabs

### 6.2 Direct-damage Ability Setup（具名聚合写例外之二）

- 路由：`#/direct-damage-ability`（数据管理静态入口；不改 registry 派生的分表导航）
- 模块：`pages/admin/direct-damage-ability/**` + `putDirectDamageAbilitySetup`（`services/combatDataClient.ts`）
- 契约：`PUT /api/admin/games/{gameId}/combat-data/providers/{providerId}/abilities/{abilityId}:direct-damage-setup`
- 请求六顶层字段：`expectedCurrentRevision`、`ability`、`phase`、`effectSequence`、`effectStep`、`phaseEffectSequenceBinding`；全部 `*TypeId` 为从 GET types 按精确 `typeKey` 解析的整数
- 行为：选已有 Provider；由 `provider_<stem>` 推导只读 `ability_/phase_/sequence_/step_` ID；一次 Save = 一次聚合 PUT（主动技能 → impact 相位 → 对敌 damage 步骤 → on_enter 绑定）；不创建 Provider、不挂载实体、不做 DELETE；同父已有节点标为更新；跨父 ID 冲突本地硬拦截；`409.REVISION_CONFLICT` 保留表单并要求显式重提
- 分表 abilities / ability-phases / effect-sequences / effect-steps 等仍保留为高级/诊断入口

> 聚合写仅两处具名例外：Entity Growth 的 `entities/{entityId}:batch` 与 Direct Damage 的 `:direct-damage-setup`。Entity Setup、Provider Setup、Entity Provider Mount、Ability Setup、Effect Sequence Setup 与 Effect Step Setup 均为普通单行 PUT（Ability / Effect Sequence 写主档；Effect Step 写单步且恰好一个 detail），不新增聚合例外。

## 7. 已删除旧数据面

生产代码不再请求或依赖：

- bundle / wasm-catalog / wasm-catalog-source / owner-categories
- heroes / items / skills / skill-mounts
- formula-profiles / formula-bindings / coefficient-buckets
- status / control 专用接口
- 对应页面、类型、缓存、Catalog materializer、Bundle/DPS adapter

## 8. 联调入口

1. 总览：`#/overview`
2. 实体创建：`#/entity-setup`（推荐；分表 `#/combat-data/entities` 仅高级/诊断）
3. 实体等级成长：`#/entity-growth`
4. Provider 创建：`#/provider-setup`
5. 实体 Provider 挂载：`#/entity-provider-mount`（推荐；分表 `#/combat-data/entity-provider-mounts` 仅高级/诊断）
6. Ability 创建：`#/ability-setup`（普通主档；分表 `#/combat-data/abilities` 仅高级/诊断）
7. Effect Sequence 创建：`#/effect-sequence-setup`（普通主档；分表 `#/combat-data/effect-sequences` 仅高级/诊断）
8. Effect Step 创建：`#/effect-step-setup`（普通单步；分表 `#/combat-data/effect-steps` 仅高级/诊断）
9. 直伤技能配置：`#/direct-damage-ability`（具名聚合写快捷入口；与 Ability/Step Setup 为可选替代路径）
10. combat-data（示例）：`#/combat-data/entities`、`#/combat-data/effect-steps`；裸 `#/combat-data` → 首资源
11. 发布：`#/workspace`
12. Wasm：`#/wasm-validation-generic`
13. 图片：`#/images`

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