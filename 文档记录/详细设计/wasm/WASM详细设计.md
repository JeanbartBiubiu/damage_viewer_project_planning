TASK_KEY: wasm-engine-v2-architecture
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: Codex 主负责人整理现行契约
LAST_TRACKED_AT: 2026-10-15

# Wasm通用协议与语义约束

本文保留编译、运行、释放及数值执行的共享语义；类型字段和实际实现以当前源码为准。目录、调用关系、构建与检查入口见[引擎说明](../../../wasm/tinygo_engine_v2/README.md)和[架构图](../../../wasm/tinygo_engine_v2/ARCHITECTURE.md)。共同公式、作者用途和自动技能的后续增量以根阅读入口所指当前共享设计为准；下文早期字段示例不能覆盖后续协议。

旧实施分工、开发提示词、逐样例清单和退休入口说明已清理，历史决定可从Git追溯。当前只采用通用编译／运行／释放路径，旧分步循环与专用DPS入口不恢复。

## 2. ABI 契约（已实现）

当前 ABI 分为内存/outbox glue 与业务调用两层。

内存/outbox glue：

```text
alloc(size) -> ptr
dealloc(ptr, size)
engine_outbox_ptr() -> ptr
engine_outbox_len() -> len
engine_outbox_clear()
```

业务调用：

```text
engine_compile(ptr, size) -> 0/-1
engine_run(ptr, size) -> 0/-1
engine_release_session(ptr, size) -> 0/-1
```

调用约定：

1. `engine_compile` 接收 compile frame，成功后 outbox 写 `compile_result`。
2. `engine_run` 接收 run frame，内部完成单次 deterministic run，成功后 outbox 写 `done`，fatal error 时写 `error`。
3. `engine_release_session` 接收 `sessionId`，释放 compiled session。
4. `engine_run` 不接受 compiled artifact 本体，只接受 `sessionId` 与 hash 校验字段。
5. Worker 必须提供墙钟超时保护，默认单次 run 最多 30 秒；超时属于宿主安全边界，必要时 terminate/recreate Worker。

首期 frame 仍使用固定 header + UTF-8 JSON payload。二进制 payload 可以预留 kind，但 P0 不实现 MessagePack/CBOR 快路径。

### 2.0 FrameKind / Outbox Kind（已实现）

常量定义于 `internal/model/generic.go`。旧 legacy frame kind（曾位于 `types.go` 的 `1..17` / `100`）已随 step-loop 路径删除；当前业务只使用 generic `200..214`。

| 用途 | 常量名 | 编号 | 方向 | payload |
| --- | --- | --- | --- | --- |
| compile 请求 | `FrameKindGenericCompile` | `200` | host -> wasm | `CompileRequest` |
| run 请求 | `FrameKindGenericRun` | `201` | host -> wasm | `RunRequest` |
| release session 请求 | `FrameKindGenericReleaseSession` | `202` | host -> wasm | `ReleaseSessionRequest` |
| compile 结果 | `FrameKindGenericCompileResult` | `210` | wasm -> host | `CompileResult` |
| run 完成 | `FrameKindGenericDone` | `211` | wasm -> host | `DoneResult` |
| run/compile 错误 | `FrameKindGenericError` | `212` | wasm -> host | `EngineError` |
| snapshot 调试输出 | `FrameKindGenericSnapshot` | `213` | wasm -> host | `Snapshot` |
| release session 结果 | `FrameKindGenericReleaseResult` | `214` | wasm -> host | `GenericReleaseDonePayload` |

规则：

1. 旧 legacy frame kind 已删除；generic ABI 不复用旧 kind，也不按 payload shape 分流。
2. compile collect-all 失败优先返回 `FrameKindGenericCompileResult{ok=false, errors[]}`；ABI/run fatal 写 `FrameKindGenericError`。
3. `done` / `error` / `compile_result` / `release_result` 为 outbox priority frame。
4. `engine_release_session` 成功必须写 `FrameKindGenericReleaseResult`，不得复用 generic done。
5. 新增编号前检查 `generic.go`，在 `200..249` 内顺延并同步本文档。

`ReleaseSessionRequest` 最小字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 需要释放的 compiled session。 |
| `expectedRulesHash` | string | 否 | 调用方可选的防误删校验。 |

### 2.1 Canonical ABI 与兼容表面

**当前 canonical 入口**：`engine_compile` / `engine_run` / `engine_release_session`（见 `cmd/engine_wasm/main.go`、`session.go`）。

历史说明：legacy `engine_init` / `engine_begin_run` / `engine_step` / snapshot / abort 与 `dps_*.go` 曾作 compat；LEGACY-DPS-REMOVAL 后已从 TinyGo V2 源码与导出移除。generic run 对外是单次 deterministic `done`/`error`，不是 step-loop 契约。Web/Worker 资产与仍依赖旧导出的宿主迁移是后续有序步骤。

### 2.2 Fixture / Smoke / Benchmark 验证（已实现）

| 表面 | 契约 |
| --- | --- |
| Canonical fixture | `internal/testkit/fixtures/generic_p0_basic_damage.json`（复用；勿改）。`expectedSummarySubset` 含 `targetFinalHp=900`、一次成功 cast/attempt。 |
| Go session 测试 | `internal/runtime/session_generic_test.go` 覆盖 compile/run/release 与 hash/session 错误。 |
| Node smoke | `scripts/smoke-node.mjs`：instantiate + compile → run → release round-trip，校验 summary subset。 |
| Node bench | `scripts/bench-node.mjs --mode generic-run`：compile 在测量外，warmup/run `engine_run`，校验每次结果后 release。 |
| Go bench | `go run ./cmd/bench` 默认 generic-run；不支持/未知参数统一非零退出。 |

剩余缺口（仅在源码可证时记录）：浏览器 Worker 正式宿主完整切到 generic profile、以及仍依赖 legacy 页面的宿主迁移，不在本批文档/工具范围强行宣称完成。

## 3. Compile 输入与输出

### 3.1 CompileRequest

compile payload 的顶层结构：

```text
CompileRequest
  schemaVersion
  schemaHash
  rulesHash
  typeCatalog
  combatants[2]
  sharedProviders[]
  rules
  formulas[]
  settings
```

要求：

1. `schemaVersion` 必须是 Wasm 支持的 canonical schema。
2. `schemaHash` 和 `rulesHash` 用于错配检测、结果追踪和 evidence。
3. `combatants` 首期固定两个主要 combatant 槽位。
4. provider、ability、modifier、listener、operation 都必须使用 canonical 字段名。
5. compile payload 中不得出现旧后端/旧前端 DTO 术语。
6. `rules` 是规则聚合容器，P0 至少包含 `operations`、`modifiers`、`listeners`、`triggerRules` 的空数组或显式定义。

最小合法 `CompileRequest` 样例：

```json
{
  "schemaVersion": "generic-p0",
  "schemaHash": "schema.generic-p0.example",
  "rulesHash": "rules.basic-damage.example",
  "typeCatalog": {
    "types": [
      { "key": "ability/basic_attack", "domain": "ability" },
      { "key": "damage/physical", "domain": "damage" }
    ],
    "relations": []
  },
  "combatants": [
    {
      "key": "source",
      "displayName": "Source",
      "types": [],
      "tags": [],
      "attributes": {
        "attack_damage": { "base": 100, "current": 100, "max": 100, "resolved": 100 }
      },
      "resources": {},
      "providers": [
        {
          "providerRef": "champion:source_demo",
          "definitionRef": "champion:source_demo"
        }
      ]
    },
    {
      "key": "target",
      "displayName": "Target",
      "types": [],
      "tags": [],
      "attributes": {
        "hp": { "base": 1000, "current": 1000, "max": 1000, "resolved": 1000 }
      },
      "resources": {},
      "providers": []
    }
  ],
  "sharedProviders": [
    {
      "providerKey": "champion:source_demo",
      "kind": "champion",
      "stableId": "source_demo",
      "types": [],
      "tags": [],
      "abilities": [
        {
          "abilityKey": "basic_attack",
          "kind": "active",
          "types": ["ability/basic_attack"],
          "params": { "baseDamage": 100 },
          "operations": [
            {
              "operation": "damage",
              "target": "target",
              "amount": { "op": "read", "path": "ability.param.baseDamage" },
              "damageType": "damage/physical"
            }
          ]
        }
      ]
    }
  ],
  "rules": {
    "operations": [],
    "modifiers": [],
    "listeners": [],
    "triggerRules": []
  },
  "formulas": [],
  "settings": {}
}
```

### 3.2 CompileResult

成功返回：

```text
CompileResult
  ok=true
  sessionId
  schemaVersion
  schemaHash
  rulesHash
  warnings[]
  metadata
```

失败返回：

```text
CompileResult
  ok=false
  errors[]
  schemaHash
  rulesHash
```

进入已知 schema 后，compile 必须尽量 collect-all errors。只要 `errors[]` 非空，就不能生成可运行 session。`warnings[]` 不阻止 session 生成。

`CompileResult.metadata` 最小字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `combatantCount` | number | 是 | P0 固定为 2。 |
| `providerCount` | number | 是 | compiled provider definition 数。 |
| `abilityCount` | number | 是 | compiled ability 数。 |
| `typeCount` | number | 是 | compiled canonical type 数。 |
| `formulaCount` | number | 是 | compiled formula 数。 |

metadata 只用于调试、evidence 和 smoke 断言，不参与 runtime 机制判断。新增 metadata 字段不得成为 run 必填输入。

## 4. Run 输入与输出

### 4.1 RunRequest

run payload 的顶层结构：

```text
RunRequest
  sessionId
  expectedRulesHash
  initialSnapshot
  driverPlan
  stopPolicy
  sampling
  safetyBudget
  runtimeOptions
```

`initialSnapshot` 必须携带 `schemaHash` 和 `rulesHash` 或等价 `snapshotRulesHash`。hash 不匹配时拒绝 run，返回 `error.code=hash_mismatch`。

`stopPolicy`：

```text
StopPolicy
  durationMs
  stopOnTargetDeath
  stopWhenNoEvents
```

`durationMs` 是必填上限。事件队列为空、目标死亡或预算耗尽可以提前停止。

`StopPolicy` 字段表：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `durationMs` | number | 是 | 无 | 本次 run 最大逻辑时长。 |
| `stopOnTargetDeath` | bool | 否 | `true` | target 死亡后提前停止。 |
| `stopWhenNoEvents` | bool | 否 | `true` | 事件队列为空后提前停止。 |

`stopOnTargetDeath=false` 时，target 死亡不立即停止，但 source/target death state 仍进入 summary/evidence。安全预算耗尽不受这些开关影响。

`sampling`：

```text
SamplingConfig
  sampleEveryMs
  dpsWindowMs
  maxSeriesPoints
```

默认值：

1. `sampleEveryMs=100`
2. `dpsWindowMs=1000`
3. `maxSeriesPoints=5000`

`safetyBudget` 默认值：

1. `maxChainDepth=32`
2. `maxCommandsPerEvent=256`
3. `maxEvents=100000`
4. `maxEvidenceItems=1000`
5. `maxWarnings=100`

### 4.2 Run Output

正常完成只返回 `done`：

```text
DoneResult
  ok=true
  summary
  finalSnapshot
  series[]
  warnings[]
  evidence
  seriesSamplingEvidence
```

fatal error 只返回 `error`，不同时返回 `done`，也不提供可续跑的 final snapshot。

## 5. Canonical 模型结构

### 5.1 CombatantDefinition

```text
CombatantDefinition
  key
  displayName
  types[]
  tags[]
  attributes
  resources
  providers[]
```

P0 runtime 只创建两个主要 combatant：`source` 与 `target`。`self`、`opponent`、`source`、`target` 是 P0 唯一 target selector 集合。

`CombatantDefinition` 最小字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `key` | string | 是 | `source` 或 `target`，P0 固定两个。 |
| `displayName` | string | 否 | 展示名，不参与机制语义。 |
| `types` | string[] | 否 | canonical type keys。 |
| `tags` | string[] | 否 | canonical tag keys。 |
| `attributes` | object | 是 | attr key -> `AttributeSlotDefinition`。 |
| `resources` | object | 是 | resource key -> `ResourceSlotDefinition`。 |
| `providers` | array | 是 | `CombatantProviderMount[]`。 |

`AttributeSlotDefinition` 最小字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `base` | number | 是 | base view 初始值。 |
| `current` | number | 是 | current view 初始值。 |
| `max` | number | 是 | max view 初始值。 |
| `resolved` | number | 否 | 缺省等于 resolver 计算值；无 modifier 时可等于 current/base。 |

`ResourceSlotDefinition` 最小字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `current` | number | 是 | 当前资源。 |
| `max` | number | 是 | 最大资源。 |

compile input 中 `attributes` 与 `resources` 固定使用 object map；数组不是 P0 canonical shape。snapshot 也使用相同 map 形态，避免 compile/run fixture 分叉。

### 5.2 CapabilityProviderDefinition

```text
CapabilityProviderDefinition
  providerKey
  kind
  stableId
  types[]
  tags[]
  abilities[]
  modifiers[]
  listeners[]
  lifecycle
  initialStateSchema
```

`kind` 至少支持：

```text
champion
item
rune
talent
status
system
```

providerRef 规则：

1. persistent provider 使用 `kind:stableId`。
2. dynamic provider 使用 `kind:stableId#instanceId`。
3. `kind` 只用于分类与 matcher，不用于唯一寻址。

### 5.3 AbilityDefinition

```text
AbilityDefinition
  abilityKey
  kind
  types[]
  tags[]
  params
  cost
  cooldown
  operations[]
  listenerSpec
  tickSpec
  stateSchema
```

`kind` 至少支持：

```text
active
passive_listener
aura_modifier
tick
stateful
```

abilityRef 使用：

```text
combatant.provider[providerRef].ability[abilityKey]
```

P0 canonical abilityRef 字符串固定为：

```text
source.provider[champion:ashe].ability[basic_attack]
target.provider[item:thornmail].ability[reflect]
```

规则：

1. 前缀只能是 `source`、`target`、`self`、`opponent` 之一。
2. `providerRef` 是 provider instance/ref 字符串，不是 provider kind。
3. `abilityKey` 是 provider 内 local key。
4. abilityRef 不接受裸 `abilityKey`、裸全局 `abilityId` 或 `providerRef::abilityKey`。
5. compile 阶段负责把 abilityRef intern 成 `(combatantIndex, providerIndex, abilityIndex)`。

普攻是带 `ability/basic_attack` type 或 tag 的 active ability。driver 只引用 abilityRef，不内置普攻规则。

`sharedProviders` 与 `combatants[].providers[]` 的关系：

1. `sharedProviders[]` 保存 provider definition，使用 `providerKey` 唯一标识定义。
2. `combatants[].providers[]` 保存挂载引用，不完整拷贝 definition。
3. 挂载引用至少包含 `providerRef` 和 `definitionRef`。
4. persistent provider 的 `providerRef` 通常等于 `definitionRef`，例如 `champion:source_demo`。
5. dynamic provider 的 runtime instance ref 会追加 `#instanceId`，但 snapshot 仍用 `definitionRef` 找回定义。
6. compile 必须校验每个 `definitionRef` 都能在 `sharedProviders[]` 或 combatant inline provider definition 中找到。
7. P0 优先使用 `sharedProviders[] + combatant mount`；inline provider definition 可以作为后续便利能力，但不得让两个来源生成不同语义。

### 5.4 字段命名与 JSON 规则

为了降低实现者误用旧 DTO 的风险，canonical JSON 字段遵守以下规则：

| 区域 | 必须使用 | 禁止使用 |
| --- | --- | --- |
| 能力实体 | `ability`、`abilityKey`、`abilityRef` | `skill`、`actionTemplate`、裸 `actionId` |
| 能力来源 | `provider`、`providerRef`、`providerKey` | `itemTemplate`、`skill_mount` |
| 战斗对象 | `combatant`、`source`、`target` | `actorTemplate` 作为新契约名 |
| 类型 | `typeKey`、`types[]`、`tags[]` | 运行时 DB type id |
| 运行态 | `initialSnapshot`、`finalSnapshot` | step-loop 中间状态作为 ABI contract |
| 输出 | `summary`、`series[]`、`evidence` | 从 log 二次拼主时间线 |

字段约束：

1. JSON 字段名使用 lowerCamelCase。
2. 所有 ref 字段都使用稳定字符串 key，在 compile 阶段 intern 成短 ID。
3. runtime 热路径不得保存用于查找的原始字符串；字符串只保留在 error/evidence/display metadata。
4. P0 不接受任意 map 作为规则容器；可扩展字段必须有 schema、默认值和 compile 校验。
5. `displayName`、`description`、`icon` 等展示字段可以保留在 metadata，但 runtime 不依赖它们做机制判断。
6. `params` 可以是命名 numeric 参数集合，但每个可用于公式的参数必须在 compile 阶段确定 type。
7. `types[]` 与 `tags[]` 必须是 canonical `domain/name` 字符串，不能混用本地化名称。
8. 不允许在 Wasm compile/run 中读取数据库 ID 后再推断 canonical 语义。

### 5.5 P0 最小 DTO 字段表

`CompileRequest` 最小字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `schemaVersion` | string | 是 | canonical schema 版本。 |
| `schemaHash` | string | 是 | schema hash，用于错配检测。 |
| `rulesHash` | string | 是 | 规则与对象定义 hash。 |
| `typeCatalog` | object | 是 | canonical type key 与 domain 校验来源。 |
| `combatants` | array[2] | 是 | P0 固定两个主要 combatant 定义。 |
| `sharedProviders` | array | 否 | 可复用 provider 定义；没有时为空数组。 |
| `rules` | object | 是 | 全局 operation/modifier/listener/trigger 规则容器；没有规则时内部数组为空。 |
| `formulas` | array | 否 | 命名公式定义；没有时为空数组。 |
| `settings` | object | 否 | compile 期设置，缺省走引擎默认值。 |

`RunRequest` 最小字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | compile 返回的 opaque id。 |
| `expectedRulesHash` | string | 是 | 必须与 session rulesHash 匹配。 |
| `initialSnapshot` | object | 是 | 本次 run 的初始可变状态。 |
| `driverPlan` | object | 是 | 显式 ability attempt 调度计划。 |
| `stopPolicy` | object | 是 | 至少包含 `durationMs`。 |
| `sampling` | object | 否 | 缺省时使用 P0 默认采样策略。 |
| `safetyBudget` | object | 否 | 缺省时使用 P0 默认预算。 |
| `runtimeOptions` | object | 否 | 只能放确定性 runtime 选项。 |

`DriverPlan` 最小字段：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `entries` | array | 是 | 无 | 显式 driver entry 列表。 |
| `conditionRecheckIntervalMs` | number | 否 | `100` | condition=false 且无法推导 ready time 时的重查间隔。 |

`DriverEntry` 最小字段：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `entryKey` | string | 是 | 无 | driver entry 稳定 key，用于 evidence/ref。 |
| `abilityRef` | string | 是 | 无 | `combatant.provider[providerRef].ability[abilityKey]`。 |
| `source` | selector | 是 | `source` | P0 只能是 `self/opponent/source/target`。 |
| `target` | selector | 是 | `target` | P0 只能是 `self/opponent/source/target`。 |
| `priority` | number | 否 | `0` | 同 category 内排序。 |
| `firstAtMs` | number | 是 | 无 | 首次尝试逻辑时间。 |
| `repeat` | object | 否 | null | 固定 interval 重复策略。 |
| `whileReady` | bool/object | 否 | false | gate 失败后按 ready-time 重新入队。 |
| `condition` | bool formula | 否 | true | 受限 bool 子集。 |

`repeat` 字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `intervalMs` | number | 是 | 固定重复间隔，必须大于 0。 |
| `maxAttempts` | number | 否 | 可选上限；缺失时由 stop policy / budget 限制。 |

Driver 枚举字段不得使用开放字符串扩展。新增 selector、repeat mode 或 condition 读取路径必须先更新本文档。

`ProviderDefinition` 最小字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `providerKey` | string | 是 | 定义内稳定 key。 |
| `kind` | enum | 是 | `champion/item/rune/talent/status/system`。 |
| `stableId` | string | 是 | providerRef 的稳定 id 部分。 |
| `types` | string[] | 否 | canonical type keys。 |
| `tags` | string[] | 否 | canonical tag keys。 |
| `abilities` | array | 否 | provider 提供的 ability。 |
| `modifiers` | array | 否 | provider 提供的 modifier。 |
| `listeners` | array | 否 | provider 提供的 listener。 |
| `lifecycle` | object | 否 | dynamic provider 生命周期。 |
| `initialStateSchema` | object | 否 | provider state schema。 |

`CombatantProviderMount` 最小字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `providerRef` | string | 是 | 本 combatant 上的 provider 引用。 |
| `definitionRef` | string | 是 | 指向 `sharedProviders[].providerKey`。 |
| `initialState` | object | 否 | provider runtime state 初始值。 |
| `initialAbilityState` | object | 否 | provider 下 ability state 初始值。 |

`AbilityDefinition` 最小字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `abilityKey` | string | 是 | provider 内 local key。 |
| `kind` | enum | 是 | `active/passive_listener/aura_modifier/tick/stateful`。 |
| `types` | string[] | 否 | 例如 `ability/basic_attack`。 |
| `tags` | string[] | 否 | 轻量分类标签。 |
| `params` | object | 否 | numeric 参数。 |
| `cost` | object | 否 | lifecycle cost。 |
| `cooldown` | object | 否 | lifecycle cooldown。 |
| `operations` | array | 否 | ability 成功执行后的 operations。 |
| `listenerSpec` | object | 否 | listener ability 的监听条件。 |
| `tickSpec` | object | 否 | tick ability 的 tick 行为。 |
| `stateSchema` | object | 否 | ability state schema。 |

`listenerSpec` 与 `ListenerDefinition` 的关系：

1. `AbilityDefinition.kind=passive_listener` 时，`listenerSpec` 使用 `ListenerDefinition` 的 inline 子集。
2. inline `listenerSpec` 至少包含 `eventMatcher`，可选 `maxTriggersPerEvent` 和 `chainLimitKey`。
3. inline listener 的执行目标就是当前 ability，不再填写 `abilityRef`。
4. provider 级 `listeners[]` 使用完整 `ListenerDefinition`，可以引用其它 abilityRef 或直接定义 operations。
5. 两种写法 compile 后都进入同一个 listener index，不允许实现两套 runtime 分发。

### 5.6 Operation / Modifier / Listener 最小字段表

`TypeCatalog` 最小字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `types` | array | 是 | canonical type key 列表。 |
| `relations` | array | 是 | type relation；没有时为空数组。 |

`TypeCatalog.types[]` 字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `key` | string | 是 | `domain/name`。 |
| `domain` | string | 是 | `ability/status/provider/event/damage/...`。 |
| `group` | string | 否 | 顶层 UI 分组；不得进入 runtime matcher。 |

`OperationDefinition` 最小字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `operation` | enum | 是 | P0 必做 operation 名。 |
| `target` | selector/path | 是 | P0 selector 或具体 state path。 |
| `amount` | formula | 视 operation | 数值公式。 |
| `valuePolicy` | enum | 否 | 缺省由 operation 决定，例如 damage 缺省 add HP delta。 |
| `types` | string[] | 否 | operation 产生事件或 command 的 type keys。 |
| `tags` | string[] | 否 | operation 轻量标签。 |
| `ref` | string | 否 | evidence/debug ref；缺省由 owning ability + index 生成。 |

P0 operation 字段要求：

| operation | 必填字段 | 说明 |
| --- | --- | --- |
| `damage` | `target`、`amount`、`damageType` | `damageType` 必须是 `damage/*` type key。 |
| `heal` | `target`、`amount` | 输出 overheal 统计但不超 max HP。 |
| `shield` | `target`、`amount`、`shieldRef` | 创建 ShieldInstance。 |
| `resource_change` | `target`、`resourceKey`、`valuePolicy`、`amount` | 普通 ability cost 不写这里。 |
| `attribute_change` | `target`、`attributeKey`、`valuePolicy`、`amount` | 运行态属性变化。 |
| `cooldown_change` | `abilityRef`、`valuePolicy`、`amount` | reduce/reset/refund/extend 等。 |
| `apply_provider` | `target`、`providerDefinitionRef` | 创建 dynamic provider instance。 |
| `refresh_provider` | `target`、`providerRef` | 刷新、叠层或延长。 |
| `expire_provider` | `target`、`providerRef` | scheduler 或 operation 触发过期。 |
| `emit_event` | `eventType`、`payload` | 只发事件，不直接改 state。 |

`ModifierDefinition` 最小字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `modifierKey` | string | 是 | provider/ability 内 local key。 |
| `kind` | enum | 是 | `attribute` 或 `pipeline`。 |
| `target` | path | 视 kind | attribute modifier 必填，指向属性 path。 |
| `command` | enum | 视 kind | pipeline modifier 必填，指向当前 command kind。 |
| `channel` | string | 否 | pipeline modifier 可限定 damage/resource 等 channel。 |
| `bucket` | string | 视 kind | attribute modifier 必填。 |
| `stage` | string | 视 kind | pipeline modifier 必填。 |
| `priority` | number | 否 | 同 stage 内排序，缺省 0。 |
| `valuePolicy` | enum | 是 | add/multiply/percent_add/min/max/clamp 等。 |
| `value` | formula | 是 | modifier 数值。 |
| `condition` | bool formula | 否 | 仅 pipeline modifier P0 支持。 |

`ListenerDefinition` 最小字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `listenerKey` | string | 是 | local key。 |
| `eventMatcher` | object | 是 | event type/tag matcher。 |
| `abilityRef` | string | 否 | 触发已有 ability。 |
| `operations` | array | 否 | 或直接触发 operation frame。 |
| `maxTriggersPerEvent` | number | 否 | 缺省 1，避免局部爆炸。 |
| `chainLimitKey` | string | 否 | 有界循环校验辅助 key。 |

`AbilityCost` 最小字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `resourceKey` | string | 是 | 资源 key。 |
| `amount` | formula | 是 | 消耗公式。 |
| `allowPartial` | bool | 否 | P0 缺省 false。 |

`AbilityCooldown` 最小字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `durationMs` | formula | 是 | 基础 CD。 |
| `startsOn` | enum | 否 | P0 固定 `cast_accepted`。 |
| `groupKey` | string | 否 | 共享 CD 预留；P0 可不完整实现。 |

`ProviderLifecycle` 最小字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `durationMs` | formula | 否 | dynamic provider 持续时间。 |
| `maxStacks` | number | 否 | 缺省 1。 |
| `refreshPolicy` | enum | 否 | `replace/extend/add_stack`。 |
| `tickIntervalMs` | number | 否 | fixed interval tick provider 使用。 |

`TickSpec` 最小字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `intervalMs` | number | 是 | P0 固定 tick 间隔。 |
| `onTick` | array | 是 | tick 时执行的 operations 或 tick ability ref。 |
| `startDelayMs` | number | 否 | 缺省等于 `intervalMs`。 |

字段表没有列出的旧字段不得由实现者自行“兼容补上”。如果实现中确实需要新增字段，必须先更新本详细设计并说明默认值、compile 校验和 runtime 读写边界。

## 6. Snapshot 与 Runtime State

### 6.1 Snapshot 范围

`initialSnapshot` / `finalSnapshot` 只包含战斗状态：

1. combatant attribute slot values
2. resource slot values
3. cooldown states
4. active dynamic provider instances
5. shield instances
6. ability state
7. provider state
8. combatant vars

snapshot 不包含：

1. event queue
2. driver scheduler progress
3. series
4. warnings
5. evidence
6. execution frame
7. temporary pipeline context

`Snapshot` 最小字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `schemaHash` | string | 是 | 必须与 compiled session 匹配。 |
| `rulesHash` | string | 是 | 必须与 compiled session 匹配。 |
| `timeMs` | number | 是 | P0 initial snapshot 固定为 0；final snapshot 为停止时逻辑时间。 |
| `combatants` | array[2] | 是 | 两个主要 combatant 的 runtime state。 |

`CombatantSnapshot` 最小字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `key` | string | 是 | `source` 或 `target`。 |
| `attributes` | object | 是 | attr key -> `AttributeSlotSnapshot`。 |
| `resources` | object | 是 | resource key -> `ResourceSlotSnapshot`。 |
| `cooldowns` | object | 是 | abilityRef -> `CooldownSnapshot`。 |
| `providers` | array | 是 | active provider instances。 |
| `shields` | array | 是 | active shield instances。 |
| `abilityState` | object | 是 | abilityRef -> typed state object。 |
| `providerState` | object | 是 | providerRef -> typed state object。 |
| `vars` | object | 是 | combatant var typed values。 |

`CombatantSnapshot.providers[]` 最小字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `providerRef` | string | 是 | runtime provider instance ref。 |
| `definitionRef` | string | 是 | 指向 compiled provider definition。 |
| `source` | selector/ref | 否 | 来源；initial mount 可省略，由 owner/source 推导。 |
| `owner` | selector/ref | 否 | 持有者；initial mount 可省略，由 combatant key 推导。 |
| `stacks` | number | 是 | 当前层数。 |
| `expireAt` | number/null | 是 | 过期逻辑时间；persistent provider 为 null。 |
| `state` | object | 是 | typed provider state。 |

`AttributeSlotSnapshot` 最小字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `base` | number | 是 | base view。 |
| `current` | number | 是 | current view。 |
| `max` | number | 是 | max view。 |
| `resolved` | number | 是 | resolver 输出 view。 |

`ResourceSlotSnapshot` 最小字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `current` | number | 是 | 当前资源。 |
| `max` | number | 是 | 最大资源。 |

`CooldownSnapshot` 最小字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `readyAtMs` | number | 是 | 下一次可用逻辑时间。 |
| `remainingMs` | number | 是 | 相对当前 snapshot time 的剩余时间。 |

Snapshot 规则：

1. `initialSnapshot` 可以省略空对象内部字段的明细，但落入 runtime 前必须 materialize 成上述完整结构。
2. `finalSnapshot` 必须输出完整结构，不能只输出 HP。
3. provider instance 与 shield instance 字段使用本文 `§15` 的定义。
4. snapshot 中的 definition ref 必须回指 compiled session 中的只读定义，不复制完整 ability/modifier/rule。

### 6.2 Runtime State 归属

1. `ability.state.*` 只归属当前 ability。
2. `provider.state.*` 只归属 provider。
3. `source.var.*` / `target.var.*` 是 combatant 级临时变量。
4. 能放到 ability 的状态不放 provider。
5. 能放到 provider 的状态不放 combatant var。
6. 跨对象影响必须通过 operation 表达。

### 6.3 Slot 类型

实现包职责：

1. `internal/attribute`：`AttributeSlot`，处理 `base/current/max/resolved`、modifier、dirty/resolve。
2. `internal/resource`：`ResourceSlot`，处理 `current/max`、spend、refund、clamp。
3. `internal/runtime` 或独立 value 模块：`ValueSlot`，处理 provider state、ability state、combatant var 和计数器。

## 7. Compile 层实现

`internal/compile` 的输出是只读 compiled session。建议拆成以下阶段：

1. envelope parse：JSON、frame kind、schema version、顶层 required 字段。
2. symbol intern：providerRef、abilityRef、typeKey、formula key、operation ref。
3. type compile：canonical type key 编译为短 ID，校验 domain。
4. definition compile：combatant、provider、ability、modifier、listener、operation 编译为只读表。
5. formula compile：DSL 编译为 bytecode 或等价只读表达式。
6. reference validation：校验 abilityRef、providerRef、formulaRef、operation target。
7. rule validation：禁止 HP raw set，校验 type relation 深度/环、matcher domain、formula type。
8. trigger graph validation：无界循环报 error，有界循环报 warning。
9. session publish：没有 error 时生成 compiled session 并登记到 session registry。

compile errors 统一结构：

```text
EngineError
  ok=false
  phase
  code
  message
  path
  ref
  severity
  recoverable
  details
  schemaHash
  rulesHash
  sessionId?
```

P0 error code：

```text
json_parse_error
schema_version_unsupported
missing_required_field
unknown_ref
unknown_type_key
matcher_domain_error
formula_type_error
operation_target_missing
trigger_cycle_unbounded
hp_raw_set_forbidden
session_not_found
hash_mismatch
runtime_invariant_failed
```

`EngineError` 字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `ok` | bool | 是 | 固定为 `false`。 |
| `phase` | enum | 是 | `parse/compile/run/abi/host`。 |
| `code` | enum | 是 | 只能使用本文列出的核心 error code，新增需先改文档。 |
| `message` | string | 是 | 面向开发和用户摘要的短信息。 |
| `path` | string | 否 | JSON path 或 runtime state path。 |
| `ref` | string | 否 | providerRef、abilityRef、event ref 等。 |
| `severity` | enum | 是 | `error/fatal`；compile warning 不走此结构。 |
| `recoverable` | bool | 是 | 调用方是否可通过重试或重编译恢复。 |
| `details` | object | 否 | 结构化上下文，不放大段日志。 |
| `schemaHash` | string | 否 | 已知时必须回填。 |
| `rulesHash` | string | 否 | 已知时必须回填。 |
| `sessionId` | string | 否 | 已进入或引用 session 时回填。 |
| `evidence` | object | 否 | run fatal error 可附带 `EvidenceCollection`。 |

`phase` 规则：

1. JSON 解析失败使用 `parse`。
2. schema、引用、公式、type、operation 校验失败使用 `compile`。
3. session missing、hash mismatch、runtime invariant、非有限数使用 `run`。
4. frame header、outbox、内存拷贝错误使用 `abi`。
5. Worker 30 秒墙钟超时是 `host`，不参与战斗数值语义。

`recoverable` 规则：

1. `session_not_found` 通常 recoverable，可重新 compile。
2. `hash_mismatch` 通常 recoverable，可重新 materialize/compile。
3. `formula_type_error`、`unknown_ref`、`hp_raw_set_forbidden` 需要修 payload，不靠同输入重试恢复。
4. `runtime_invariant_failed` 对同输入不可恢复，必须修规则或实现。

### 7.1 新旧错误码兼容策略

当前代码仍保留旧 `ErrCode`（例如 `E_BAD_MAGIC`）给 legacy 路径。generic ABI 对外 JSON 只输出 `EngineError.code`：

1. generic ABI 的 JSON payload 只输出 `EngineError.code`，不直接输出旧 `ErrCode`。
2. 旧 ABI wrapper 可继续输出旧 `ErrCode`，但必须由新错误映射而来或保留旧路径，不反向污染新 DTO。
3. `EngineError.details.compatErrCode` 可选记录旧错误码，便于旧 smoke 调试。
4. 新 compile collect-all errors 不映射成单个旧 `ErrCode`；旧 wrapper 若必须返回单码，使用最严重错误的 compat 映射，并在 details 中保留完整 errors。
5. 新代码中不得新增 `E_*` 作为 canonical error code。

兼容映射建议：

| 旧 ErrCode | 新 EngineError.code |
| --- | --- |
| `E_BAD_MAGIC` | `json_parse_error` 或 ABI frame error。 |
| `E_SCHEMA_MISMATCH` | `schema_version_unsupported` 或 `hash_mismatch`。 |
| `E_UNKNOWN_ATTR` | `unknown_ref`。 |
| `E_UNKNOWN_FORMULA` | `unknown_ref` 或 `formula_type_error`。 |
| `E_UNKNOWN_ACTOR` | `unknown_ref`。 |
| `E_UNKNOWN_ACTION` | `unknown_ref`。 |
| `E_UNKNOWN_STATUS` | `unknown_ref`。 |
| `E_UNKNOWN_RESOURCE` | `unknown_ref`。 |
| `E_RULE_CONFLICT` | `trigger_cycle_unbounded` 或 `runtime_invariant_failed`，按上下文。 |
| `E_NUMERIC` | `runtime_invariant_failed`。 |
| `E_INVALID_INPUT` | `missing_required_field`、`unknown_ref` 或 `formula_type_error`。 |
| `E_NOT_READY` | `session_not_found`。 |

## 8. Type 与 Matcher

type key 统一使用 `domain/name`：

```text
ability/basic_attack
ability/dash
status/stun
provider/item
event/damage_dealt
damage/physical
```

实现要求：

1. Wasm 内部使用 flat registry 与 bitset matcher。
2. 不做父子 type 闭包展开。
3. 实体实际拥有的 type 必须在 canonical payload 显式列出。
4. 顶层 type 只服务 UI 分组，不应进入 matcher。
5. 一个具体 type 只能属于一个顶层分组。
6. compile 必须校验 type relation 深度和环。
7. matcher 必须限制允许 domain，例如 ability matcher 不能填 status domain。

`reservedType` 只作为前端、发布层和 Wasm 共享常量来源；Wasm matcher 不运行时查数据库理解 reserved type。

## 9. Formula DSL

P0 numeric runtime 必须支持：

```text
const
read
ref
add
sub
mul
div
min
max
clamp
round
floor
ceil
trunc
```

P0 runtime 读路径：

```text
source.attr.*
target.attr.*
source.resource.*
target.resource.*
ability.param.*
```

内部数值统一用 `float64`。公式和 operation 不隐式保留两位小数；展示层默认两位小数只能作用于 summary/chart display，不得截断 snapshot 或内部状态。

除零、NaN、Inf 等非有限数必须终止当前 run，返回 runtime fatal error 和 evidence，不能静默转 0 或自动 clamp。

受限 bool 子集只用于 driver condition 和 pipeline modifier condition。P0 不把完整 `history.*`、`event.*`、`ability.state.*`、`provider.state.*` 放入普通公式 runtime 闭环。

### 9.0 P0 Bool Formula 子集

P0 bool formula 只用于 driver condition 和 pipeline modifier condition。

允许节点：

```text
compare: eq/ne/lt/lte/gt/gte
logic: and/or/not
type matcher: hasType/hasTag
numeric leaf: P0 numeric formula
literal leaf: const bool/number/string
```

允许读取路径：

| 使用场景 | 允许路径 |
| --- | --- |
| driver condition | `source.attr.*`、`target.attr.*`、`source.resource.*`、`target.resource.*`、`ability.param.*`、cooldown/resource gate 派生路径。 |
| pipeline modifier condition | driver condition 的路径，加上当前 command/event payload 基础字段，如 `event.damage.types`、`event.damage.amount`、`event.source`、`event.target`。 |

禁止读取路径：

1. `history.*`
2. `ability.state.*`
3. `provider.state.*`
4. 任意跨对象私有 state
5. 未经本文档定义的 `event.*` 字段

bool compile 规则：

1. 不允许嵌套任意 `if`。
2. 不允许脚本表达式。
3. `hasType` / `hasTag` 的 `typeKey` 必须通过 type registry 校验 domain。
4. driver condition 使用 `event.*` 必须 compile error。
5. pipeline modifier condition 使用 `history.*` 必须 compile error。

### 9.1 Formula 正反例

合法 numeric formula：

```json
{
  "op": "add",
  "args": [
    { "op": "read", "path": "source.attr.attack_damage.resolved" },
    { "op": "read", "path": "ability.param.baseDamage" }
  ]
}
```

合法显式取整：

```json
{
  "op": "round",
  "decimals": 2,
  "value": { "op": "div", "args": [
    { "op": "read", "path": "source.attr.attack_speed.resolved" },
    { "op": "const", "value": 3 }
  ] }
}
```

非法：隐式展示取整进入规则语义。

```json
{
  "op": "displayRound",
  "path": "source.attr.attack_damage.resolved"
}
```

原因：展示层两位小数不能影响 runtime 计算。需要取整必须使用显式 `round/floor/ceil/trunc`。

非法：P0 普通公式读取 history。

```json
{
  "op": "read",
  "path": "history.damage_dealt.sum.3000ms"
}
```

原因：history/window 是目标能力，不进入 P0 runtime 闭环。

非法：P0 普通公式读取 provider state。

```json
{
  "op": "read",
  "path": "source.provider[item:example].state.stacks"
}
```

原因：provider/ability state 读取先作为 schema/compile 预留，除非后续 slice 明确实现并更新本文档。

## 10. Driver Plan

driver plan 顶层：

```text
DriverPlan
  entries[]
  conditionRecheckIntervalMs
```

entry：

```text
DriverEntry
  entryKey
  abilityRef
  source
  target
  priority
  firstAtMs
  repeat
  whileReady
  condition
```

规则：

1. `conditionRecheckIntervalMs` 默认 `100ms`，允许范围 `10ms..1000ms`。
2. repeat entry 按固定 interval 继续排下一次。
3. while-ready entry 根据最早可能 ready 时间重新 enqueue。
4. cooldown 未好取 cooldown ready time。
5. resource 不足且存在已知 regen 时估算 resource ready time。
6. condition=false 且无法推导变化时间时使用 `conditionRecheckIntervalMs`。
7. gate 失败不停止该 driver entry，也不能同一 timeMs 忙循环重试。

attempt skipped 必须写 evidence，原因至少覆盖：

```text
cooldown_not_ready
resource_insufficient
condition_false
target_unavailable
```

### 10.1 Driver Plan 正反例

合法 repeat 普攻 plan：

```json
{
  "conditionRecheckIntervalMs": 100,
  "entries": [
    {
      "entryKey": "source_basic_attack",
      "abilityRef": "source.provider[champion:ashe].ability[basic_attack]",
      "source": "source",
      "target": "target",
      "priority": 0,
      "firstAtMs": 0,
      "repeat": { "intervalMs": 1000 }
    }
  ]
}
```

合法 while-ready 条件：

```json
{
  "entryKey": "source_q_while_ready",
  "abilityRef": "source.provider[champion:ahri].ability[Q]",
  "source": "source",
  "target": "target",
  "firstAtMs": 0,
  "whileReady": true,
  "condition": {
    "op": "gt",
    "left": { "op": "read", "path": "source.resource.mana.current" },
    "right": { "op": "read", "path": "ability.param.minManaToCast" }
  }
}
```

非法：driver 隐式扫描所有 active ability。

```json
{
  "mode": "auto_cast_all_active"
}
```

原因：P0 driver plan 必须显式列出 abilityRef。

非法：condition 读取 event payload。

```json
{
  "op": "gt",
  "left": { "op": "read", "path": "event.damage.final" },
  "right": { "op": "const", "value": 100 }
}
```

原因：driver condition 发生在 attempt gate 前，P0 只允许读取 source/target attr/resource、ability.param 和 gate 相关数据。

while-ready 调度例子：

1. `timeMs=0` 尝试 Q，cooldown ready time 是 `3000`，resource 足够，condition true。
2. gate 失败原因是 cooldown，因此下一次 enqueue 到 `3000`。
3. 如果 cooldown ready 但 mana 不足且已知 mana regen 预计 `4200` 才足够，则 enqueue 到 `4200`。
4. 如果 condition=false 且无法推导变化时间，则 enqueue 到 `timeMs + conditionRecheckIntervalMs`。
5. 任何情况下都不能在同一 `timeMs` 立即循环重试。

## 11. Event Queue

事件字段：

```text
RuntimeEvent
  timeMs
  category
  priority
  seq
  source
  target
  ref
  payload
```

同一 `timeMs` 的 category 顺序固定：

```text
expire_cleanup
provider_tick
ability_attempt
triggered_continuation
sample
```

实现要求：

1. scheduler 按 `timeMs + categoryOrder + priority + seq` 稳定排序。
2. category order 是语义，不允许 run config 覆盖。
3. 同类内部允许 priority。
4. 过期与 tick 同时发生时，先清理过期 provider，再决定 tick 是否有效。
5. sample 默认在同一 timeMs 最后执行。

对外 event taxonomy 首期固定：

```text
ability_cast
ability_hit
provider_tick
damage_dealt
damage_taken
heal_applied
shield_applied
status_applied
status_expired
resource_changed
cooldown_changed
```

pipeline stage 名称不作为对外 event taxonomy。

## 12. Ability Execution Frame

attempt 成功后的 execution frame：

```text
ExecutionFrame
  frameId
  parentEventRef
  source
  target
  abilityRef
  stagedMutations
  emittedEvents
  localEvidence
```

执行顺序：

1. gate 通过。
2. 创建 frame。
3. staged lifecycle cost。
4. staged cooldown start。
5. 执行 ability operations。
6. 检查非有限数、非法 target、预算等 fatal 条件。
7. frame 原子提交。
8. 提交后 enqueue listener/子 ability 事件。

同一 frame 内，cost/CD mutation 对后续 ability operations 可见。frame fatal error 时不得把半提交状态写入 runtime state 或 final snapshot。

父 frame 提交后，子 listener/ability 使用独立 frame。子 frame fatal error 可以终止 run，但不能回滚父 frame。

## 13. Operation Pipeline

P0 runtime 必须闭环：

```text
damage
heal
shield
resource_change
attribute_change
cooldown_change
apply_provider
refresh_provider
expire_provider
emit_event
```

P0 schema/compile 预留：

```text
ability_state_change
provider_state_change
combatant_var_change
pipeline_guard
execute_threshold
interrupt
control
```

value policy：

```text
set
keep
add
multiply
percent_add
min
max
clamp
refund
spend
reduce
reset
extend
```

HP 规则：

1. 不提供 raw set HP。
2. HP 变化只允许经 damage、heal、shield 或 pipeline guard 约束后的语义命令进入。
3. `pipeline_guard` 首期只需要 schema/compile 表达与校验；runtime 完整行为可作为后段。
4. `execute_threshold` 发生在普通伤害、抗性、pipeline modifier 和 HP mutation 后，不作为额外伤害。

普通 ability 的基础 cost 与 cooldown 由 lifecycle 表达，不要求规则作者重复写 operation。复杂退款、重置、额外资源变化和减 CD 再使用 operation。

## 14. Modifier 与 Resolver

P0 modifier：

```text
AttributeModifier
PipelineModifier
```

AttributeModifier：

1. 只作用于属性 resolver。
2. P0 无条件，挂载即生效。
3. 条件属性变化用 temporary provider 的 apply/expire 生命周期表达。

PipelineModifier：

1. 只修改当前 command 的数值、标签或结算标记。
2. 不允许产生额外 command。
3. 额外伤害、治疗、资源变化必须通过 listener 或 ability operation 表达。
4. condition 使用受限 bool 子集。

bucket/乘区：

1. 是 resolver policy，不是 slot storage。
2. 按 domain/channel 定义。
3. stage/phase 顺序显式固定。
4. 同一 stage 内按 priority + stable order。

damage pipeline 预留 crit context：

```text
CritContext
  policy
  expectedFraction
  isActualCrit
  critMultiplier
  seedRef?
```

`critOnly` modifier 必须消费明确 crit context。缺少 crit context 时不能把整个 damage command 近似乘上同一个系数。

### 14.1 Modifier 正反例

合法 attribute modifier：

```json
{
  "kind": "attribute",
  "target": "source.attr.attack_damage",
  "bucket": "stat/additive",
  "value": { "op": "const", "value": 25 }
}
```

合法 pipeline modifier：

```json
{
  "kind": "pipeline",
  "command": "damage",
  "channel": "damage/physical",
  "stage": "postArmor",
  "valuePolicy": "multiply",
  "value": { "op": "const", "value": 0.9 },
  "condition": {
    "op": "hasType",
    "path": "event.damage.types",
    "typeKey": "damage/crit"
  }
}
```

非法：pipeline modifier 产生额外 damage command。

```json
{
  "kind": "pipeline",
  "command": "damage",
  "extraCommands": [
    { "operation": "damage", "amount": 30 }
  ]
}
```

原因：P0 pipeline modifier 只能修改当前 command；额外伤害必须通过 listener 或 ability operation 表达。

非法：`critOnly` 在缺少 crit context 时修改整段伤害。

```json
{
  "kind": "pipeline",
  "command": "damage",
  "critOnly": true,
  "valuePolicy": "multiply",
  "value": { "op": "const", "value": 0.7 }
}
```

原因：`critOnly` 必须消费明确 `CritContext`。如果 damage command 没有 crit context，compile 应拒绝或 runtime 应产生 fatal/config error，不能近似作用于全部 damage。

非法：conditional attribute modifier。

```json
{
  "kind": "attribute",
  "target": "source.attr.attack_damage",
  "condition": {
    "op": "gt",
    "left": { "op": "read", "path": "source.attr.hp.current" },
    "right": { "op": "const", "value": 100 }
  },
  "value": { "op": "const", "value": 10 }
}
```

原因：P0 attribute modifier 无条件；条件属性变化应通过 apply/expire temporary provider 表达。

## 15. Dynamic Provider 与 Shield

dynamic provider instance：

```text
ProviderInstance
  providerRef
  definitionRef
  source
  owner
  stacks
  expireAt
  state
```

`ProviderInstance` 最小字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `providerRef` | string | 是 | runtime provider instance ref。 |
| `definitionRef` | string | 是 | 指向 compiled session 中的 provider definition。 |
| `source` | selector/ref | 是 | 来源 combatant 或 source ref。 |
| `owner` | selector/ref | 是 | 持有该 provider 的 combatant。 |
| `stacks` | number | 是 | 当前层数。 |
| `expireAt` | number/null | 是 | 过期逻辑时间；永不过期用 null。 |
| `state` | object | 是 | typed provider state。 |

生命周期：

1. 创建、刷新、叠层、到期、清理全部走 operation pipeline。
2. 到期由 scheduler 触发 expire operation。
3. 清理统一移除 modifiers、listeners、provided abilities 和 runtime state。
4. status tick、effect 或 listener 不允许私下删除 provider。

fixed interval tick provider：

1. provider 声明 `tickIntervalMs`。
2. runtime enqueue `provider_tick`。
3. 每次 tick 使用独立 instant ability/operation frame。
4. 过期或移除后不再 tick。
5. tick 与 expire 同一 timeMs 时，expire 先执行。

shield instance：

```text
ShieldInstance
  shieldRef
  source
  owner
  remaining
  priority
  expireAt
  state
```

shield 是专用 runtime object，负责吸收规则、剩余值、优先级、过期和 evidence。如果护盾存在期间还提供能力、监听或属性，应额外创建 temporary provider 表达附带效果。

## 16. Output、Warning 与 Evidence

`DoneResult` 字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `ok` | bool | 是 | 固定为 `true`。 |
| `summary` | object | 是 | 图表和对比视图的稳定行数据。 |
| `finalSnapshot` | object | 是 | 本次 run 结束后的战斗状态。 |
| `series` | array | 是 | chart-ready time series，可为空但字段必须存在。 |
| `warnings` | array | 是 | 面向用户的结构化摘要提示。 |
| `evidence` | object | 是 | `EvidenceCollection`，机器可追踪事实明细与截断摘要。 |
| `seriesSamplingEvidence` | object | 是 | 采样间隔、降采样与最终点数说明。 |

summary 最小字段：

```text
durationMs
stopReason
sourceFinalHp
targetFinalHp
sourceDamageDealt
sourceDamageTaken
targetDamageDealt
targetDamageTaken
abilityAttemptCount
abilityCastCount
attemptSkippedCount
warningCount
evidenceTruncated
seriesDownsampled
abilityStats[]
```

`summary` 字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `durationMs` | number | 是 | 实际模拟到的逻辑时长。 |
| `stopReason` | enum | 是 | 固定枚举，不允许开放字符串。 |
| `sourceFinalHp` | number | 是 | source 最终 HP。 |
| `targetFinalHp` | number | 是 | target 最终 HP。 |
| `sourceDamageDealt` | number | 是 | source 造成累计伤害。 |
| `sourceDamageTaken` | number | 是 | source 承受累计伤害。 |
| `targetDamageDealt` | number | 是 | target 造成累计伤害。 |
| `targetDamageTaken` | number | 是 | target 承受累计伤害。 |
| `abilityAttemptCount` | number | 是 | 全局 attempt 总数。 |
| `abilityCastCount` | number | 是 | 全局 cast 成功总数。 |
| `attemptSkippedCount` | number | 是 | 全局 gate skip 总数。 |
| `warningCount` | number | 是 | warnings 展示计数。 |
| `evidenceTruncated` | bool | 是 | evidence 是否被限量截断。 |
| `seriesDownsampled` | bool | 是 | series 是否被降采样。 |
| `abilityStats` | array | 是 | 按 abilityRef 分组的 attempt/cast/skip。 |

`abilityStats[]` 字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `abilityRef` | string | 是 | canonical abilityRef。 |
| `attemptCount` | number | 是 | attempt 次数。 |
| `castCount` | number | 是 | gate 通过并进入 execution frame 次数。 |
| `skipCount` | number | 是 | gate 失败次数。 |
| `damageDealt` | number | 否 | 如果该 ability 产生伤害则输出。 |
| `healingDone` | number | 否 | 如果该 ability 产生治疗则输出。 |

stopReason：

```text
duration_reached
target_dead
source_dead
both_dead
no_events
budget_exceeded
```

同时满足多个 stop 条件时，主因优先级：

```text
budget_exceeded > both_dead > source_dead/target_dead > duration_reached > no_events
```

series 点：

```text
SeriesPoint
  timeMs
  sourceHp
  targetHp
  sourceDamageDealt
  targetDamageDealt
  sourceCumulativeDps
  targetCumulativeDps
  sourceWindowDps
  targetWindowDps
```

`SeriesPoint` 字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `timeMs` | number | 是 | 采样逻辑时间。 |
| `sourceHp` | number | 是 | source 当前 HP。 |
| `targetHp` | number | 是 | target 当前 HP。 |
| `sourceDamageDealt` | number | 是 | source 累计伤害。 |
| `targetDamageDealt` | number | 是 | target 累计伤害。 |
| `sourceCumulativeDps` | number | 是 | source 累计 DPS。 |
| `targetCumulativeDps` | number | 是 | target 累计 DPS。 |
| `sourceWindowDps` | number | 是 | source 窗口 DPS。 |
| `targetWindowDps` | number | 是 | target 窗口 DPS。 |

`timeMs < dpsWindowMs` 时，window DPS 使用实际可用窗口 `[0, timeMs]`。`timeMs=0` 时按 0 或空值处理，避免除零。

evidence item：

```text
EvidenceItem
  timeMs
  kind
  ref
  path
  message
  data
```

`EvidenceCollection` 字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `items` | array | 是 | 最多 `maxEvidenceItems` 条明细。 |
| `truncated` | bool | 是 | 是否截断。 |
| `truncatedEvidenceCount` | number | 是 | 被截断条数。 |
| `countsByKind` | object | 是 | 按 kind 聚合计数。 |

P0 evidence kind：

```text
attempt_skipped
budget_exceeded
downsampled
guard_applied
hash_mismatch
session_missing
runtime_warning
```

warning item：

```text
WarningItem
  code
  message
  severity
  refs
  evidenceRefs
count
```

`seriesSamplingEvidence` 字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `requestedSampleEveryMs` | number | 是 | run input 请求的采样间隔。 |
| `effectiveSampleEveryMs` | number | 是 | 实际使用采样间隔。 |
| `requestedPointCount` | number | 是 | 未降采样理论点数。 |
| `finalPointCount` | number | 是 | 输出点数。 |
| `maxSeriesPoints` | number | 是 | 本次上限。 |
| `downsampled` | bool | 是 | 是否降采样。 |
| `method` | string | 是 | P0 固定 `uniform_time`。 |

warnings 是用户摘要，evidence 是机器可追踪事实；warning 可引用 evidence，但不重复完整明细。
