TASK_KEY: wasm-generic-execute-threshold
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: active
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-13

# 通用 ABI — Execute Threshold（收集者）机制详细设计

对应总体审计：`wasm-generic-min-validation-coverage-audit`。本批只关闭 execute 子机制；总体审计继续保持 active，后续顺序为 linked effects → crit/modifier。

## 1. 目标与固定样本

代表对象为 `item_6676` 收集者的 Death。数据源快照（DDragon 16.7.1）语义为：伤害使英雄处于 5% 生命值以下时处决。税/额外金币不进入本批。

本批是简化通用 ABI gate：

1. 只在独立真实 `event/basic_attack_hit` 上检查 execute。
2. 不新增全局 `event/damage_dealt`；Collector 的任意技能、DoT、linked damage 处决能力留后续事件批。
3. 目标生命比例 **严格小于** 5% 才触发；正好 5% 不触发。
4. Execute 直接终结目标，不属于额外伤害。

## 2. 运行时合同

### 2.1 数据图

```text
basic attack ability
  damage
  emit event/basic_attack_hit

item_6676 provider listener
  ALL event/basic_attack_hit + event/source_owner
  execute_threshold(target=opponent, threshold=0.05)
```

Phantom replay 不重派 listener，因此 phantom damage 即使把目标压入阈值，也不触发 execute。Execute operation 本身不可复制、不可递归。

### 2.2 Operation

新 kind：`execute_threshold`。

首批复用 `OperationDefinition.threshold`，固定语义：

| 字段 | 合同 |
| --- | --- |
| `operation` | `execute_threshold` |
| `target` | `target` / `opponent` |
| `threshold` | 有限数，`0 < value <= 1`；收集者为 `0.05` |
| `ref` | 稳定 step id，也是 evidence source |
| threshold type | 固定 `current_hp_ratio` |
| comparison | 固定 `strict_below` |
| timing | 固定为 `basic_attack_hit` emit snapshot |

禁止携带 `amount`、`valuePolicy`、`damageType`、resource/attribute/event/payload 字段、`copyableOnHit=true` 与 repeat 字段。Compile 必须 collect-all 报错。

### 2.3 判定与结算

1. 读取 listener event target snapshot 的 `hp.current` / `hp.max`；该快照位于基础 damage 后、`basic_attack_hit` emit 时。
2. 若 live target HP 已 `<= 0`，跳过，避免基础伤害已击杀后的重复 execute。
3. 若 max HP 非正数，fail closed 并产出配置/运行时错误，不做除零近似。
4. `snapshotCurrentHp / snapshotMaxHp < threshold` 时触发。
5. 经 command + pipeline resolver 将 live target HP 置 0；不得在 generic runtime 分支散落直接 HP mutation。
6. Execute 绕过 shield；现有 shield 保持，不折算成伤害。
7. 死亡停止原因首批沿用 `target_dead`，不新增 stop reason。
8. `stopOnTargetDeath=false` 时目标保持 HP=0，后续 hit 不再产生 execute evidence。

### 2.4 统计与 Evidence

新增 evidence kind：`execute`。至少记录：

- source / target
- providerRef / abilityRef / operationRef
- hpBefore / maxHp / hpRatio
- threshold
- thresholdType=`current_hp_ratio`
- comparison=`strict_below`
- killed
- shieldBypassed
- phantom=false

Execute 不得：

- 增加 `SourceDamageDealt` / `TargetDamageTaken`
- 写入 damage timeline/history
- 生成 damage evidence
- 进入 Guinsoo copyable-on-hit collector
- emit `basic_attack_hit` 或其它伤害事件

## 3. 数据库与 API 合同

### 3.1 DDL

新增第十一种 effect detail family：

```sql
execute_effect_details(
  game_id varchar(64),
  step_id varchar(256),
  threshold numeric CHECK (threshold > 0 AND threshold <= 1),
  change_revision bigint,
  updated_at timestamp,
  PRIMARY KEY (game_id, step_id),
  FOREIGN KEY (game_id, step_id) REFERENCES effect_steps
) PARTITION BY LIST (game_id)
```

并新增对应 `_log` 分区表。首批语义固定，不增加 thresholdType/comparison/checkTiming/sourceRef 列；`step_id` 即稳定 source ref。

必须同步：

1. `schema.sql`
2. 幂等 compatibility migration
3. `triggers.sql` 的 ensure partition 清单与 exactly-one detail 计数/触发器
4. publish log copy
5. reserved `operation/execute_threshold`（实施前核对未占用 ID）

### 3.2 Backend API

新增 Admin/Public combat-data resource：`execute-effect-details`，接入：

- mapper XML / mapper interface
- read/write service
- controller/resource registry
- publish `_log` 复制与版本读取
- DTO/map JSON 字段 `stepId`、`threshold`

该资源必须可维护，不能只在 Public graph 中旁路拼接。

### 3.3 Seed

新增 `lol_generic_execute_threshold_seed.sql`：

- provider：`provider_item_6676_collector_execute`
- listener：真实 `basic_attack_hit` + `source_owner`
- sequence：单 execute step
- threshold：`0.05`
- mount：`item_6676`
- 无 DELETE、无自动 publish、仅 material change 推 revision

Live 基线为 `15/15`；预计 seed 后 `16/15`，幂等重跑保持 `16/15`；发布 `lol-generic-execute-v1-20260713` 后 `16/16`。

## 4. Wasm 写入范围

建议最小文件：

- `internal/model/generic_compile.go`
- `internal/model/generic_run_output.go`
- `internal/compile/generic.go`
- `internal/compile/generic_test.go`
- `internal/command/command.go`
- `internal/pipeline/resolver.go`
- `internal/pipeline/resolver_test.go`
- `internal/runtime/generic_execution.go`
- `internal/runtime/generic_execute_test.go`（新增）

禁止改 legacy DPS DTO/dispatcher；旧 `execute_threshold` 仅作语义参考。

## 5. Web 写入范围

最小接入：

- `src/types/combatData.ts`
- `src/types/genericEngine.ts`（仅类型确有缺口时）
- `src/services/combatDataClient.ts`
- `src/services/combatDataLoader.ts`
- `src/engine/combatDataAssembler.ts` / test
- Admin combat-data resource registry 与通用表页配置

Assembler 投影：

```ts
{
  operation: 'execute_threshold',
  target,
  threshold: detail.threshold,
  ref: step.stepId
}
```

Generic validation page 不本地计算阈值或伤害；仅显示引擎 evidence/summary。

## 6. 测试矩阵

### 6.1 Compile / Pipeline

- 合法 execute compile
- threshold 0、负数、>1、NaN/Inf
- 非法 amount/damageType/valuePolicy/copyable/repeat 字段 collect-all
- execute resolver 绕盾、HP→0、shield 保持
- execute 不产生 damage result

### 6.2 Runtime

- 5.1% 不触发
- 正好 5.0% 不触发
- 4.9% 触发
- 基础 hit 从阈值上方跨入阈值后触发
- 基础 hit 已击杀：无重复 execute evidence
- 带盾低血：绕盾击杀且盾保持
- `stopReason=target_dead`
- `stopOnTargetDeath=false`：仅一次 execute
- 无 `basic_attack_hit` 不触发
- 主动技能伤害不触发
- deterministic
- phantom 未触发边界 A/B

### 6.3 Backend / Web / E2E

- DDL、partition、exactly-one、publish copy、API CRUD/read、seed 静态测试
- Web client/loader/assembler/Admin resource tests
- Browser：Vayne + tank + item6676；compile/run/release；execute evidence 1 次；目标 HP=0；damage summary 不含被处决剩余 HP；phantom 组合不复制/不触发 execute

## 7. 分 Gate 开发顺序

### Gate A — Backend DDL/API

目标：建立 execute detail 的持久化、分区、发布与 API 合同。

验证：定向 DB contract/mapper/service/controller tests，随后 `mvn test`。

停止条件：exactly-one、partition 或 publish log 无法闭环时不进入 seed/live。

### Gate B — Wasm

目标：实现 compile → command/pipeline → runtime → evidence 的真正 execute operation。

验证：

```powershell
go test ./internal/compile -run "Execute|Operation" -count=1
go test ./internal/pipeline -run Execute -count=1
go test ./internal/runtime -run "GenericExecute|Phantom|Guinsoo" -count=1
go test -count=1 ./...
go run ./cmd/bench
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
node .\scripts\smoke-node.mjs
```

停止条件：若必须引入全局 damage event 或修改 legacy DPS lane，先拆批报告。

### Gate C — Web

目标：接入新 detail resource、assembler 与新 wasm artifact。

验证：lint、typecheck、Vitest、build；Admin resource 和 Generic validation smoke。

### Gate D — Seed / Live / E2E

顺序：compat migration → triggers → reserved seed → execute seed → 幂等核对 → 显式 publish → browser compile/run/release。

### Gate E — Governance

新增测试记录，将 `wasm-generic-execute-threshold` 标记完成；总体审计继续 active。

## 8. 非目标与后续

- Collector any-damage execute 与全局 `event/damage_dealt`
- 技能、DoT、linked effect 后 execute
- 金币、击杀收益、death event
- 多目标与目标传播
- 赛瑞尔达等其它 execute-like 对象
- crit/modifier（总体审计后续批）
