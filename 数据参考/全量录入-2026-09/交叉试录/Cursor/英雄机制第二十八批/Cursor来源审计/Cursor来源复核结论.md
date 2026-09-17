**VERDICT: READY**  
**REVIEWED_PLAN_REV: hero28-source-v1**

客户端 16.17 / 官方 16.17.1 绑定一致。五项均有当前正文或计算树证据，核对说明没有把未知等级算法、资格或过程写成不相关。

**核对要点**

1. **MaokaiQ**：`TotalDamage` 只有 `BaseDamage + APRatio`；正文是 `@TotalDamage@外加@BasePercentHealth*100@%最大生命值`。等级 1–5 的生命比例为 2/2.5/3/3.5/4%。不能只存基础树。

2. **MaokaiE / R**：E 带 `Trait_Pet`/`Trait_Trap`，树苗伤害与过程按独立召唤排除；额外 4 秒 P 冷却只在正文、不在 E 的 DataValues，须作为自身跨技能收益保留，无树苗过程则待接。R 无宠物标签，荆棘墙是行进伤害载体，应保留；`RootDuration` 0.6 无正文消费，禁锢端点仍是 0.75–2.25。

3. **PoppyQ**：正文两段都是 `@BaseDamage@` + `@HealthDamagePercent@%最大生命值`，间隔 1000ms，同一敌人可加总，不因 `Trait_AoE` 排除。减速为 `.2/.23/.26/.29/.32 + 0.00008×来源额外HP`（`mStat` 12、`mStatFormula` 2）；范围内减速与尾段 500ms 须分开，不能当成覆盖整段 1000ms。

4. **PoppyW**：被动双抗树为 `mStat` 1 / 6，`mStatFormula` 省略；低于 `PassiveEmpoweredHealthPercent`（40%）时正文写明翻倍。取值基准和自增反馈未证，只能用应用前双抗，不能凭 `BonusArmor` 名称当成额外护甲。击飞 500ms 无当前正文消费，须与缚地/减速/打断伤害分开。

5. **PoppyE / R**：`TackleDamage`、`HalfDamage` 虽为 `tooltipOnly`，当前正文仍消费。E 撞墙追加同一 `@TackleDamage@`（不是第二名敌人）；R 点按是完整 `Damage × 0.5`。这两式必须保留。

未知完整等级求值、资格、行进/蓄力曲线、树苗外供事件仍为待接。接口已支持 `CURRENT`/`MISSING` 等，低血阈值不必再限制成旧的 BASE/BONUS/TOTAL。

**阻塞：** 无。

**非阻塞建议：** 后续候选不要用 LevelUp 里的 `WallDamage` 替换 E 正文两次消费的 `TackleDamage`；Q 的 `TotalPercentHealth` 只是比例展示，真正补伤是正文中的目标最大生命比例。
