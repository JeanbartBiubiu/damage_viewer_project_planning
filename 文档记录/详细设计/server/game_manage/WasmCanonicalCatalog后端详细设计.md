TASK_KEY: server-wasm-db-gap
DOC_TYPE: 详细设计
WORKSTREAM: server
STATUS: active
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-11

# Wasm Canonical Catalog 后端详细设计

本文定义通用 Wasm P0 的后端数据面：数据库录入源、发布物化、版本快照和前端读取接口。系统边界见 [WASM 前后端对齐整改方案](../../../概要设计/wasm/WASM前后端对齐整改方案.md)，Wasm ABI 字段以 [WASM 详细设计](../../wasm/WASM详细设计.md) 为准。

## 1. 范围与边界

本切片新增独立的 canonical catalog 数据面，不改写既有 `GameDataBundleV1`、`/bundle`、`skills` 或 `skillMounts` 的对外语义。

后端负责：

1. 保存一个 game 当前编辑态的 `WasmCatalogSourceV1`。
2. 在发布事务中校验 source，计算 hash，并冻结为指定 `versionCode` 的 catalog snapshot。
3. 向前端提供只读、版本化的 catalog。

后端不负责：

1. 生成用户已选择 source/target、覆盖值和 driver plan 的完整 `CompileRequest`。
2. 调用 `engine_compile`、`engine_run`，或保存 Wasm session。
3. 执行对比模拟、生成 `series[]`。

当前 legacy 数据向 `WasmCatalogSourceV1` 的批量导入、以及将 source 拆成 provider/ability 等细粒度编辑表，是后续切片；本切片先固定前端可依赖的发布契约。

## 2. 数据模型与 DDL

### 2.1 编辑态 source

新增分区表 `public.wasm_catalog_sources`，每个 `game_id` 只有一行当前编辑态：

| 列 | 类型 | 约束 | 含义 |
| --- | --- | --- | --- |
| `game_id` | `varchar(64)` | PK 分区键 | 游戏。 |
| `start_version_id` / `end_version_id` | `bigint` | FK `game_versions` | 沿用原始数据工作区/发布版本治理。 |
| `schema_version` | `varchar(64)` | 非空 | 首期固定 `generic-p0`。 |
| `catalog_json` | `jsonb` | 非空 | 本文 §3 的 source body，排除根 `schemaVersion`、meta 与 hash。 |
| `updated_at` | `timestamp` | 非空 | 编辑态更新时间。 |

对应新增 `public.wasm_catalog_sources_log`，主键为 `(game_id, start_version_id)`，字段与 source 一致，用于发布版本的历史回放。两个表必须纳入 `public.ensure_game_partitions(game_id)`；新游戏创建后不应因缺少 Wasm source 分区而写入失败。

目标 DDL（仅为实现契约，本文不执行）：

```sql
CREATE TABLE public.wasm_catalog_sources (
    game_id varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    schema_version varchar(64) NOT NULL,
    catalog_json jsonb NOT NULL,
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_wasm_catalog_sources PRIMARY KEY (game_id),
    CONSTRAINT fk_wasm_catalog_sources_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_wasm_catalog_sources_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT ck_wasm_catalog_sources_json_object CHECK (jsonb_typeof(catalog_json) = 'object'),
    CONSTRAINT ck_wasm_catalog_sources_version_range CHECK (start_version_id <= end_version_id)
) PARTITION BY LIST (game_id);

CREATE TABLE public.wasm_catalog_sources_log (
    game_id varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    schema_version varchar(64) NOT NULL,
    catalog_json jsonb NOT NULL,
    CONSTRAINT pk_wasm_catalog_sources_log PRIMARY KEY (game_id, start_version_id),
    CONSTRAINT fk_wasm_catalog_sources_log_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_wasm_catalog_sources_log_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT ck_wasm_catalog_sources_log_json_object CHECK (jsonb_typeof(catalog_json) = 'object'),
    CONSTRAINT ck_wasm_catalog_sources_log_version_range CHECK (start_version_id <= end_version_id)
) PARTITION BY LIST (game_id);

CREATE INDEX idx_wasm_catalog_sources_log_version
    ON public.wasm_catalog_sources_log (game_id, start_version_id, end_version_id);
```

`triggers.sql` 必须在现有 `ensure_game_partitions` 中为上述两个 parent 增加幂等分区；编辑态写入与其他原始表一样使用 `__workspace__` 版本，只有发生变更的 source 才在发布时写入 log 和推进版本范围。`schema_version` 是数据库唯一真源：Admin `PUT` 从根 `schemaVersion` 拆出后写入该列，`catalog_json` 不重复保存它；Admin `GET` 和 Public snapshot 再由服务端合成对应的 root/meta 字段。

### 2.2 已发布 snapshot

新增非分区表 `public.published_wasm_catalog_snapshots`，与现有 `published_bundle_snapshots` 的冻结语义一致：

| 列 | 类型 | 约束 | 含义 |
| --- | --- | --- | --- |
| `game_id` | `varchar(64)` | 与 `version_code` 联合 PK | 游戏。 |
| `version_id` | `bigint` | `(game_id, version_id)` 唯一 FK | 内部发布版本。 |
| `version_code` | `varchar(64)` | 非空 | Public 路径参数。 |
| `schema_version` | `varchar(64)` | 非空 | snapshot 所属 Wasm schema。 |
| `schema_hash` | `varchar(80)` | 非空 | schema 契约指纹。 |
| `rules_hash` | `varchar(80)` | 非空 | catalog 规则与定义指纹。 |
| `catalog_json` | `jsonb` | 非空 | 包含 `meta` 的完整 `WasmCatalogV1`。 |
| `created_at` | `timestamp` | 非空 | 物化时间。 |

DDL：新库由 `db/game_manage/schema.sql`（含 Wasm Canonical Catalog 基线段）初始化，再执行 `triggers.sql` 扩展 source 与 source log 分区创建；已部署库使用幂等的 `db/game_manage/migrations/compatibility/wasm_catalog_compatibility_migration.sql`，并在该迁移后重跑 `triggers.sql`。不得修改既有 bundle snapshot 的 JSON 结构来承载 catalog。

目标 DDL：

```sql
CREATE TABLE public.published_wasm_catalog_snapshots (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    version_code varchar(64) NOT NULL,
    schema_version varchar(64) NOT NULL,
    schema_hash varchar(80) NOT NULL,
    rules_hash varchar(80) NOT NULL,
    catalog_json jsonb NOT NULL,
    created_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_published_wasm_catalog_snapshots PRIMARY KEY (game_id, version_code),
    CONSTRAINT uq_published_wasm_catalog_snapshots_version UNIQUE (game_id, version_id),
    CONSTRAINT fk_published_wasm_catalog_snapshots_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT ck_published_wasm_catalog_snapshots_json_object CHECK (jsonb_typeof(catalog_json) = 'object')
);
```

## 3. Source 与 Public DTO

### 3.1 `WasmCatalogSourceV1`

Admin 写入和读取的 source 使用下列根对象。`schemaHash`、`rulesHash`、`meta`、版本字段由服务端生成，客户端提交它们必须返回 `400.INVALID_BODY`。

```ts
type WasmCatalogSourceV1 = {
  schemaVersion: "generic-p0"
  typeCatalog: {
    types: Array<{ key: `${string}/${string}`; domain: string; group?: string }>
    relations: Array<{ parent: string; child: string }>
  }
  combatantTemplates: Array<{
    templateKey: string                 // 例如 champion:ahri
    displayName?: string
    types?: string[]
    tags?: string[]
    attributes: Record<string, { base: number; current: number; max: number; resolved: number }>
    resources: Record<string, { current: number; max: number }>
    providers: Array<{ providerRef: string; definitionRef: string; initialState?: object; initialAbilityState?: object }>
  }>
  sharedProviders: ProviderDefinition[] // 与 Wasm CompileRequest 同名、同字段
  rules: { operations: OperationDefinition[]; modifiers: ModifierDefinition[]; listeners: ListenerDefinition[]; triggerRules: unknown[] }
  formulas: NamedFormula[]
  settings: { maxEvents?: number; maxCommandsPerEvent?: number; maxQueueEvents?: number; maxChainDepth?: number }
}
```

`combatantTemplates` 不是 Wasm 的 `CombatantDefinition`：前端选择两个 template 后，将其复制并改写为 P0 固定的 `source`、`target` combatant，再合并用户 override 和 `DriverPlan`。因此 source 中没有 `sessionId`、snapshot、sampling、stop policy 或 driver plan。Admin `PUT` 时每个属性槽都必须包含有限的 `resolved`；legacy adapter 或前端 numeric override 改写 `base/current/max` 后，必须同步设置 `resolved=current`，不得把缺省值交给 Go JSON 的零值反序列化。

P0 固定要求 `rules.operations`、`rules.modifiers`、`rules.listeners`、`rules.triggerRules` 都是空数组。全局 rules 没有 provider owner slot，因而不得包含模板态 `abilityRef`、`providerDefinitionRef` 或 owner-relative formula；首期所有机制都必须落在 provider definition 的 ability/modifier/listener 内。全局 rules 的 materialize 语义另开后续设计，不能由前端自行推断。

#### 模板态 provider / ability 引用与双槽位 clone

catalog 的 `sharedProviders` 是 definition template 集合，不能原样直接作为 Wasm 的 `CompileRequest.sharedProviders`：同一个 catalog provider 可能同时挂载在 source 与 target，但 Wasm `abilityRef` 必须绑定 `source` 或 `target`。前端必须总是执行下列唯一的 P0 materialize 算法：

1. 选定两个 template，分别命名为 `source`、`target`；`CompileRequest.combatants` 必须恰好为这两个 key，各出现一次。
2. 对 catalog 的每个 `sharedProviders[].providerKey` 各 clone 两份 definition，runtime `providerKey` 固定为 `source::<catalogProviderKey>` 和 `target::<catalogProviderKey>`。对每个 `formulas[].key` 同样 clone 为 `source::<catalogFormulaKey>`、`target::<catalogFormulaKey>`。每个 formula clone 必须递归深拷贝其 `NamedFormula.expression` 整棵树（包括 `args`、`expr`、`min`、`max`）：所有 `$owner/$opponent` path 依 §3.1.6 改写，所有 `op=ref` 的裸 catalog key 改为当前 slot 的 `<slot>::<catalogFormulaKey>`。这些 clone 都进入 Wasm 的 `sharedProviders[]` / `formulas[]`；catalog definition 不得直接透传。
3. 被 materialize 为某 slot 的 template mount，`definitionRef` 改为 `<slot>::<catalogProviderKey>`，`providerRef` 保持 template 定义的 canonical `kind:stableId`。因此相同英雄可同时作为 source、target，仍因 combatant slot 隔离而不存在能力引用歧义。
4. catalog 内 `ListenerDefinition.abilityRef`、`OperationDefinition.abilityRef` 和同类 ability 字段只允许 `$owner.provider[<providerRef>].ability[<abilityKey>]` 或 `$opponent.provider[<providerRef>].ability[<abilityKey>]`。clone `source` 时分别重写为 `source.provider[...]`、`target.provider[...]`；clone `target` 时反向重写。裸 `abilityKey`、`self`/`opponent` runtime 前缀、直接 `source`/`target` 前缀在 source 中均不合法。
5. provider 内 `OperationDefinition.target` 只允许 `self` 或 `opponent`，不得写死 `source` / `target`；这两个 selector 进入 Wasm 后保持不变，由 ability execution context 解析。`apply_provider.providerDefinitionRef` 在 source 中只写 catalog provider key，并按下表改写为目标 slot clone；`refresh_provider` / `expire_provider` 的 `providerRef` 仍由 operation target selector 限定 owner，不加 slot 前缀。

| 当前 provider clone | operation.target | runtime providerDefinitionRef |
| --- | --- | --- |
| `source` | `self` | `source::<catalogProviderKey>` |
| `source` | `opponent` | `target::<catalogProviderKey>` |
| `target` | `self` | `target::<catalogProviderKey>` |
| `target` | `opponent` | `source::<catalogProviderKey>` |

6. provider 内 attribute `ModifierDefinition.target` 只允许 `$owner.attr.<attrKey>` 或 `$opponent.attr.<attrKey>`；clone `source` 时重写为 `source.attr.<attrKey>` / `target.attr.<attrKey>`，clone `target` 时反向重写。这正是当前 Wasm attribute resolver 支持的 canonical path。catalog `GenericFormulaExpr.path` 的唯一允许词表为 `$owner.attr.*`、`$opponent.attr.*`、`$owner.resource.*`、`$opponent.resource.*`、`ability.param.*`；前四类按 clone slot 重写为 Wasm 的 `source.*` / `target.*`，`ability.param.*` 原样保留。任何直接 `source.*` / `target.*`、未列出的 `$owner/$opponent` 路径或 history/state/event 路径都在 Admin 写入时拒绝。
7. provider clone 内所有 `GenericFormulaExpr` 树同样递归遍历 `args`、`expr`、`min`、`max`；其中 `op=ref` 的 `ref` 只写裸 catalog formula key，materializer 必须改写为当前 owner slot 的 `<slot>::<catalogFormulaKey>`。跨 owner formula ref 不属于 P0。`NamedFormula.key` 也按此规则双槽 clone；resource path 固定为 `$owner.resource.<resourceKey>` 或 `$opponent.resource.<resourceKey>`，不允许 `.current` / `.max` 等尾缀。

发布校验必须验证每个模板态 ability/provider/formula definition 引用都在 catalog 中存在；不尝试解析运行态 source/target。`DriverPlan` 不属于 catalog，只能由前端在完成上述 clone 和重写后生成。

### 3.2 `WasmCatalogV1`

Public 响应在 source body 外增加不可伪造的发布元数据：

```ts
type WasmCatalogV1 = Omit<WasmCatalogSourceV1, "schemaVersion"> & {
  meta: {
    gameId: string
    versionCode: string
    publishedAt: string
    generatedAt: string
    schemaVersion: "generic-p0"
    schemaHash: `sha256:${string}`
    rulesHash: `sha256:${string}`
  }
}
```

`meta.generatedAt` 仅记录 snapshot 生成时间，绝不能参与 `rulesHash`。前端在同一次 compile/run 中必须把 catalog 的两个 hash 同时写入 `CompileRequest` 与 `initialSnapshot`，并在 run 时以 `expectedRulesHash` 回传。

## 4. API 契约

### 4.1 Admin 编辑接口

```text
GET /api/admin/games/{gameId}/wasm-catalog-source
PUT /api/admin/games/{gameId}/wasm-catalog-source
```

`PUT` 全量替换该游戏的 source body，成功后返回已保存的 `WasmCatalogSourceV1` 加 `updatedAt`。它只更新编辑态，绝不影响 Public 读取；没有 source 的 `GET` 返回 `404.NOT_FOUND`。

`PUT` 必须立即完成全部 source 校验：JSON/字段类型错误返回 `400.INVALID_BODY`；本文 §5.1 的引用、type、旧字段和数值语义错误返回 `422.SEMANTIC_ERROR`，不得保存部分有效 source。发布阶段重复同一份校验，防止历史脏数据或绕过 Admin 写入的记录进入 snapshot；发布阶段额外校验版本存在性与 snapshot 写入冲突。

该接口是 P0 的原子编辑单元。为了避免前端先后提交 provider、ability、formula 时短暂产生无法发布的半成品，P0 不提供按 provider/ability 的独立写接口。后续细粒度编辑器落地时，仍必须物化成完全相同的 `WasmCatalogSourceV1`。

Admin `GET` 与 `PUT` 的成功响应固定为：

```ts
type WasmCatalogSourceResponse = WasmCatalogSourceV1 & {
  updatedAt: string // ISO-8601；仅编辑态观察值，不参与 hash
}
```

### 4.2 Public 发布读取接口

```text
GET /api/games/{gameId}/versions/{versionCode}/wasm-catalog
```

只从 `published_wasm_catalog_snapshots` 读取。找不到 game、version 或 snapshot 时返回 `404.NOT_FOUND`；不得从编辑态临时 materialize，也不得回退到 `/bundle` 伪造响应。

现有 `GET .../bundle` 保持 `GameDataBundleV1`；前端使用 Wasm 新引擎时改为先取 catalog，再在 Worker 前 local materialize。`POST /versions:publish` 的成功响应保持现有字段，前端仍通过 `versionCode` 请求新 catalog。

## 5. 发布、校验与 Hash

发布在同一事务中按以下顺序执行：

1. 继续构建并校验 legacy bundle，保证旧页面兼容。
2. 查询该 game 的 Wasm source；若不存在，跳过 Wasm snapshot，legacy 发布仍成功。
3. 若 source 存在，执行本文 §5.1 校验；失败以 `422.SEMANTIC_ERROR` 中止整个发布。
4. 以 canonical JSON 计算 hash，组装 `WasmCatalogV1`，写入 snapshot。
5. 更新 source 的版本范围和 source log，再切换 current version。

### 5.1 最小发布校验

1. `schemaVersion` 只能是后端已支持的 `generic-p0`，并且只能由 Admin request root 写入 `schema_version` 列；source JSON 内不得另有第二个 `schemaVersion`。
2. `typeCatalog.types[].key` 必须是小写 canonical `domain/name`，且 `domain` 等于 key 的 domain 部分；`relations` 的 parent/child 必须存在、无环、最大深度不超过 2。
3. `combatantTemplates` 至少有一个可选择 template；`attributes`、`resources` 必须是 object map，不得使用数组；属性槽的 `base/current/max/resolved` 必须为有限数。
4. 每个 `definitionRef` 必须指向唯一 `sharedProviders[].providerKey`；`providerRef` 必须是 `kind:stableId`，catalog provider/formula key 不得包含 `::`。模板态 `abilityRef` 必须遵守 §3.1 的 `$owner` / `$opponent` 格式；provider operation target 只能为 `self` / `opponent`，modifier/formula path 和 `op=ref` 必须遵守相对词表与同槽 clone 规则；`apply_provider.providerDefinitionRef` 必须引用 catalog provider key，且其 provider/ability、formula ref 和 operation target 必须可解析。
5. `rules` 的四个数组必须为空；`initialAbilityState` 必须为空对象或缺省。首期只把 mount `initialState` 写入 snapshot provider state，避免本地 ability key 到 runtime abilityRef 的隐式映射。
6. 递归拒绝旧 ABI 字段或概念：`EngineBundleV2`、`ActionTemplateV2`、`skillMounts`、`definitionKey`、数组式 `attributes/resources`、`setHpRaw`/`set_hp_raw`；公式 path 必须使用 §3.1 的 `$owner` / `$opponent` 模板根，不能直接携带运行态 source/target。
7. 具体 operation、formula、matcher 的语义校验应与 Wasm B1 fixture 的规则一致；后端 preflight 只做提前报错，Wasm compile 仍是最终消费方。

### 5.2 Hash 算法

1. `schemaHash = sha256(UTF-8("damage-viewer/wasm/generic-p0/catalog-v1"))`，值前缀固定为 `sha256:`；schema 发生不兼容变更时提高 schemaVersion 并更新这条常量。
2. `rulesHash = sha256(canonicalJson({ schemaVersion, typeCatalog, combatantTemplates, sharedProviders, rules, formulas, settings }))`。
3. `canonicalJson` 递归按 Unicode code point 排序 object key，数组保持语义顺序，以 UTF-8 无空白序列化；number 必须以有限 `BigDecimal.stripTrailingZeros().toPlainString()` 形式输出（`1.0` 归一为 `1`，`-0` 归一为 `0`）；不得使用数据库 JSONB 的任意遍历顺序、`updatedAt` 或 `generatedAt`。
4. snapshot `meta.publishedAt`、`meta.generatedAt` 与 `game_versions.published_at` 都使用 `publishVersion` 取得的同一个 `publishedAt` `Instant`；它们都不参与 `rulesHash`。

## 6. 前端 materialize 契约与兼容边界

前端依赖的是 §4.2 的稳定 DTO，而不是数据库表或 Admin source。它必须按以下顺序生成 Wasm 请求：

1. 以 `versionCode` 拉取 snapshot；catalog 缺失时显示“该版本尚未配置通用 Wasm catalog”，不能偷偷回退 legacy DPS lane。
2. 选择恰好两个 template，调用 §3.1 的双槽位 clone 与 ref 重写，得到 `CompileRequest.combatants=[source,target]`、slot-scoped runtime `sharedProviders[]` 与 `formulas[]`；顶层 `rules` 原样传递四个空数组。
3. 合并本地 numeric override。每个修改后的属性槽必须保持有限 `base/current/max/resolved`，且 P0 默认 `resolved=current`；resources 保持 `{current,max}` object map。
4. 生成 `CompileRequest`：`schemaVersion/schemaHash/rulesHash` 直接使用 `catalog.meta`；`combatants` 使用步骤 2 materialize 后的 `[source,target]`；`sharedProviders`、`formulas` 使用步骤 2 的双槽 clone 结果；仅 `typeCatalog`、四个空数组的 `rules`、`settings` 原样使用 catalog；不填 driver、sampling 或 snapshot。
5. 生成 `initialSnapshot`：`schemaHash/rulesHash` 同 compile，`timeMs=0`，并且两个 combatant 都显式带 `attributes`、`resources`、`cooldowns={}`、`providers[]`、`shields=[]`、`abilityState={}`、`providerState={}`、`vars={}`。每个初始 persistent mount 都写入 `{providerRef, definitionRef, source:<slot>, owner:<slot>, stacks:1, expireAt:null, state:{}}`；mount 的 `initialState` 覆盖其空 state。P0 已拒绝非空 `initialAbilityState`，所以 `abilityState` 固定 `{}`。
6. 生成 `RunRequest`：`expectedRulesHash`、根 `schemaHash/rulesHash` 与 snapshot 均复制 `catalog.meta`；`DriverPlan`、`StopPolicy`、`Sampling` 和用户 override 仅在前端本地生成。随后调用 `engine_compile`、`engine_run`、`engine_release_session`。
7. session cache 不能只以 catalog `rulesHash` 为 key：选择的 template、canonical override、双槽位 clone 后的 compile payload 任一变化都必须 release/recompile；catalog meta hash 改变也必须 release/recompile。

前端不得把旧 `/bundle` 的 `skills`、`skillMounts` 或 `typeId` 直接透传给 Wasm。

## 7. 后续切片与迁移

P0 先通过 source document 保证契约可用和发布可回放。后续必须单独设计以下工作，不能在本切片暗中混入：

1. hero/item/skill/status/formula 等 legacy 原始数据的全量导入与人工补录流程；首批 6 ADC 基础实体 bootstrap 已由 [WasmLegacyAdcBootstrapAdapter详细设计.md](WasmLegacyAdcBootstrapAdapter详细设计.md) 覆盖，DPS 专属机制仍不自动转换。
2. 拆分为 `wasm_provider_definitions`、`wasm_ability_definitions`、`wasm_formula_definitions` 等细粒度编辑表与 Admin CRUD。
3. 将细粒度编辑态物化为同一 source DTO，保持 Public API 和 hash 语义不变。
4. 增加跨 worktree contract CI：后端发布 fixture 的 catalog 必须能通过 Wasm `engine_compile`；这只用于测试，生产后端不调用 Wasm。

### 7.1 旧 DB / 接口 Deprecated 台账

`Deprecated` 在本节的含义固定为 **不得被新通用 Wasm 直接消费**，不是立即删除、停止写入或返回 HTTP deprecation header。下表记录的是防止后续实现误走旧链路的边界：

| 旧资产 | 状态 | 当前保留原因 | 新 Wasm 的替代 |
| --- | --- | --- | --- |
| `heroes`、`skills`、`skill_mounts`、`mechanics_config` 等 legacy 原始表 | Deprecated for direct new-Wasm consumption | 仍是普通数据管理与 legacy Bundle 构建的输入；首批 Bootstrap 也只读其已发布 Bundle 表现 | `wasm_catalog_sources` 的 `WasmCatalogSourceV1` |
| `published_bundle_snapshots` | Deprecated for direct new-Wasm consumption | 历史 Bundle、旧页面和 Bootstrap 输入仍依赖它 | `published_wasm_catalog_snapshots` |
| `GET /api/games/{gameId}/versions/{versionCode}/bundle` / `GameDataBundleV1` | Deprecated for direct new-Wasm consumption | 旧页面与非 Wasm 消费者继续使用，保持版本化历史读取 | `GET /api/games/{gameId}/versions/{versionCode}/wasm-catalog` / `WasmCatalogV1` |
| legacy `EngineBundleV2`、`ActionTemplateV2`、`single_attacker_dps` 口径 | Deprecated in new generic-Wasm flow | 仅可留在旧页面、compat fixture 或回归对照 | `CompileRequest`、`AbilityDefinition`、generic compile/run |

当前没有可直接删除的旧 Wasm 专用后端 HTTP 路由；`/bundle` 是兼容读取接口，而非待立即下线接口。物理删表、删快照或删除 `/bundle` 必须另立任务，且先证明所有消费者已改用 Catalog、目标历史版本达到保留期限，并完成双链路发布回归。

## 8. 实施与验收范围

后续编码只允许修改 `db/game_manage/**`、`server/data_manage/**`、本详细设计、[game_manage 接口定义](接口定义.md) 和任务治理映射。最小验收包括：DDL parent/partition 检查、Admin source 全量写读、发布后 Public snapshot 读取、hash 重复稳定、legacy bundle 回归，以及一条由 Wasm compile 接受的 catalog contract fixture。
