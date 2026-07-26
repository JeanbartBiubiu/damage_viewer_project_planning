TASK_KEY: wasm-generic-batch-c-adc-items
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-12

# 通用 ABI Batch C ADC 成装静态属性闭环详细设计

验证证据：[通用 ABI Batch C ADC 成装静态属性闭环验证记录](../../测试记录/wasm/通用ABI-BatchC-ADC成装静态属性闭环验证记录-2026-07-12.md)

## 1. 范围

本任务把 `最小验证/V2-Batch-C-adc-items.seed.json` 的 53 件 ADC 相关成装和 151 条非零静态属性迁入 generic combat-data，并让 Web 通用验证页能把最多 6 件装备的静态属性聚合到 source combatant。

本任务不实现装备被动。破败、海妖、鬼索的 provider/listener/effect 机制属于后续独立任务。

## 2. Backend 数据契约

- 装备实体：`item_<numericId>`，共 53 个 `game_entities`。
- 静态属性：直接映射源 `statModifiers`，共 151 个 `entity_attribute_values`，不补零。
- 游戏内 type：`type_id=62002`、`type_key=tag/adc_completed_item`、`reserved_type_id=NULL`。
- 关系：53 条 `type_relations`，`target_category=entity`、`target_id=item_<id>`。
- `extend` 保存 batch、role、source/sourceVersion、sourceItemId/sourceTags、goldCost、iconUrl、statKeys 和 selectionRule。
- 源 16 个属性 key 必须已有 definition；缺失即回滚，不在本批静默改写语义 key。

live compatibility 允许且只允许升级已知占位：`62002 / type/62002 / name=adc_completed_item / reserved=NULL`。迁移时精确删除同一 type 下、源 53 个数字 item id 的 legacy `equipment` 关系，再写入最终 `entity/item_<id>` 关系。未知 type 冲突或未知 relation 不清理。

revision 采用锁定 `game_data_state` 后的候选 revision；只有 type、entity、attribute、relation 或精确 legacy cleanup 实际变化时推进。seed 不自动 publish。

## 3. Web 聚合契约

`CombatDataAssembleSelection` 支持 `sourceEquipmentEntityIds?: string[]`：

1. 只通过精确 type key `tag/adc_completed_item` 和 entity relation 识别装备。
2. 最多 6 件、不可重复，必须存在且已打 tag。
3. source/target combatant 不允许选择 tagged item；页面也从 combatant 下拉排除装备。
4. 聚合顺序：英雄 base/stage → 装备 `entity_attribute_values.baseValue` 求和 → numeric overrides。
5. 已有属性对 base/current/max/resolved 同步加值；新属性创建四个相同值。
6. 装备的 stage、type、resource、provider mount、ability、listener 和 passive 均不合并。
7. 本批合同仅支持 source loadout；target 侧装备投影不在本批范围。后续贾修（`item_6665`）合同另增 union-tagged target-loadout 路径，**不**改变本批 source-side 静态聚合范围。

百分比和固定值都按 DB 原值直接相加。例如薇恩 18 级 `attack_speed=1.027138` 加破败 `0.25` 后为 `1.277138`。

## 4. 关键锚点

- `item_3124` 鬼索：AD 30、AP 30、攻速 0.25。
- `item_3153` 破败：AD 40、攻速 0.25、生命偷取 0.1。
- `item_6672` 海妖：AD 45、攻速 0.4、移动速度比例 0.04。

这些只代表静态属性，不代表被动已实现。

## 5. 验证要求

- Backend 专用测试从源 JSON 对比 SQL 全集，验证 53/151/53、16 keys、兼容 cleanup 和幂等边界。
- Backend 全量 Maven 测试。
- live DB rollback dry-run、正式执行、原脚本重跑、publish 与 Public API 回读。
- Web lint/typecheck/unit/build。
- 浏览器确认 53 件装备、item 不进入 combatant 选项、属性数值、2 combatants、不带 item provider，以及 compile/run/release。
