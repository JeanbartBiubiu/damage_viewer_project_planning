TASK_KEY: wasm-engine-v2-architecture
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-15

# WASM 详细设计

本文是 Wasm 通用计算引擎的**已落地**实现契约，面向后续编码 agent。需求边界见 [WASM通用计算引擎需求对齐记录.md](../../需求澄清/wasm/WASM通用计算引擎需求对齐记录.md)，系统分层见 [WASM概要设计.md](../../概要设计/wasm/WASM概要设计.md)。

当前主线是 canonical `Combatant -> Provider -> Ability`，ABI 为 `engine_compile` / `engine_run` / `engine_release_session`。旧 step-loop 与专用 DPS lane 及其 Wasm 导出已从 TinyGo V2 移除；不要再以它们作为新字段、新 ABI 或新机制扩展的命名来源。

## 1. 写入范围与非目标

默认实现落点：

```text
wasm/tinygo_engine_v2
```

主要写入包：

```text
cmd/engine_wasm
internal/abi
internal/model
internal/compile
internal/runtime
internal/scheduler
internal/formula
internal/attribute
internal/resource
internal/command
internal/pipeline
internal/trigger
internal/status
internal/shield
internal/typeset
internal/testkit
scripts
```

非目标：

1. 不恢复旧 Rust/Katarina crate。
2. 不在新通用引擎里扩展专用 DPS lane。
3. 不做多单位战场、范围目标、随机目标选择或 seeded random 序列。
4. 不做暂停、恢复、续跑或把某次 final snapshot 接到下一次 run。
5. 不做任意脚本公式，也不把数据库读取放进 Wasm。
6. 不把前端数字覆盖 patch 作为 Wasm 语义输入；Wasm 只消费覆盖后的 canonical payload。

## 1A. 旧口径误用黑名单

本节中的旧词允许在文档中作为 blacklist 或迁移说明出现，但禁止作为新通用引擎的字段名、类型名、目录名、测试 fixture 名或外部 ABI 语义来源。

| 旧口径 / 易误用词 | 禁止用法 | canonical 替代 |
| --- | --- | --- |
| `EngineBundleV2` | 作为新 compile 顶层 DTO。 | `CompileRequest` / compiled session。 |
| `ActionTemplateV2` | 作为新能力定义实体。 | `AbilityDefinition`。 |
| `Action` | 表达一类可复用能力。 | `Ability`；`action` 只可作为一次 runtime dispatch/事件概念。 |
| `Skill` / `skill` | 作为 Wasm schema 路径根。 | `ability`。 |
| `ActorTemplate` / `ActorRuntime` | 作为新 canonical 对象名。 | `CombatantDefinition` / `CombatantRuntime`。 |
| `ItemTemplate` | 作为 Wasm 能力来源实体。 | `CapabilityProvider(kind=item)`。 |
| `skill_mounts` | 作为 Wasm 输入结构。 | publish/materialize 层转换成 provider/ability。 |
| `target_category=hero` | 作为 Wasm target selector。 | `self` / `opponent` / `source` / `target`。 |
| `engine_init` / `engine_begin_run` / `engine_step` | 反向定义新 ABI 生命周期。 | `engine_compile` / `engine_run` / `engine_release_session`。 |
| `single_attacker_dps` | 新机制扩展入口。 | 通用 driver plan + ability pipeline。 |
| `target dummy` | 通用 runtime 内建对象。 | P0 双 combatant 中的 `target`。 |
| `first attack` | driver 隐式普攻假设。 | driver plan 显式 `firstAtMs`。 |
| `attack speed cap` | 通用 engine 硬编码 LoL 规则。 | 数据规则或 provider/ability 定义。 |
| `setHpRaw` / raw HP set | 快捷改 HP。 | `damage` / `heal` / `shield` / `pipeline_guard`。 |

Cursor worker 如果发现现有代码仍使用这些旧词，处理规则如下：

1. 可以在 compat wrapper、legacy fixture 或旧测试中保留旧词。
2. 新 canonical DTO、compile/run ABI、fixture 和新测试不得新增这些旧词。
3. 如果必须接旧入口，写 adapter，把旧 payload 转换为 canonical payload 后再进入新路径。
4. 不允许因为旧代码中已有某个字段，就把它复制进新 schema。
5. 如果旧词出现在新通用引擎 diff 中，报告必须说明它是 blacklist/compat 语境还是误用。

## 1B. 现有文件级落点地图

下表按**当前已实现**源码锚点定位；新机制默认写入 generic 路径。

| 路径 | 当前角色 | 写入规则 |
| --- | --- | --- |
| `cmd/engine_wasm/main.go` | Wasm export glue：`engine_compile` / `engine_run` / `engine_release_session` + memory/outbox。 | 只做 ABI/session 装配，不放业务规则。 |
| `internal/abi/frame.go` | frame header 编解码（magic/schema/kind/flags/len）。 | generic kind 使用 `200..214`，与 legacy kind 区分。 |
| `internal/abi/outbox.go` | outbox 缓冲与优先帧策略。 | `compile_result`/`done`/`error`/`release_result` 优先保留。 |
| `internal/model/generic.go` | frame kind、`CompileResult`、`EngineError`、release DTO。 | canonical ABI/错误契约落点。 |
| `internal/model/generic_compile.go` | `CompileRequest` 与 provider/ability/operation DTO。 | 新字段先落这里。 |
| `internal/model/generic_run.go` / `generic_run_output.go` | `RunRequest`、`DoneResult`、summary/series/evidence。 | run 输入输出契约。 |
| `internal/compile/generic.go` | `CompileGeneric` → `CompiledSession`。 | 只读 session；已知 schema 后 collect-all。 |
| `internal/compile/generic_validate.go` | compile collect-all 校验。 | 不写 runtime mutation。 |
| `internal/typeset/generic.go` | flat type catalog/matcher。 | 不做父子闭包 runtime 展开。 |
| `internal/formula/generic.go` / `generic_eval.go` | generic formula compile/eval。 | P0 路径白名单与非有限数 fatal。 |
| `internal/runtime/session.go` | `CompileFrame`/`RunFrame`/`ReleaseSessionFrame`、session registry、hash 校验。 | run state 不跨 run 复用。 |
| `internal/runtime/generic_run.go` | `RunGeneric` 单次 deterministic run。 | 新 runtime 主循环落点。 |
| `internal/runtime/generic_execution.go` | operation 执行。 | 数值变化经 operation/pipeline。 |
| `internal/runtime/generic_gate.go` | ability attempt gate。 | 不要分散绕过。 |
| `internal/runtime/generic_provider.go` / `generic_provider_tick.go` | provider 生命周期与 tick。 | status 表现为 dynamic provider。 |
| `internal/scheduler/generic_heap.go` | generic 稳定事件堆。 | 含 category order。 |
| `internal/pipeline/**` | attribute/damage resolver。 | modifier 不另产 command。 |
| `internal/testkit/fixtures/generic_p0_basic_damage.json` | canonical fixture。 | 复用；勿改、勿复制。 |
| `scripts/smoke-node.mjs` / `generic-abi-host.mjs` | Node generic ABI round-trip smoke。 | 非正式宿主。 |
| `scripts/bench-node.mjs` / `cmd/bench` | Node/Go generic-run benchmark。 | 结果须校验 summary 契约。 |

文件级规则：

1. 如果某个 slice 只需要新增 DTO，不要同时改 runtime。
2. 如果某个 slice 只需要 runtime，不要顺手改 Web adapter。
3. 不要重新引入已删除的 legacy 导出或 DPS lane，除非另开显式任务并同步 Web adapter。
4. 如果必须跨表中多个区域，Cursor prompt 必须显式列出跨区原因。

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
| Go bench | `go run ./cmd/bench` 默认 generic-run；`go run ./cmd/bench legacy` 非零退出（unsupported）。 |

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

为了降低 Cursor worker 误用旧 DTO 的风险，canonical JSON 字段遵守以下规则：

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

字段表没有列出的旧字段不得由 Cursor worker 自行“兼容补上”。如果实现中确实需要新增字段，必须先更新本详细设计并说明默认值、compile 校验和 runtime 读写边界。

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

## 17. Legacy Lane 边界

历史：`internal/runtime/dps_*.go` 与 legacy step-loop 曾作为 compat/回归对照，且不得接收新机制或作为新 schema 命名来源。

当前状态：该 lane、旧 compile/formula/scheduler 专路径，以及对应 Wasm 导出已从 TinyGo V2 删除。新机制只能进入 provider、ability、listener、operation pipeline。通用 `dpsWindowMs` / windowDps / DPS series 输出指标保留。Web 页面/adapter 同步不在本模块删除任务内宣称完成。

## 18. 实施拆分

后续编码可按以下互不重叠的 slice 分配给 agent。

### Slice A: ABI 与 Session Registry

写入范围：

```text
cmd/engine_wasm
internal/abi
internal/runtime/session.go
internal/model
```

目标：

1. 增加 compile/run/release session 调用。
2. compiled session 只在 Worker/Wasm 内部持有。
3. outbox 支持 compile_result、done、error。
4. run 前校验 sessionId、expectedRulesHash、snapshot hash。

停止条件：

1. compile 成功能返回 sessionId。
2. session 缺失或 hash mismatch 能返回结构化 error。

### Slice B: Canonical Model 与 Compile

写入范围：

```text
internal/model
internal/compile
internal/typeset
internal/formula
```

目标：

1. 定义 Combatant、Provider、Ability、Modifier、Operation、DriverPlan canonical DTO。
2. 编译 type、matcher、formula、abilityRef、providerRef。
3. collect-all 语义错误。
4. 拒绝 HP raw set、未知 ref、未知 type、matcher domain 错误。

停止条件：

1. invalid payload 一次返回多条 compile errors。
2. valid payload 生成只读 compiled session。

### Slice C: Runtime Event 与 Driver

写入范围：

```text
internal/runtime
internal/scheduler
```

目标：

1. 创建单次 run state。
2. 从 driver plan 生成 ability_attempt 和 sample 事件。
3. 实现固定 category order。
4. 实现 repeat 与 while-ready gate 失败调度规则。

停止条件：

1. gate 失败产生 attempt_skipped evidence。
2. sample 在同一 timeMs 最后执行。

### Slice D: Execution Frame 与 Operations

写入范围：

```text
internal/runtime
internal/command
internal/pipeline
internal/attribute
internal/resource
```

目标：

1. 实现 staged execution frame。
2. lifecycle cost/CD staged 并对 operations 可见。
3. damage/heal/shield/resource/cooldown/provider operations 进入统一 pipeline。
4. fatal error 不产生半提交 state。

停止条件：

1. 基础伤害竖切通过。
2. 资源 + 冷却竖切通过。

### Slice E: Dynamic Provider、Tick 与 Shield

写入范围：

```text
internal/status
internal/shield
internal/runtime
internal/pipeline
```

目标：

1. temporary/status provider 可以 apply、refresh、expire。
2. fixed interval tick provider 以 provider_tick 事件执行。
3. shield 作为专用 runtime object 吸收 damage。

停止条件：

1. 临时 provider + 属性/护盾竖切通过。
2. fixed interval tick provider 竖切通过。

### Slice F: Output、Series 与 Evidence

写入范围：

```text
internal/model
internal/runtime
internal/abi
internal/testkit
```

目标：

1. 输出 summary、finalSnapshot、series、warnings、evidence。
2. 实现 maxSeriesPoints 降采样与 seriesSamplingEvidence。
3. 实现 abilityStats 分组计数。
4. 实现 stopReason 优先级。

停止条件：

1. done/result 不依赖前端从日志二次拼时间线。
2. both_dead 与 budget_exceeded 有确定 stopReason。

## 19. Cursor 执行协议

本节用于驱动模型编写 Cursor prompt。Cursor 固定使用 `grok-4.5`，只负责受限编码；驱动模型必须先收敛范围、再发 prompt、最后亲自 review diff 与验证结果。

### 19.0 当前落地状态与后续切片

Slice A–F 的核心路径**已落地**：generic frame/outbox kind、session registry、`CompileGeneric`/`CompiledSession`、`RunGeneric`（含 damage/gate/provider/output）、canonical fixture，以及 Node/Go smoke/bench。下文 Slice 细化章节保留为历史边界说明与增量改动参考，不再当作“尚未开始”的迁移清单。

后续增量仍按小步发 Cursor：一次只改一个机制竖切或一个宿主表面。Web/Worker 全面切到 generic profile、以及仍依赖 legacy 页面的清理，需另开任务。若一小步需要跨两个 slice，驱动模型必须显式写出主写入范围和允许的最小接口改动。

### 19.0.1 每轮交接产物

每轮 Cursor 产物必须留下：

1. 代码 diff。
2. 新增或更新的 fixture 名称。
3. 新增或更新的测试名称。
4. 实际运行过的命令。
5. 未完成项。
6. 是否偏离本详细设计。

驱动模型 review 后应补充：

1. diff 是否在允许范围内。
2. 旧口径关键词是否进入新 canonical 路径。
3. 失败命令是否是环境问题、设计冲突还是实现缺陷。
4. 下一轮 Cursor prompt 应该继续哪个小步。

### 19.1 通用 Cursor Prompt 模板

```text
目标：
在 C:\project\damage_wasm_dev 的 wasm/dev 分支上，实现 <Slice 名称>。

必须先读取：
1. C:\project\damage_wasm_dev\AGENTS.md
2. C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\AGENTS.md
3. C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\README.md
4. C:\project\damage_wasm_dev\文档记录\需求澄清\wasm\WASM通用计算引擎需求对齐记录.md
5. C:\project\damage_wasm_dev\文档记录\概要设计\wasm\WASM概要设计.md
6. C:\project\damage_wasm_dev\文档记录\详细设计\wasm\WASM详细设计.md

允许写入范围：
<只列本 slice 的文件/目录>

只读参考：
<列相关旧实现、fixture、README、测试文件>

非目标：
1. 不扩展 legacy DPS lane。
2. 不把旧 DTO 命名带进 canonical schema。
3. 不修改本 slice 之外的模块，除非编译错误迫使增加最小接口。
4. 不删除旧 ABI/export/smoke，除非 prompt 明确要求迁移删除。
5. 不重构无关代码，不回滚他人改动。

实现要求：
<从本详细设计复制字段契约、状态机、边界条件和错误码>

测试/验证命令：
<列本 slice 必须跑的命令>

停止条件：
1. 完成目标并通过验证命令。
2. 或发现当前代码结构与本设计冲突，无法在允许写入范围内完成。
3. 或需要跨 slice 改动才能继续。

报告格式：
1. changed files
2. implemented behavior
3. tests run and result
4. unresolved risks
5. any deviation from this design
```

### 19.2 Cursor 通用禁止项

以下禁止项适用于所有 slice：

1. 禁止把新通用引擎输入命名为旧 DTO 名。
2. 禁止在热路径引入 goroutine、channel、lock、panic/recover 控制流或反射。
3. 禁止用 `map[string]...` 做 runtime 热路径查找；字符串 key 必须在 compile 阶段 intern。
4. 禁止为了过测试直接改 golden 期望而不解释行为变化。
5. 禁止在 compile 语义校验中遇到第一个错误就返回；进入已知 schema 后应 collect-all。
6. 禁止让 trigger/listener 直接改 runtime state；必须产出 operation 或进入 execution frame。
7. 禁止直接 set HP；HP 变化必须经 damage/heal/shield/pipeline guard。
8. 禁止从日志反推机制状态；状态必须在 runtime state 中显式保存。
9. 禁止让 sample 事件早于同一 timeMs 的战斗结算。
10. 禁止把 Node smoke 当作正式宿主语义；正式宿主是浏览器 Worker。
11. 禁止把 `single_attacker_dps` 的 first attack、target dummy、attack speed cap 等假设迁入通用 driver。
12. 禁止新增需要用户手动验证的页面步骤，除非 Playwright 无法自动化。

### 19.3 Slice A Prompt 细化：ABI 与 Session Registry

允许写入：

```text
wasm/tinygo_engine_v2/cmd/engine_wasm/**
wasm/tinygo_engine_v2/internal/abi/**
wasm/tinygo_engine_v2/internal/model/**
wasm/tinygo_engine_v2/internal/runtime/session.go
wasm/tinygo_engine_v2/internal/testkit/**
wasm/tinygo_engine_v2/scripts/smoke-node.mjs
```

只读参考：

```text
wasm/tinygo_engine_v2/internal/runtime/runtime*.go
wasm/tinygo_engine_v2/internal/compile/**
wasm/tinygo_engine_v2/README.md
```

必须产出：

1. compile frame kind。
2. run frame kind。
3. release session frame kind。
4. compile result outbox kind。
5. done/error outbox kind 与现有 outbox 优先级兼容。
6. session registry，key 为 opaque `sessionId`。
7. hash mismatch 与 session missing 的结构化 error。
8. 目标 ABI smoke fixture。

不可做：

1. 不实现完整 compile 语义。
2. 不实现 operation pipeline。
3. 不删除旧导出函数，除非驱动模型另开迁移任务。

最小测试：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./...
node .\scripts\smoke-node.mjs
```

验收断言：

1. compile 空/最小合法 payload 能返回 `ok=true` 或明确的 collect-all schema errors。
2. run 使用不存在 session 返回 `code=session_not_found`。
3. run 使用错误 hash 返回 `code=hash_mismatch`。
4. 旧 smoke 未被无意打断，除非本 slice 明确更新 smoke 期望。

### 19.4 Slice B Prompt 细化：Canonical Model 与 Compile

允许写入：

```text
wasm/tinygo_engine_v2/internal/model/**
wasm/tinygo_engine_v2/internal/compile/**
wasm/tinygo_engine_v2/internal/typeset/**
wasm/tinygo_engine_v2/internal/formula/**
wasm/tinygo_engine_v2/internal/testkit/**
```

必须产出：

1. canonical DTO：CompileRequest、CombatantDefinition、ProviderDefinition、AbilityDefinition、ModifierDefinition、OperationDefinition、DriverPlan。
2. compile 内部只读结构：CompiledSession、CompiledCombatant、CompiledProvider、CompiledAbility、CompiledOperation。
3. type registry 与 matcher domain 校验。
4. canonical abilityRef 解析、intern 与引用校验。
5. formula 编译与 P0 路径白名单。
6. compile errors collect-all。

字段默认值：

1. `types[]`、`tags[]`、`abilities[]`、`modifiers[]`、`listeners[]` 缺失时视为空数组。
2. `settings` 缺失时使用引擎默认值。
3. `sampling` 和 `safetyBudget` 不属于 compile input，不得放进 compiled rules。
4. 未声明 `cost` 和 `cooldown` 的 active ability 表示无消耗、无基础 CD。

必须拒绝：

1. 未知 providerRef、abilityRef、formulaRef。
2. 未知 type key。
3. matcher domain 错误。
4. type relation 超过两层或成环。
5. HP raw set operation。
6. formula 读取 P0 未开放路径。
7. operation target 不存在。

最小测试：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./internal/model ./internal/compile ./internal/typeset ./internal/formula
```

验收断言：

1. 一个 invalid payload 同时返回至少两类语义错误。
2. 一个 valid P0 payload 生成 compiled session，且热路径引用是短 ID 或索引。
3. type matcher 不做父子闭包展开。
4. compile warning 不阻止 session，compile error 阻止 session。

### 19.5 Slice C Prompt 细化：Runtime Event 与 Driver

允许写入：

```text
wasm/tinygo_engine_v2/internal/runtime/**
wasm/tinygo_engine_v2/internal/scheduler/**
wasm/tinygo_engine_v2/internal/testkit/**
```

必须产出：

1. `RuntimeEvent` category order。
2. driver plan 到 `ability_attempt` / `sample` event 的初始化逻辑。
3. repeat interval 调度。
4. while-ready ready-time 推导。
5. gate 失败 evidence。
6. sample 在同一 timeMs 最后执行。

gate 规则：

1. cooldown 未好 -> `cooldown_not_ready`，下一次取 cooldown ready time。
2. resource 不足 -> `resource_insufficient`，可估算 regen 时取 resource ready time。
3. condition false -> `condition_false`，无法推导时按 `conditionRecheckIntervalMs`。
4. target 不可用 -> `target_unavailable`。

最小测试：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./internal/scheduler ./internal/runtime
go run ./cmd/bench
```

验收断言：

1. 同 timeMs 下 `expire_cleanup` 早于 `provider_tick`。
2. `provider_tick` 早于 `ability_attempt`。
3. `sample` 晚于同 timeMs 所有战斗事件。
4. gate 失败不会在同 timeMs 忙循环。

### 19.6 Slice D Prompt 细化：Execution Frame 与 Operations

允许写入：

```text
wasm/tinygo_engine_v2/internal/runtime/**
wasm/tinygo_engine_v2/internal/command/**
wasm/tinygo_engine_v2/internal/pipeline/**
wasm/tinygo_engine_v2/internal/attribute/**
wasm/tinygo_engine_v2/internal/resource/**
wasm/tinygo_engine_v2/internal/testkit/**
```

必须产出：

1. ExecutionFrame staged mutation。
2. lifecycle cost/CD staged。
3. damage/heal/shield/resource_change/cooldown_change/provider operations。
4. fatal error 时不提交 staged mutation。
5. 父 frame 提交后再 enqueue listener/子 ability。

实现顺序：

1. 先完成基础 damage -> target HP。
2. 再完成 resource cost + cooldown gate。
3. 再接入 shield absorb。
4. 最后接入 provider apply/refresh/expire。

最小测试：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./internal/attribute ./internal/resource ./internal/command ./internal/pipeline ./internal/runtime
go run ./cmd/bench
```

验收断言：

1. cost/CD 对同 frame 后续 operation 可见。
2. fatal formula 非有限数不改变 final state。
3. damage 不绕过 pipeline 直接扣 HP。
4. 普通 ability cost 不需要规则作者写 resource_change。

### 19.7 Slice E Prompt 细化：Dynamic Provider、Tick 与 Shield

允许写入：

```text
wasm/tinygo_engine_v2/internal/status/**
wasm/tinygo_engine_v2/internal/shield/**
wasm/tinygo_engine_v2/internal/runtime/**
wasm/tinygo_engine_v2/internal/pipeline/**
wasm/tinygo_engine_v2/internal/testkit/**
```

必须产出：

1. ProviderInstance create/refresh/expire。
2. provider modifiers/listeners/abilities 的挂载与清理。
3. fixed interval tick provider。
4. ShieldInstance absorb、priority、expire。
5. provider expire 与 provider_tick 同 timeMs 的顺序测试。

不可做：

1. 不把所有 shield provider 化。
2. 不让 status tick 私下删除 provider。
3. 不实现动态 haste 缩放 tick 间隔。
4. 不实现多目标 tick。

最小测试：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./internal/status ./internal/shield ./internal/pipeline ./internal/runtime
go run ./cmd/bench
```

验收断言：

1. provider 过期后不再 tick。
2. tick 与 expire 同 timeMs 时，expire 先执行。
3. shield absorb 后 evidence 可解释 remaining。
4. provider 清理会移除 modifier/listener/ability runtime state。

### 19.8 Slice F Prompt 细化：Output、Series 与 Evidence

允许写入：

```text
wasm/tinygo_engine_v2/internal/model/**
wasm/tinygo_engine_v2/internal/runtime/**
wasm/tinygo_engine_v2/internal/abi/**
wasm/tinygo_engine_v2/internal/testkit/**
wasm/tinygo_engine_v2/scripts/**
```

必须产出：

1. DoneResult DTO。
2. summary 最小字段。
3. abilityStats 分组。
4. series point 与 window DPS。
5. maxSeriesPoints 降采样。
6. warnings/evidence 限量与聚合。
7. stopReason 优先级。

最小测试：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./internal/model ./internal/abi ./internal/runtime
node .\scripts\smoke-node.mjs
```

验收断言：

1. done/result 包含 chart-ready `series[]`。
2. `finalSnapshot` 未因展示两位小数被截断。
3. `timeMs < dpsWindowMs` 使用实际窗口计算 window DPS。
4. `maxSeriesPoints` 超限时输出 `seriesSamplingEvidence`。
5. fatal error 不同时输出 done。

### 19.9 驱动模型 Review Checklist

每轮 Cursor 返回后，驱动模型必须亲自检查：

1. `git diff --stat` 是否只落在允许范围。
2. diff 是否引入旧 DTO 命名到新 canonical model。
3. 是否绕过 operation pipeline 写 HP/resource/cooldown/provider state。
4. 是否把 legacy DPS lane 扩成新机制入口。
5. compile 是否仍 collect-all。
6. run fatal error 是否避免半提交 finalSnapshot。
7. sample 顺序是否固定。
8. warnings/evidence 是否结构化且有限量。
9. 测试是否覆盖本 slice 的负例。
10. README/AGENTS/scripts 是否因 ABI 改动需要同步。

如果 Cursor 报告与 diff 冲突，以 diff 和测试结果为准，不以 Cursor 自述为准。

## 20. Fixture 目录与命名

建议在 `internal/testkit` 下建立稳定 fixture 命名，避免每个 Cursor worker 自创样例：

```text
internal/testkit/fixtures/
  generic_p0_basic_damage.json
  generic_p0_resource_cooldown_gate.json
  generic_p0_temp_provider_attr_shield.json
  generic_p0_fixed_tick_provider.json
  generic_p0_hash_mismatch_run.json
  generic_p0_session_missing_run.json
  generic_p0_compile_multi_error.json
  generic_p0_non_finite_runtime.json
  generic_p0_both_dead_stop_priority.json
  generic_p0_series_downsample.json
```

每个 fixture 至少包含：

1. `name`
2. `phase`
3. `compileRequest` 或 `runRequest`
4. `expectedResultKind`
5. `expectedErrorCodes[]`
6. `expectedWarnings[]`
7. `expectedEvidenceKinds[]`
8. `expectedSummarySubset`
9. `notes`

fixture 规则：

1. fixture 中不得出现旧 DTO 字段名。
2. fixture 的数字值要小且可手算。
3. 每个 fixture 只验证一个主行为，避免一个失败掩盖多个问题。
4. 负例 fixture 必须验证 error code，而不是只验证失败。
5. 图表 fixture 必须验证 `series[]`，不能只验证 final HP。

P0 fixture 的最小行为：

| fixture | 主断言 |
| --- | --- |
| `generic_p0_basic_damage` | active ability 造成 damage，target HP 降低，summary/series 有值。 |
| `generic_p0_resource_cooldown_gate` | 第二次 attempt 因 cooldown 或 resource 被 gate，出现 `attempt_skipped`。 |
| `generic_p0_temp_provider_attr_shield` | provider apply 后 modifier/shield 生效，expire 后清理。 |
| `generic_p0_fixed_tick_provider` | tick 按 interval 执行，到期后停止。 |
| `generic_p0_hash_mismatch_run` | run 返回 `hash_mismatch`。 |
| `generic_p0_session_missing_run` | run 返回 `session_not_found`。 |
| `generic_p0_compile_multi_error` | compile 一次返回多条语义错误。 |
| `generic_p0_non_finite_runtime` | run fatal error，不输出 done。 |
| `generic_p0_both_dead_stop_priority` | 同 timeMs 双方死亡，stopReason 为 `both_dead`。 |
| `generic_p0_series_downsample` | 超过 maxSeriesPoints 后降采样并输出 evidence。 |

`generic_p0_basic_damage` 最小样例：

```json
{
  "name": "generic_p0_basic_damage",
  "phase": "run",
  "compileRequest": {
    "schemaVersion": "generic-p0",
    "schemaHash": "schema.generic-p0.example",
    "rulesHash": "rules.generic_p0_basic_damage",
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
          { "providerRef": "champion:source_demo", "definitionRef": "champion:source_demo" }
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
    "rules": { "operations": [], "modifiers": [], "listeners": [], "triggerRules": [] },
    "formulas": [],
    "settings": {}
  },
  "runRequest": {
    "sessionId": "<from compile>",
    "expectedRulesHash": "rules.generic_p0_basic_damage",
    "initialSnapshot": {
      "schemaHash": "schema.generic-p0.example",
      "rulesHash": "rules.generic_p0_basic_damage",
      "timeMs": 0,
      "combatants": [
        {
          "key": "source",
          "attributes": { "attack_damage": { "base": 100, "current": 100, "max": 100, "resolved": 100 } },
          "resources": {},
          "cooldowns": {},
          "providers": [{ "providerRef": "champion:source_demo", "definitionRef": "champion:source_demo", "stacks": 1, "state": {} }],
          "shields": [],
          "abilityState": {},
          "providerState": {},
          "vars": {}
        },
        {
          "key": "target",
          "attributes": { "hp": { "base": 1000, "current": 1000, "max": 1000, "resolved": 1000 } },
          "resources": {},
          "cooldowns": {},
          "providers": [],
          "shields": [],
          "abilityState": {},
          "providerState": {},
          "vars": {}
        }
      ]
    },
    "driverPlan": {
      "conditionRecheckIntervalMs": 100,
      "entries": [
        {
          "entryKey": "basic_attack_once",
          "abilityRef": "source.provider[champion:source_demo].ability[basic_attack]",
          "source": "source",
          "target": "target",
          "priority": 0,
          "firstAtMs": 0
        }
      ]
    },
    "stopPolicy": { "durationMs": 100, "stopOnTargetDeath": true, "stopWhenNoEvents": true },
    "sampling": { "sampleEveryMs": 100, "dpsWindowMs": 1000, "maxSeriesPoints": 5000 }
  },
  "expectedResultKind": "done",
  "expectedSummarySubset": {
    "targetFinalHp": 900,
    "abilityAttemptCount": 1,
    "abilityCastCount": 1,
    "attemptSkippedCount": 0
  },
  "expectedEvidenceKinds": [],
  "notes": "数字小且可手算；用于第一条 damage 竖切。"
}
```

`generic_p0_compile_multi_error` 最小样例：

```json
{
  "name": "generic_p0_compile_multi_error",
  "phase": "compile",
  "compileRequest": {
    "schemaVersion": "generic-p0",
    "schemaHash": "schema.generic-p0.example",
    "rulesHash": "rules.generic_p0_compile_multi_error",
    "typeCatalog": {
      "types": [
        { "key": "ability/basic_attack", "domain": "ability" }
      ],
      "relations": [
        { "parent": "ability/root", "child": "ability/basic_attack" },
        { "parent": "ability/basic_attack", "child": "ability/root" }
      ]
    },
    "combatants": [
      { "key": "source", "attributes": {}, "resources": {}, "providers": [] },
      { "key": "target", "attributes": {}, "resources": {}, "providers": [] }
    ],
    "sharedProviders": [
      {
        "providerKey": "champion:bad_demo",
        "kind": "champion",
        "stableId": "bad_demo",
        "abilities": [
          {
            "abilityKey": "bad",
            "kind": "active",
            "types": ["status/stun"],
            "operations": [
              { "operation": "set_hp_raw", "target": "target", "amount": { "op": "const", "value": 1 } },
              { "operation": "damage", "target": "missing_target", "amount": { "op": "read", "path": "history.damage.sum.1000ms" } }
            ]
          }
        ]
      }
    ],
    "rules": { "operations": [], "modifiers": [], "listeners": [], "triggerRules": [] },
    "formulas": [],
    "settings": {}
  },
  "expectedResultKind": "compile_error",
  "expectedErrorCodes": [
    "matcher_domain_error",
    "hp_raw_set_forbidden",
    "operation_target_missing",
    "formula_type_error"
  ],
  "expectedWarnings": [],
  "expectedEvidenceKinds": [],
  "notes": "用于证明 compile collect-all；具体错误顺序不做断言。"
}
```

## 21. 验证计划

只改本文档时不需要运行构建。实现阶段按改动范围运行：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./...
go run ./cmd/bench
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
node .\scripts\smoke-node.mjs
node .\scripts\bench-node.mjs --iterations 10 --warmup 2
```

P0 fixture 至少覆盖：

1. 基础伤害。
2. 资源 + 冷却 gate。
3. 临时 provider + 属性 modifier 或 shield。
4. fixed interval tick provider。
5. hash mismatch。
6. session missing。
7. compile collect-all 多错误。
8. 非有限数 runtime fatal。
9. stopReason 同时满足优先级。
10. series 降采样 evidence。

涉及 `web/**` 的 Worker adapter 或页面验收时，按前端 worktree 规则补充浏览器验证。
