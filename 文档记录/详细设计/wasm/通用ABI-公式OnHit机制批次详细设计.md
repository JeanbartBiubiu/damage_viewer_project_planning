TASK_KEY: wasm-generic-formula-onhit-batch
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-13

# 通用 ABI 公式 On-Hit 机制批次详细设计

测试记录：[通用 ABI 公式 On-Hit 机制批次验证记录-2026-07-13](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)

## 契约

- 统一 listener：ALL-match `event/basic_attack_hit` + `event/source_owner`
- 对局：1v1
- `maxTriggers=1`
- live 属性键只用 `ad` / `ap` / `hp`；不使用 `attack_damage` / `ability_power`
- 不使用 `ability.param`；常量与公式直接进入 `provider_formulas`

## 六机制

1. **hero_kogmaw W 预开启 rank5**
   `magic = event.entry_target.attr.hp.max * 0.06`
   不建模主动开启、8 秒生命周期、射程。

2. **hero_teemo E rank5 即时**
   `magic const 65`
   不迁移 DoT；旧 seed 未含 AP 系数，不擅自补。

3. **item_3115 纳什**
   `magic = 15 + event.entry_source.attr.ap.resolved * 0.15`

4. **item_3302 界弓**
   `magic const 30`
   不含光暗交替、双抗、穿透。

5. **item_3181 破舰者**
   `provider_target` 每第五击
   `physical = event.entry_source.attr.ad.base * 0.84 + event.entry_source.attr.hp.max * 0.035`
   operation：`add counter` → `condition damage` → `condition reset 0`
   `0.84` / `0.035` 为远程补充近似；DataDragon 16.9.1 未给数值，不宣称版本精确。

6. **item_3748 巨九主目标**
   `physical = event.entry_source.attr.hp.max * 0.005`
   不含锥形 AOE / 主动刚斩
   `0.005` 为远程补充近似。

## Backend

前置：`hero_teemo` / `hero_kogmaw` 及 `basic_attack_hit`、四件装备实体均已存在；无 DDL。

允许写入仅：

- `db/game_manage/seeds/lol_formula_on_hit_mechanisms_seed.sql`
- `server/data_manage/src/test/java/xyz/game/datamanage/db/LolFormulaOnHitMechanismsSeedSqlTest.java`
- `server/data_manage/README.md`

seed 约束：单事务、candidate revision、material change 才推进、幂等、无 DELETE、不 publish。

预计约 68 行：6 provider、9 formula、1 state field、6 sequence、8 step、6 damage detail、2 state detail、6 listener、12 match type、6 listener-sequence、6 mount。

依赖链：reserved types → Batch B → Batch C → adc item on-hit seed → 新 seed → publish。

## 非目标与验证

- Wasm / Web 产品代码原则上不改。
- 验证必须覆盖：Backend 专用/全量测试；live DB rollback dry-run / 正式 / 幂等 / publish；六机制单件与组合 live compile / run / release。
- rank 固定与补充近似必须出现在 evidence。
