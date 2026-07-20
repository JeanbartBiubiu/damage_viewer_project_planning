TASK_KEY: wasm-generic-adc-item-passives-base
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-12

# 通用 ABI ADC 装备基础 On-Hit 被动闭环详细设计

验证证据：[通用 ABI ADC 装备基础 On-Hit 被动闭环验证记录](../../测试记录/wasm/通用ABI-ADC装备基础OnHit被动闭环验证记录-2026-07-12.md)

## 1. 范围

本批在 Batch C 的 53 件静态装备之上，接入三件装备的基础 on-hit provider：

- `item_3153` 破败：监听器执行时目标当前生命值的 6% 物理伤害。
- `item_6672` 海妖：每第 3 次 owner 普攻命中造成 `120 * (1 + missingHpRatio * 0.75)` 物理伤害并重置计数。
- `item_3124` 鬼索首批：每次 owner 普攻命中造成固定 30 魔法伤害。

本批不把近似口径描述为游戏完全一致：基础普攻先结算，再派发 `event/basic_attack_hit`，所以破败和海妖读取的是基础普攻伤害之后的 HP。generic damage pipeline 当前也未应用护甲/魔抗；本批只证明触发、公式、状态、组合装配与零抗性数值闭环。

完整鬼索的叠攻速、持续时间、满层和 phantom hit 属于后续独立任务。

## 2. Backend 数据契约

实现文件：

- `db/game_manage/seeds/lol_adc_item_on_hit_passives_seed.sql`
- `server/data_manage/src/test/java/xyz/game/datamanage/db/LolAdcItemOnHitPassivesSeedSqlTest.java`
- `server/data_manage/README.md`

seed 前置校验：

1. `lol`、`game_data_state` 与所需 reserved types 存在。
2. `item_3124`、`item_3153`、`item_6672` 已由 Batch C 写入。
3. Batch B 六个 ADC 的 basic attack provider、ability、phase、sequence 和 damage step 完整存在。
4. `hp` attribute definition 存在。

三件装备各自拥有独立 provider、listener、effect sequence 和 item entity mount。listener 使用 ALL matcher：

- `event/basic_attack_hit`
- `event/source_owner`

海妖复用 provider-target state：

1. `kraken_hits += 1`
2. `kraken_hits >= 3` 时执行伤害
3. 同条件下将 `kraken_hits` override 为 0

missing HP 公式使用安全分母与 clamp：

```text
missingHpRatio = clamp((maxHP - currentHP) / max(maxHP, 1), 0, 1)
damage = 120 * (1 + missingHpRatio * 0.75)
```

为避免装备被动只在薇恩可用，本 seed 还为 Batch B 六个 ADC 的基础普攻伤害序列追加统一 `step_order=1` 的 `emit_event(event/basic_attack_hit)`。薇恩已有稳定 ID 时执行幂等 upsert。

revision 采用 `FOR UPDATE` 锁与候选 revision；只有业务数据实际改变才推进，不自动 publish，不 DELETE。

## 3. Web 装配契约

实现文件：

- `web/src/engine/combatDataAssembler.ts`
- `web/src/engine/combatDataAssembler.test.ts`
- `web/src/pages/WasmValidationGenericPage.tsx`

`sourceEquipmentEntityIds` 仍执行最多 6 件、唯一、实体存在和精确装备 tag 校验。装配顺序为：

1. source 英雄自身 `entity_provider_mounts`
2. 按装备选择顺序收集所选装备的 `entity_provider_mounts`
3. 按 provider ID 去重并挂到 source combatant

target 不接收 source equipment mount；未选择装备时行为不变；未选中的装备 provider 不进入 compile request。provider definition、formula、listener 与 operation 继续走现有 slot namespacing 和 `cloneProviderForSlot` 投影。本批仍为 source-side on-hit 范围；后续贾修（`item_6665`）合同另增独立的 union-tagged target-loadout / target-owned provider 路径，**不**改写本批历史 source-side 装配合同。

装备仍不是第三个 combatant，也不合并装备 stage、resource 或 type。页面文案明确区分“配置了 provider 的装备”和“仅有静态属性的装备”。

## 4. 当前语义边界

### 4.1 HP 读取时点

基础攻击 damage operation 在同一 execution frame 中先提交，pending hit event 随后派发 listener。当前公式禁止读取 `event.*` / `history.*`，因此不能取得 legacy `attack_start` HP 快照。

后续精确化应为 emitted event 提供只读的发出时属性快照，或提供等价的 event formula read path；不应把装备逻辑塞进基础攻击，也不应为迁就破败而重排所有 listener。

### 4.2 抗性结算

generic damage pipeline 当前按 raw amount 扣 HP，physical / magic / true 主要作为伤害标签；护甲、魔抗及穿透尚未接入。因此本批浏览器数值只按 raw damage 验证。

后续应先补 physical / magic / true 抗性结算和证据字段，再宣称真实装备伤害闭环。

### 4.3 完整鬼索

完整鬼索还依赖：

- provider state 驱动的攻速 modifier
- modifier 求值时的 provider context
- 动态攻速对 driver cadence 的影响
- phantom-hit copyable scope、非递归与不推进特定计数的规则

这些能力不与本批基础 +30 魔法 on-hit 混合实现。

## 5. 验证要求

- Backend 专用静态 SQL 测试与全量 Maven 测试。
- live DB rollback dry-run、正式执行、原脚本重跑、publish、Public API 回读。
- Web lint、typecheck、unit test、production build。
- 浏览器选择薇恩 18 级、三件装备与坦克假人，确认 10 providers、3 次普攻、warning 0、compile/run/release 成功。
- 对外结论必须注明 post-basic-attack HP 与 raw damage 两项边界。
