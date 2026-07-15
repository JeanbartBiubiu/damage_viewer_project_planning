TASK_KEY: wasm-generic-linked-effects-black-cleaver
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-15

# 通用 ABI — Linked Effects（黑色切割者）机制详细设计

验证记录：[通用 ABI Linked Effects 黑切机制验证记录](../../测试记录/wasm/通用ABI-LinkedEffects黑切机制验证记录-2026-07-13.md)

本文只描述当前 generic ABI 合同。2026-07-13 的 `-4 armor / basic-only / run 内永久` 是历史 partial，已被本设计取代；旧 live revision 17 不证明当前合同已 migrate/publish。

## 1. 当前机制合同

| 项 | 当前值 |
| --- | --- |
| 装备 | Black Cleaver `item_3071` |
| Provider | `provider_item_3071_black_cleaver_carve`，attacker/source-owned |
| 触发 | 顶层真实 root physical damage；不限定 basic attack |
| State | `provider_target.carve_stacks`，default 0，max 5 |
| 窗口 | 6000ms，`refresh_on_write`；满层后的第 6 次合格伤害仍刷新 |
| Modifier | 对 opponent `armor` 做 `percent_add = -0.06 * carve_stacks` |
| 数值 | 每层从基准 armor 减 6%，最多 30%；不是 flat -4，也不是逐层复乘 |

同一 source provider 当前只维护一个 active target state。1v1 下 target switch 会清空旧 pair state；两侧挂同一 providerRef 时以 owner combatant + providerRef 隔离。

## 2. Root physical `damage_dealt` 合成

顶层 `chainDepth=0` ability frame 中，只要至少一个 canonical `damage/physical` operation 经 pipeline 后 `result.Amount > 0`，就在 frame commit 后、listener dispatch 前合成一次 core event：

- `event/damage_dealt`
- `event/damage_dealt/physical`
- 若 ability TypeSet 含 `ability/basic_attack` 且 catalog 存在，则额外附加 `event/damage_dealt/basic_attack`

`event/damage_dealt/basic_attack` 是 optional qualifier；缺失时不能吞掉 core physical event。core event 仍对非 basic root physical ability 成立。

下列情况不合成：

- magic / true / mitigated amount 为 0
- phantom replay
- listener child / `chainDepth>0`
- catalog 缺 `damage/physical` 或任一 core event type

同一 frame 多个合格 physical operation 只合成一次，并在 evidence 中稳定保留单个 `operationRef` 或 `operationRefs`。

## 3. Provider-target state 与跨 combatant modifier

### 3.1 State write 顺序

每次 source-owner core physical event 触发一条 `state_change`：

1. lazy-expire 当前 pair state；
2. activate 当前 target；target switch 时清空旧 values/timers；
3. 只为本次具体 key `carve_stacks` seed default；
4. `add 1`，按 max 5 clamp；
5. 每次写入都刷新 `expireAt = now + 6000`，包括已经 clamp 在 5 的写入。

非零 default 只在具体 target key 首次读写时应用。公式 overlay 只暴露已经触达的 `targetValues`，不得把 provider-scope field definitions 批量注入 target state。

### 3.2 Modifier 挂载与求值

`opponent.attr.armor` modifier 挂到对手 resolver，但保留 `OwnerCombatantKey + ProviderRef` provenance，从 source bag 读取：

```text
-0.06 * provider.target_state.carve_stacks
```

排序保持既有 `bucket → stage → priority → modifierKey`；owner/provider 仅在 modifierKey 相同后破平，不能改变非交换 modifier 的历史顺序。

### 3.3 Expiry

每次刷新都排入带 owner/provider/target/stateKey/expectedExpireAt 的 cleanup；旧 cleanup 通过 expected timestamp 丢弃。到期时：

- `carve_stacks` 写回 default 0；
- timer 清零；
- 重新求值受影响 target armor；
- 若 cleanup 与 ability 同毫秒，expire cleanup 先执行，攻击按恢复后的 armor 结算。

## 4. Canonical 数值

初始 target armor=100：

| 击序 | 本击结算 armor | 击后 stacks | 击后 armor |
| ---: | ---: | ---: | ---: |
| 1 | 100 | 1 | 94 |
| 2 | 94 | 2 | 88 |
| 3 | 88 | 3 | 82 |
| 4 | 82 | 4 | 76 |
| 5 | 76 | 5 | 70 |
| 6 | 70 | 5 | 70；窗口刷新 |

第 1 击必须按旧 armor 结算。若最后一次写在 `t=500ms`，`t=6499` 仍为 5 层/70 armor，`t=6500` 回到 0 层/100 armor。

## 5. Backend 数据合同

当前 seed：`db/game_manage/seeds/lol_generic_linked_effects_seed.sql`。

必须包含：

- reserved `event/damage_dealt/physical`（20214）；`event/damage_dealt/basic_attack`（20215）可保留为其它 matcher vocabulary，但 Black Cleaver active matcher 不使用它；
- `provider_state_fields.carve_stacks`：number / max 5 / duration 6000 / refresh-on-write；
- source-owner ALL matcher：`damage_dealt + physical + source_owner`；
- 单 `state_change` sequence；
- opponent armor `percent_add` modifier，公式 `-0.06 * provider.target_state.carve_stacks`；
- `item_3071` mount。

升级旧 seed 时只允许受控移除该 listener 上废弃的 basic-attack matcher，其它路径继续幂等、material-change 才推进 candidate revision。不执行 live migration，不自动 publish。

Backend 实现基线：`597f9ae6f6d10e3b9e481699e72982b1a59b121b`。

## 6. Wasm 写入边界

当前实现集中在：

- `internal/pipeline/attribute_resolver.go`
- `internal/runtime/generic_execution.go`
- `internal/runtime/generic_provider.go`
- `internal/runtime/generic_provider_state.go`
- `internal/runtime/generic_run.go`
- `internal/runtime/generic_bound_modifiers.go`
- `internal/runtime/generic_target_state_expiry.go`
- `internal/runtime/generic_linked_effects_test.go`

不新增 public DTO、Driver ABI 或专用 Black Cleaver operation。runtime 原语必须继续保持数据驱动，可复用于其它跨 combatant modifier / provider-target window。

Wasm 实现基线：`01ceb07153272f9c4d234605444c7e1a9af3cb02`。

## 7. Web 合同

现有 `ProviderStateField` 与 assembler 已投影 `maxValue`、`durationMs`、`refreshPolicyTypeId`；当前能力不新增 ABI 字段。Web 只需同步经验证的 Wasm artifact，并继续运行 generic targeted/full tests、lint、typecheck 与 production build。

## 8. 必须覆盖的边界

- first hit old armor；5 层 cap；第 6 次 cap write 刷新；6000ms expiry
- expiry 与 hit 同毫秒
- optional basic qualifier 缺失仍 emit core physical
- non-basic root physical 可触发；basic-only listener 不误匹配 non-basic
- magic / true / zero / phantom / child 不触发或不递归
- 同 frame 多 physical 只 emit 一次
- 两侧同 providerRef 隔离；一侧 expiry 不影响另一侧
- provider-target 非零 default 首次 add、mixed-scope 不泄漏
- modifierKey 排序优先于 owner/provider
- command budget 与 determinism

## 9. 剩余边界

本任务只把 `切割 / Carve` 标为 completed/full。`item_3071` 的 `热烈 / Fervor`（造成物理伤害后 20 移速、持续 2 秒）仍缺 generic movement-speed combat-damage window，保持 `blocked_runtime`。

多目标 pair state、真实 live migration/publish 和浏览器 live E2E 也不由本轮声明完成。
