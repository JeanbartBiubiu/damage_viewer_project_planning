**VERDICT: READY**  
**REVIEWED_PLAN_REV: hero32-source-v1**

主核对说明与同包绑定正文、计算树、官方 16.17.1 数组及现存 29 项公共参数一致，按该说明录入不会把旧摘要、未消费字段或错误下标写成当前 1V1 组成。20 槽仍只有公共参数，没有本批候选或业务写入。

## 阻塞

无。

## 非阻塞补充

- 卡莎 W：`cooldownTime` 为 22/20/18/16/14，`Cooldown.values` 从等级 1（下标 1）起为 20/18.5/17/15.5/14，与官方和已存公共毫秒值一致；保留冲突即可，不要用前者覆盖。
- 霞 W：`BonusDamagePercent` 为 25，旧 `mEffectAmount` 仍留 20；正文消费的是 25。法力按数组 60/55/50/45/40，不能被 `manaValues` 回退 60 写成全级 60。
- 霞 R：正文不可选取 1.5 秒，数据 `RUntargetable` 为 1.25；按正文 1.5 并记下冲突。扩展规则已写明进入前效果仍可作用，不是全免疫。
- 霞 E：10% 下限只在扩展正文，没有对应 DataValue；19 根是 `MAX(0.1, 1-0.05×(序号-1))` 触底，不是根数上限。0/1/3/19/20 边界应保留。
- 泽丽 R：正文消费新星 `TotalActiveDamage`、自身 5 秒增益、Q 三连发、延长不超初始 5 秒、超负荷层 2.5 秒；`TotalBonusDamage`（5/10/15+.15AP）和旧摘要“伤害提升”未消费。`DurationIncreasePerHit`/`StackDuration` 同样未进正文，不能当已证延长量子。连锁 `@ChainPhysicalDamage@` 在正文里，但属于额外敌人分配，1V1 可排除。
- 泽丽 W 扩展文字写了暴击几率，过墙树只有 `1+0.5×(实际暴击伤害倍率-1)`；E 附伤树才有暴击几率项。
- 卡莎 E / 霞 E 的 `mDoesNotConsumeMana`、泽丽 R 的 `mDoesNotConsumeCooldown` 与已存基础费用/冷却并存；库奇 R `AttackRefund` 的 `mPrecision`、卡莎 E `TotalCastTime` 的 `mPrecision` 都是显示精度。
- 卡莎 E：移速树 `mStat4` 带 `mStatFormula: 2`，施法时长树省略该字段，不能都接额外攻速。
- 施法双字段冲突（卡莎 W 0/0.4、卡莎 E 0/1.5、泽丽 W 0/0.55、泽丽 R 0/0.25）及角色等级插值求值、`mStat8/9` 暴击口径，均无同包求值证据，保持待接，不默认。
- 本包未展开客户端 `.gz`；以上以绑定内嵌对象与官方 json 交叉核对。
