TASK_KEY: wasm-generic-essence-reaver-spellblade
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-14

# 通用 ABI - 夺萃之镰 Spellblade（item_3508）机制详细设计

关联验证记录：[通用 ABI 夺萃之镰 Spellblade 机制验证记录](../../测试记录/wasm/通用ABI-夺萃之镰Spellblade机制验证记录-2026-07-14.md)。本项独立于已完成的 3078 与 3100 Spellblade 闭环；G8 只把精确候选 `item_passive|3508|item_passive|咒刃` 迁移为 `migrated`。

## 1. 目标与数据边界

数值真源为 `C:\project\damage_wasm_dev\数据参考\lol-wiki-current-items\current-items.normalized.json` 的 current item 3508：施放技能后，下一次普攻在 10 秒内造成额外物理伤害 `1.25 * base AD + 50 * crit chance`，强化攻击命中后开始 1.5 秒冷却。`crit chance` 按当前 Batch-C 静态属性合同取 `0..1` 的 resolved 值。

本项只闭环单目标伤害、ready、ICD 和输入快照。装备的法力回复不进入本轮 1v1 伤害模拟，明确标记为 `out_of_scope`；不以近似值替代上述伤害公式。

## 2. 数据合同

Backend 新增 `lol_generic_essence_reaver_spellblade_seed.sql`，只依赖通用 reserved types 与 `item_3508` 静态装备：

| 环节 | 合同 |
| --- | --- |
| provider | `provider_item_3508_essence_reaver_spellblade`，仅 mount 到 `item_3508` |
| 状态 | `spellblade_ready` 的有效期为 10,000ms；`spellblade_icd` 为 1,500ms；均为 namespaced provider state |
| 武装 | `event/ability_started`、`event/source_owner`，条件为 `mul(eq(ready, 0), eq(icd, 0))` |
| 伤害 | 真实 `basic_attack_hit` 的物理 `1.25 * event.entry_source.attr.ad.base + 50 * event.entry_source.attr.crit_chance.resolved`，`copyable_on_hit=false` |
| 命中后顺序 | 先 `damage`，再 arm `spellblade_icd`，最后 consume `spellblade_ready` |

`mul(eq(...), eq(...))` 是当前 Generic Formula VM 已支持的数值 0/1 gate；不写入未支持的 `and`、`or` 或 `not` AST。seed 全部为幂等 upsert，禁止 `DELETE`、`DROP`、`CASCADE`、自动 publish 和 legacy bundle/catalog 写入。

## 3. Runtime 与 Web 投影

不增加 Wasm ABI、DTO 或 production runtime 分支。既有 provider state、listener、operation 顺序、formula read path 和 event-entry attribute snapshot 已可精确表达该合同。

Wasm 回归必须证明：

1. `baseAD=100`、`crit=0.25` 的 raw 伤害为 `137.5`；目标 `armor=100` 时为 `68.75`；`crit=1` 时 raw 为 `175`。
2. cast 只能在 ready/ICD 都为零时武装；命中严格按 damage → ICD → ready 消费；ICD 到期后才可再次武装，ready 会在 10 秒后失效。
3. 后续修改攻击者 AD 或暴击率不得改变已进入 event-entry 的伤害快照；Guinsoo/Phantom 不复制、不消费也不推进该 `copyable_on_hit=false` provider state。

Web 不增加专用逻辑。`combatDataAssembler` 将 item_3508 source equipment 的 state schema、numeric gate、物理公式、listener 与 ordered operations 原样投影到 namespaced `CompileRequest`；target loadout 不得误挂载该 provider，也不投影法力/资源效果。

## 4. 非目标

- 不实现法力回复、Spellblade unique-group 冲突、完整技能 rotation、同步 arm+on-hit 或多目标效果。
- 不执行 live migration、Admin publish 或浏览器对 live backend 的 E2E。
- 不把当前可表达的数值 gate 扩写成新的通用 ABI 扩展。

## 5. 验收

- Backend 静态 SQL 契约和全量 Maven 测试通过。
- TinyGo 精确数值、状态时序、快照与 phantom 回归通过，并完成 bench、Wasm build 和 Node smoke。
- Web lint、typecheck、Vitest、build 通过。
- G8 generator check 将精确 3508 候选重分类为 `migrated`，且 JSON/CSV 证据与 Planning task、Backend seed 一致。
- 更新 `task_rules.json` 后，rebuild/query 可解析本设计与验证记录。
