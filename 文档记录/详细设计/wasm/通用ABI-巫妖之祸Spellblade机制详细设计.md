TASK_KEY: wasm-generic-lich-bane-spellblade
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-13

# 通用 ABI — 巫妖之祸 Spellblade（item_3100）机制详细设计

关联验证记录：[通用 ABI 巫妖之祸 Spellblade 机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务独立于已完成的 `wasm-generic-spellblade`（仅 item_3078）。

## 1. 目标与数据边界

将 item_3100 的单目标 Spellblade 完整投影到现有 generic ABI。数值真源为 `C:\project\damage_wasm_dev\数据参考\lol-wiki-current-items\current-items.normalized.json` 的 item 3100：下一次普攻在 10 秒内造成 `0.75 * base AD + 0.45 * AP` 额外魔法伤害，提供 `50%` bonus attack speed，ICD 为 1.5 秒。

不执行 live migration 或 publish；seed 只提供可重复录入合同。

## 2. 数据合同

Backend 新增 `lol_generic_lich_bane_spellblade_seed.sql`，前置为 reserved types、Batch-B 薇恩、Batch-C `item_3100`、既有 `lol_generic_spellblade_seed.sql` 生成的 `ability/basic_attack` 与 `ability_hero_vayne_tumble`，以及 `basic_attack_hit` emit 基线。

| 环节 | 合同 |
| --- | --- |
| provider | `provider_item_3100_lich_bane_spellblade`，mount 到 `item_3100` |
| 武装 | `event/ability_started` + `event/source_owner`，`spellblade_icd=0` 时写 ready 与 ICD |
| 状态 | `spellblade_ready`: max 1、10000ms；`spellblade_icd`: max 1、1500ms；均 refresh_duration |
| 伤害 | `damage/magic`，`0.75 * event.entry_source.attr.ad.base + 0.45 * event.entry_source.attr.ap.resolved`，`copyable_on_hit=false` |
| 消费 | 真实 `basic_attack_hit` 的伤害后将 ready override 为 0 |
| 临时攻速 | provider modifier：target `attack_speed`、`percent_add`、`0.5 * provider.state.spellblade_ready` |

所有写入使用 idempotent upsert，只有 material change 才推进 `game_data_state.current_revision`；禁止 DELETE、DROP、CASCADE、自动 publish 与 legacy Bundle/Catalog 写入。

## 3. Runtime 与 Web 投影

不新增 Wasm ABI、DTO 或生产 runtime 分支。现有 provider state、modifier、listener、公式和 `DriverRepeat.intervalFormula` 已足以表达本机制。

Wasm 回归必须证明：

1. cast 后 ready/ICD 为 1，攻速由 1.0 变为 1.5；
2. 首次真实命中仅造成 120（base AD=100、AP=100、零魔抗）额外魔法伤害并消费 ready，攻速恢复；
3. ICD 内不能重武装，到期后可重武装；ready 到期不触发；
4. 固定 `FirstAtMs` 不被改写，50% 攻速只影响后续 `intervalFormula` 的动态间隔；
5. Guinsoo phantom 不复制、消费或推进 Lich Bane 状态。

Web 不加专用分支。`combatDataAssembler` 必须将 source equipment 的 provider、state schema、modifier、formula、two listeners 和 ordered operations 直接组装为 namespaced `CompileRequest`；target 不能错误挂载该 item provider。

## 4. 非目标

- 不实现多 Spellblade unique-group 冲突、完整主动技能 rotation、同帧 arm+on-hit、治疗或其它装备效果。
- 不把 3100 的 50% 攻速伪写为固定首刀 windup；固定首击时间仍由 driver input 决定。
- 不执行 live DB、浏览器联调或发布动作。

## 5. 验收

- Backend SQL 静态测试和全量 Maven 测试通过；
- TinyGo `go test`、bench、Wasm build 与 Node smoke 通过；
- Web lint、typecheck、Vitest、build 通过；
- G8 generator check 通过，3100 与已完成 6672 均分类为 `migrated`；
- 更新 `task_rules.json` 后 rebuild/query 能解析本任务的两份文档。
