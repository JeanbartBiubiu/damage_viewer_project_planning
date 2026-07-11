TASK_KEY: web-wasm-catalog-integration
DOC_TYPE: 详细设计
WORKSTREAM: web/wasm-generic
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-11

# 通用 Wasm Catalog 前端接入方案

## 1. 目标、范围与非目标

本方案将现有“Generic 引擎验证”页从内嵌 `generic_p0_basic_damage` fixture 改为消费后端发布的 `WasmCatalogV1`，在浏览器 Worker 内完成 canonical materialize 并调用通用 Wasm ABI。

唯一后端数据源为：

```text
GET /api/games/{gameId}/versions/{versionCode}/wasm-catalog
```

完整服务端 DTO、发布快照和 hash 规则以 [Wasm Canonical Catalog 后端详细设计](../server/game_manage/WasmCanonicalCatalog后端详细设计.md) 为准；Wasm ABI、DTO、输出与 fixture 以 [WASM详细设计](../wasm/WASM详细设计.md) 为准。旧 Bundle 验证链路的定位见 [Bundle编译层实施方案](Bundle编译层实施方案.md)。

本次写入范围：

```text
web/src/types/api.ts
web/src/types/genericEngine.ts
web/src/types/wasmCatalog.ts                         # 新增
web/src/services/apiClient.ts
web/src/services/wasmCatalogSnapshot.ts              # 新增
web/src/engine/tinygoV2Bridge.ts
web/src/engine/genericEngineClient.ts
web/src/engine/genericCatalogMaterializer.ts         # 新增
web/src/workers/genericEngineWorker.ts
web/src/pages/WasmValidationGenericPage.tsx
web/src/App.tsx
web/src/config/navigation.ts                          # 仅更新 Generic 页文案时修改
web/** 测试与测试配置                              # 新增
```

非目标：

1. 不修改后端 catalog、发布、hash 或 Admin source 接口。
2. 不让新页面回退到 `GET .../bundle`、`EngineBundleV2`、`skillMounts` 或 `single_attacker_dps`。
3. 不实现 catalog Admin 编辑器、bootstrap Admin 操作、多人战斗、暂停/续跑、batch/sweep 或正式对比工作台。
4. M1/M2/M3/M4 和 DPS 页面继续作为 legacy/compat 回归入口；不在本次重构它们。

## 2. 固定契约与页面状态

### 2.1 读取链路

页面接收 App 已有的 `apiBaseUrl`、`selectedGameId`、`selectedGameName`、`externalRefreshSeed`。`apiBaseUrl`、`selectedGameId`、`externalRefreshSeed` 任一变化，以及用户点击手动重载时，都必须先 release/清空旧 session，再重新执行一次以下读取链；`App.tsx` 向 Generic 页传递 refresh seed 的方式与现有 M2/DPS 页面一致。加载顺序固定为：

```text
getCurrentVersion(gameId)
  -> getWasmCatalog(gameId, current.versionCode)
  -> WasmCatalogV1
  -> 用户选择 source / target template 与本地覆盖
  -> local materialize
  -> engine_compile
  -> engine_run
  -> engine_release_session
```

`getWasmCatalog` 复用 `apiClient.ts` 的 `ApiResult<T>`、路径编码和 `ApiRequestError`。新增 `loadPublishedWasmCatalogSnapshot`，只负责 current version 与 catalog 的联合读取；它不能调用 `bundleSnapshot.ts`，也不能写入现有 Bundle IndexedDB cache。

404 必须按读取阶段分流：

1. `getCurrentVersion` 的 `404.NOT_FOUND`（游戏不存在或没有 current version）是普通读取错误；此时没有可信 `versionCode`，不得显示 catalog empty state。
2. 仅当 current version 已成功读取、随后 `getWasmCatalog(gameId, versionCode)` 返回 `404.NOT_FOUND` 时，页面才显示“该发布版本尚未配置通用 Wasm catalog”，并展示已确认的 gameId/versionCode 与重新加载入口；Run/Compile 按钮禁用。
3. 其他 HTTP 错误沿用 `ApiRequestError` 的 code/message/details 展示。不得把任何 404 静默转成旧 DPS 或 fixture 运行。

### 2.2 `WasmCatalogV1` TypeScript 模型

新增 `web/src/types/wasmCatalog.ts`，完整表达 Public 响应：

```ts
type WasmCatalogV1 = {
  meta: {
    gameId: string
    versionCode: string
    publishedAt: string
    generatedAt: string
    schemaVersion: 'generic-p0'
    schemaHash: `sha256:${string}`
    rulesHash: `sha256:${string}`
  }
  typeCatalog: TypeCatalog
  combatantTemplates: CombatantTemplate[]
  sharedProviders: ProviderDefinition[]
  rules: EmptyP0Rules
  formulas: NamedFormula[]
  settings: CompileSettings
}
```

`genericEngine.ts` 不再用 `unknown[]` 或宽泛 `Record<string, unknown>` 表示 `CompileRequest`、`RunRequest`、combatant/provider/ability、formula、driver、sampling、budget、result。它应成为浏览器到 Wasm 的严格 canonical DTO 真源；`wasmCatalog.ts` 仅增加 template 态字段和 Public `meta`。

`rules` 在 P0 必须是四个显式空数组。前端收到非空数组时视为契约错误并阻止 Compile，不猜测全局规则的 owner slot。

```ts
type EmptyP0Rules = {
  operations: []
  modifiers: []
  listeners: []
  triggerRules: []
}
```

### 2.3 页面交互状态

`WasmValidationGenericPage` 替换内嵌 fixture，维护以下状态：

1. 发布 catalog、current version 与加载/404/HTTP-error 状态。
2. `sourceTemplateKey`、`targetTemplateKey`：必须都来自 `combatantTemplates`；允许选择相同 template，但 materialize 后仍固定为 `source`、`target` 两个 slot。
3. source/target 的 attribute 与 resource 数字覆盖。属性覆盖编辑 `base/current/max`，提交 materialize 时固定 `resolved=current`；资源覆盖编辑 `current/max`。所有值必须为有限 number。
4. 一个显式 `DriverPlan`：可选项只能是 source template 的 `providers[]` 中某个已挂载 provider，与其对应 `source::<definitionRef>` clone 中 `kind=active` ability 的交集；被动/监听类 ability 可以展示说明，但不能写入 DriverPlan，未挂载的 shared provider 也不得列入可选项。提交时 `abilityRef` 固定取该 option 的提交值，且 provider 段使用该 `providers[]` entry 的 `providerRef`（`kind:stableId`）；P0 的每个 entry 固定 `source="source"`、`target="target"`，并配置 `entryKey`、`firstAtMs`、`priority`，以及可选 `repeat.intervalMs`、`repeat.maxAttempts`、`whileReady`。DriverPlan 根的 `conditionRecheckIntervalMs` 缺省写为 `100`（允许范围 `10..1000`）。不得提供“扫描全部 active ability”的模式。
5. `StopPolicy`、`SamplingConfig` 与可选 JSON 字段 `safetyBudget`（TypeScript 类型可命名为 `SafetyBudget`，但请求中不得出现 `budget` 或 `SafetyBudget`）。`StopPolicy.durationMs` 是必填的有限正数，P0 默认 `10000`；`stopOnTargetDeath=true`、`stopWhenNoEvents=true`。采样默认值为 `sampleEveryMs=100`、`dpsWindowMs=1000`、`maxSeriesPoints=5000`。`safetyBudget` 省略时使用引擎默认；它的请求允许且仅允许覆盖 `maxChainDepth=32`、`maxCommandsPerEvent=256`、`maxEvents=100000` 三项。`maxEvidenceItems=1000` 与 `maxWarnings=100` 是引擎内部默认，P0 UI 只读展示、不写入 JSON。每项允许用户编辑时必须在前端校验范围和有限数。
6. 当前 compiled session 的 `sessionId`、`sessionSignature`、`rulesHash`；它们仅在内存保存，不进入 localStorage/IndexedDB。

切换 game/version/template、修改任何 numeric override 或会影响 CompileRequest 的配置时，旧 session 立即标记不可运行；在 Worker 可用时先 `release`，随后清空 session 状态。`sessionSignature` 必须基于稳定 key 排序序列化后的完整 CompileRequest，而不是仅使用 catalog `rulesHash`。

## 3. Worker 前 canonical materialize

`genericCatalogMaterializer.ts` 是无 DOM、无网络、可单元测试的纯函数模块。其输入为 `WasmCatalogV1 + GenericScenarioSelection + GenericScenarioOverrides`，输出为：

```ts
type MaterializedGenericScenario = {
  compileRequest: CompileRequest
  initialSnapshot: InitialSnapshot
  availableSourceAbilities: GenericAbilityOption[]
  sessionSignature: string
}
```

实现顺序必须与后端契约一致：

1. 按 `templateKey` 找到两个 template，深拷贝后删除 template 态的 `templateKey`，并写入 Wasm `CombatantDefinition.key: "source" | "target"`；其余 attributes/resources/`providers[]` 等定义保持深拷贝结果。`CompileRequest.combatants` 恰好包含这两个 key 各一次。
2. 对 catalog 中每个 `sharedProviders[].providerKey` 深拷贝两次，分别命名为 `source::<catalogProviderKey>`、`target::<catalogProviderKey>`；同样深拷贝每个 formula 为 `source::<formulaKey>`、`target::<formulaKey>`。catalog 对象绝不能被修改或直接透传为 compile 结果。
3. 将两个 combatant 的 `providers[]` entry 的 `definitionRef` 改为所属 slot 的 provider clone；`providerRef` 保留 catalog 的 `kind:stableId`。source ability option 仅从 source template 的已挂载 `providers[]` entry 及对应 source provider clone 的 `kind=active` ability 派生，展示值可含 display metadata，提交值固定为 `source.provider[providerRef].ability[abilityKey]`，其中 `providerRef` 必须来自该 entry。
4. 在 provider clone 的 listener、operation 等 ability 引用中，将 `$owner` / `$opponent` 改写为当前 clone 视角下的 `source` / `target`。同一遍历中必须改写每个 `ModifierDefinition.target`：`$owner.attr.<key>` / `$opponent.attr.<key>` 分别映射为当前 clone 视角的 `source.attr.<key>` / `target.attr.<key>`；不能遗漏 attribute modifier。catalog 内直接 `source`/`target`、裸 abilityKey 或 runtime `self`/`opponent` 前缀属于非法输入，前端不得尝试兼容。
5. provider 内 `operation.target` 保留 `self` / `opponent`；`apply_provider.providerDefinitionRef` 依据“当前 clone slot × operation.target”映射为目标 slot 的 `<slot>::<catalogProviderKey>`。`refresh_provider` / `expire_provider` 不给 providerRef 添加 slot 前缀。
6. clone 公式与 provider 内全部 `GenericFormulaExpr` 树，递归覆盖 `args`、`expr`、`min`、`max`：改写 `$owner/$opponent` attribute/resource path，并将 `op=ref` 的裸 catalog formula key 改写为当前 slot 的 `<slot>::<formulaKey>`；`ability.param.*` 原样保留。
7. 应用数值覆盖。属性槽必须输出 `{base,current,max,resolved}` 且 `resolved=current`，资源槽输出 `{current,max}`；不得把未定义覆盖转成 `null`、数组或 `NaN`。
8. 生成 CompileRequest：`schemaVersion/schemaHash/rulesHash` 直接复制 `catalog.meta`，typeCatalog/settings 原样复制，rules 保持四个空数组；driver、snapshot、sampling 均不得混入 compile。
9. 生成 initialSnapshot：复制两个物化 combatant 的属性/资源，并显式填写 `timeMs=0`、`cooldowns={}`、`providers[]`、`shields=[]`、`abilityState={}`、`providerState={}`、`vars={}`。每个物化 combatant `providers[]` entry（挂载语义）生成 `{providerRef, definitionRef, source:<slot>, owner:<slot>, stacks:1, expireAt:null, state:{}}`，再以该 entry 的 `initialState` 覆盖 state。

materializer 只生成 CompileRequest 和 initialSnapshot；RunRequest 由页面将它们与本地 driver/stop/sampling/`safetyBudget` 组合。RunRequest 须将 catalog 的 schemaHash/rulesHash 同时写入根、initialSnapshot 和 expectedRulesHash；DriverPlan 必须包含完整 entry 的 `abilityRef/source/target` 与根 `conditionRecheckIntervalMs`，不能依赖 Wasm 对空字符串或缺失 selector 的猜测。

## 4. 通用 ABI 宿主调整

### 4.1 Bridge 与 frame

`TinyGoV2Bridge` 保留 legacy 页面使用的入口，但新增显式 `profile: 'legacy' | 'generic'`：

1. generic profile 只校验 `memory`、`alloc`、`dealloc`、`engine_compile`、`engine_run`、`engine_release_session`、三个 outbox 函数；不能因新产物删除 `engine_init/engine_step` 而无法加载。
2. legacy profile 保持现有 export 校验，保证 M1–M4/DPS 不被本次影响。
3. 新增 `OUTBOX_GENERIC_RELEASE_RESULT = 214`；release 只能读取 214，不能复用 211 `done` 或按 payload shape 分流。
4. generic Worker 创建 Bridge 时使用 generic profile。

### 4.2 Client 与 Worker

`GenericEngineClient` 的 30 秒 watchdog 保持在主线程：超时必须 terminate/recreate Worker 并丢弃该 session，不能依赖被同步 Wasm 调用阻塞的 Worker 内计时器。实施时删除或禁用 `genericEngineWorker.ts` 内部的 run timeout，避免两个 timeout 机制产生漂移。

结果解析规则：

1. `210 compile_result + ok=false` 是可展示的 collect-all 失败，`compile()` 返回完整 CompileResult，不得只抛 `errors[0]`。
2. `212 generic_error` 是 ABI/run fatal error，拒绝 Promise；页面展示 `phase/code/path/ref/message/details`，不保留或复用 finalSnapshot。
3. `211 done` 只解析为 DoneResult，`214` 只解析为 GenericReleaseDonePayload。
4. release 成功、页面卸载、catalog/version/selection 改变、run timeout 后都清理本地 sessionId；release 失败不允许把 session 视为可继续使用。

## 5. 页面输出与错误呈现

Generic 页使用 `summary`、`series[]`、`warnings[]`、`evidence`、`seriesSamplingEvidence` 作为主数据，禁止从 log/frame 明细重建曲线。

1. Compile 区展示 sessionId、hash、metadata、warnings；`ok=false` 展示所有 compile errors 的 `code/path/ref/message` 表格，并保持 Run 禁用。
2. Run Summary 展示双方 final HP、双方造成/承受伤害、attempt/cast/skip、warningCount、stopReason、截断与降采样标志、abilityStats。
3. 图表至少包含 HP、累计伤害、累计 DPS、窗口 DPS；timeMs 作为共同横轴。表格保留全部 SeriesPoint 字段。
4. Evidence 展示 `items`、`countsByKind`、`truncatedEvidenceCount` 及每项 `data`；Warnings 关联其 refs/evidenceRefs。
5. `seriesSamplingEvidence` 展示请求/实际间隔、理论/实际点数、上限、downsampled 与 method。
6. `hash_mismatch`、`session_not_found`、`budget_exceeded`、`attempt_skipped`、`downsampled` 使用结构化 code 提示，不能仅显示通用“Run 失败”。

## 6. 实施顺序与测试

### 6.1 实施顺序

1. 增加 catalog DTO、`getWasmCatalog`、snapshot service，以及 API 404 页面状态；此阶段不触碰 legacy Bundle service。
2. 落地 materializer 与其 unit test，使用后端发布的 catalog fixture 和 Wasm `generic_p0_*` fixture 验证双槽 clone/ref rewrite/override/snapshot。
3. 收紧 generic DTO 和 bridge/client frame 解析，先解决 release 214 与 collect-all compile errors，再切 Generic Worker 为 generic profile。
4. 将 Generic 页改为真实 catalog 选择、物化、compile/run/release 和 chart/evidence 展示；App 向页面传入全局 game/API props 与 `externalRefreshSeed`，并用它触发 §2.1 的 release → reload 链。
5. 增加自动化回归并更新导航/接口索引；legacy 页面只做非回归性 smoke。

### 6.2 最小测试集

新增前端测试命令与配置后，至少覆盖：

1. materializer：双槽 provider/formula clone、ability ref 与 attribute `ModifierDefinition.target` 的 `$owner/$opponent` rewrite、formula ref rewrite、`apply_provider` 四格映射、两类 numeric override、`templateKey` 到 combatant `key` 映射、sessionSignature 失效。
2. ABI client：210 的多 compile errors、211 done、212 fatal error、214 release result、run 超时 Worker 重建。
3. 服务层：current version → wasm-catalog；current 的 404 为普通读取错误、catalog 的 404 为专用 empty state，二者均不回退 bundle；覆盖路径参数编码与 ApiRequestError 保留。
4. 请求组装：DriverPlan 只选择 source `providers[]` 已挂载 clone 中的 `kind=active` ability，且每个 entry 都带 `abilityRef/source/target`；验证 `conditionRecheckIntervalMs=100`、`durationMs=10000` 的默认值，以及 `safetyBudget` 仅含三个允许字段/整体省略语义。
5. 浏览器 E2E：选择两个 template、修改覆盖、Compile、Run、查看 summary/series/warning/error；无 catalog snapshot 的发布版本显示专用 empty state；变更 externalRefreshSeed 后 release 旧 session 并读取新 catalog。

实现完成后的验证命令：

```powershell
cd web
npm run test:wasm-generic
npm run test:e2e:wasm-generic
npm run build
```

在有可用后端与已同步 Wasm 产物的环境，另跑一次真实 `GET /versions/current -> GET /wasm-catalog -> compile -> run -> release`；至少分别验证成功 catalog、catalog 404、compile 多错误和 series downsample fixture。

## 7. 验收门槛

1. Generic 页的所有新 Wasm 输入仅来自发布 catalog 和本地物化；网络面不存在 `/bundle` 作为新 ABI 输入的调用。
2. catalog `meta.schemaHash/rulesHash` 原样进入 CompileRequest、initialSnapshot、RunRequest 与 expectedRulesHash；选择/覆盖变化绝不复用旧 compiled session。
3. source/target clone 后没有 `$owner`、`$opponent`、裸 formula ref、未改写的 attribute `ModifierDefinition.target`、catalog providerKey 直接作为 runtime definitionRef，或 legacy DTO 字段；template 态 `templateKey` 已被替换为 runtime combatant `key`，并且 DriverPlan 不会引用未挂载 provider 的 ability。
4. release 成功消费 214；compile collect-all 完整可见；fatal error 不显示 done/finalSnapshot。
5. 页面完整消费 Summary/Series/Evidence/Sampling Evidence；DPS 曲线不从日志推导。
6. 自动化测试和 `npm run build` 通过；接口、materialize 与页面三层满足后端契约 review。
