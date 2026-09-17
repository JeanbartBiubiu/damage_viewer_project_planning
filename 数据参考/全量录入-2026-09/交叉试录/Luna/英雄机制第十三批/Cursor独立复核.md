# Cursor独立复核

实际SDK运行已完成，主负责人核对2384条事件、86次完成工具调用与文件前后散列，全部为只读且无改动；候选版本一致。原事件文件仍保留在忽略目录，散列和位置见对应JSON。本次不含业务写入或战斗验收。

**VERDICT: READY**

`REVIEWED_PLAN_REV` = `247eeb25c0f1c0b5448fabd16512d9c7b2632660fc08f3cd67bac0d9335c5ff0`（`参考资料/完整候选.json` SHA256 一致）。只读冻结资料，未改文件、未调业务 API、未联网换源。

## 阻塞项

无。本批冻结候选在已核原树、中文绑定和 1V1 范围内，没有把未证算法、未证资源枚举或未接线资格写成可录入确定组成。

## 有证据的核对（与正确性/录入直接相关）

**阿卡丽能量不是法力。** Q/E 写成 `energy_cost` + `RESOURCE_CHANGE`/`energy`/`CONSUME`（110–70 与 30），W 官方 cost 全 0 且 `officialResource` 为「回复能量」，只做能量回复与最大能量增加，R 官方「无消耗」不造 0 资源效果。正文与 `keyCost` 均写「能量」，未把根字段 `manaValues` 当成法力。

**阿卡丽 Q 的 AD 口径冲突已保留。** 当前 `Damage` 树：`tADRatio` 为 `StatByNamedDataValue`、`mStat: 2`、无 `mStatFormula`（默认 0）→ 总 AD。短摘要/官方简述写额外 AD。候选公式用总 AD，pending 记录冲突。区别值：等级 1、总 AD 200、额外 AD 50、AP 100 → `45 + 0.65×200 + 0.6×100 = 235`，与原树 `sourceValue ≈ 234.9999976` 一致；若误用额外 AD 会得到 137.5。

**阿卡丽 R 低于 30% 最大支独立，中间曲线未猜。** `Cast2DamageMax` 仅为 `Cast2DamageMin × 3`。等级 1、AP 100：最低 `70+0.3×100=100`，最高 300。`MaxExecuteThreshold=0.3` 只作「严格低于」边界参数，未写入线性已损生命公式。

**卡萨丁 R 层数与资源未默认满层/0/最大法力。** `AbilityResourceByCoefficient` 无具名口径，外供 `confirmed_ability_resource_0_value`，系数 0.02/0.01。层数 `actual_prior_cast_stacks` 为运行时输入。测试输入资源 1500、层数 2、AP 100、等级 1：首发 `70+50+30=150`（若用最大法力 2000 会是 160），完整伤害 `150+2×57=264`，法力 `40×4=160`（不是 40 或 640）。翻倍成本用 0–4 有限域二元展开，未把 `RManaRatio=2` 猜成最大法力。

**瑞兹 Q/W/E 额外法力仅交叉证明。** P 正文「基于额外法力值」且当前节点 `mStatFormula: 2`，映射为 `mana.BONUS`；卡萨丁同类节点未扩推。Q 涌动增幅外供，不默认已学 R/满级/Q 内旧 `DamageAmp`。R 的 `OverloadHealPercent` 未复活。

**卡西奥佩娅 E 治疗链与短摘要冲突已记录。** `HealCalc` 仅为 AP×`HealRatio`（等级 1 为 0.1，不是无 values 的 `HealingRatio`，也不是按伤害治疗）。AP 100 等级 1 → 10，等级 5 → 16。未创建 `DIRECT_HEAL`。Q/W 中毒与 R 朝向只 pending，无自动中毒/朝向效果。

**断点/插值未展开。** 无 18 级 `levelValues`、无 `CHARACTER_LEVEL`。阿卡丽 P 伤害把断点整项外供；测试用 `empowered_attack_damage_level_value=100` 得到 `100+0.6×50+0.55×100=185`，没有用 `mLevel1Value=35` 去填 1–18。卡西奥佩娅 P `0.06`/`0.02` 与 E 基础伤害 `52`/`4` 同样外供。公式节点仅 `PARAMETER`/`ATTRIBUTE`/`OPERATION`（含已证的 `ADD/MULTIPLY/MAX/SUBTRACT`）。无默认 `DAMAGE`、无瞬时周期治疗、无空过程（`processes=0`）。

当前绑定治疗树没有再截断上限；`poison_heal` 名称是「自身恢复量」而非「最终治疗」，小兵分支是 `HealCalc×0.25`，不是把未截断量标成最终治疗。

## 非阻塞建议

- 卡萨丁 R 的 `MaxStacks=4` 只写在输入约定里，没有 `MIN(层数, max_stacks)` 进 `actual_damage` / `actual_mana_cost`。越界被禁止，且未标成最终治疗；若以后要把「上限进最终量」做成硬约束，再把该 `MIN` 写进这两条公式。
- 阿卡丽能量描述写了「官方 partype」，冻结 JSON 里能直接看到的是中文「能量」、`officialResource` 和根 `arType: 1`，没有 DDragon `partype` 字段原文。录入口径仍是能量，不是法力。
- 卡萨丁 R 完整复用原 `mana_cost=40`，同时又新增 `base_mana_cost` 与按层数消费的效果。写入时不要让静态 40 和动态公式各扣一次。
- 瑞兹 R 把传送的 `mana_cost`/`cooldown_ms` 留在复用快照里，但本批不创建传送过程；父流程按「完整复用、不写范围外主动过程」处理即可。
