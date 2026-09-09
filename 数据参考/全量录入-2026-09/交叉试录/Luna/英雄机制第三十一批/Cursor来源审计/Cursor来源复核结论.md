**VERDICT: READY**  
**REVIEWED_PLAN_REV: hero31-source-v1**

来源包未给缺值字段造默认，也未把本批须留的 1V1 机制打进无关项。`来源与范围.json` 的措辞不构成阻塞；以下只列有字段/正文依据、候选必须写死的边界。

### 无实际阻塞
`MSPercentSelf`、`EmpowerPercent` 仅有名无 `values`，范围已标未知。其余复核点在绑定正文、计算树和同版官方中英文里都有对应原字段。

### 候选必须明确保留

**迦娜 P / W**  
- `MSPercentSelf` 禁造默认。自身移速在 W 的 `TotalMS`（`MSPercent`+`MSAPRatio`），不在 P。  
- P 的 `BonusDamage` 是 `mStat:7` / `mStatFormula:2` × `MSBonusMagicDamage`（0.3）。W 正文为 `@TotalDamage@ + @spell.TailwindSelf:BonusDamage@`，与官方 `{{ totaldamage }} + {{ spell.tailwindself:bonusdamage }}` 一致。W 的 `TotalDamage` 只有 `BaseDamage`+`APRatio`，不含 P。普攻走 P；W 是 W 树再加同一条 P。禁止把 P 并进 W 树（普攻会漏，或 W 会重复）。能表达 `mStat:7` 不代表普攻/W 命中已接线。

**迦娜 Q / E / R**  
- 三棵伤害树都在：`MinimumDamage`（`MinDamage`+`MinimumRatio`）、`ExtraDamagePerSecondCharged`（`BonusDamage`+`BonusRatio`）、`MaxDamage`（最小 + `MaxDuration`×每秒）。`MaxKnockup` 的 `mPrecision:2` 只是显示精度。`MinionMod` 可排除。  
- E 保留 `TotalShield`、`TotalAD`、`ECDRefundforCC`（0.2）。`EmpowerPercent` 禁造默认。自身施放未证排除。  
- R 保留 `HealPerSecond` 与 `TotalHeal`（`Duration`×每秒，`tooltipOnly`）。`Duration` 为 `[0,3,3,3,0,0,0]`，技能等级必须走 index 1，否则满蓄/持续治疗会变成 0。自身在「附近友军」内。

**璐璐**  
- P：宿主普攻时向**同一目标**发射 `NumberOfBolts=3`，`CombinedDamage`=`NumberOfBolts`×`TotalDamage`。来源没有独立攻速/AI 周期，不能仅凭名称做成自主召唤，也不能丢掉同目标弹体。  
- Q：`BonusMissileDamage`=`DoubleHitBonus`(0.5)×同一套伤害，正文是「两束都命中**相同**一名敌人」。这是同敌第二次修正，不是额外敌人；可排除的只有 `MinionMod`。  
- W：对敌 `CCDuration` 变形，附加正文里的沉默/缴械/`SlowAmount`。这是控制，与用户排除的完整角色技能替换分开。自身移速/攻速与对敌控制都留。  
- E：`TotalDamage` 与 `TotalShield` 分树。R：`TotalBonusHealth`、击飞、`SlowPercent`。自身施放未证排除，不得预先拿掉自盾/自 R。

**娜美**  
- W 正文与官方中英文同一句：**每个目标只会被弹到一次**，`MaxTargets=3`。`TotalDamage` / `TotalHeal` 是各自首跳基准，`BounceScaling` 是每跳修正根树（`BounceRatio`+`BounceRatioScaling`）。仅自己+唯一敌人时最多两跳：点自己为疗→伤，点敌人为伤→疗；第二次才乘 `BounceScaling`。禁止把三人三跳总伤/治疗当 1V1。范围里的「同一目标多跳」不得理解成同一人可再命中。客户端根对象无 `cooldownTime`，冷却只用官方 `[10,10,10,10,10]`，不补 7 槽缺省。  
- P：`TotalMSBonus`、`UltMult=2` 保留。自施放命中友方（含自己）与 R「双倍踏浪」在 R 正文，触发事件未接线但不删字段。  
- E：`HitCount=3`、`TotalDamage`、`TotalSlow` 保留。`AoEMod` 非英雄可排除。自身施放未证排除。

**莫甘娜**  
- P：`HealPercent=18`，正文是技能对英雄/大型兵/中大野的**实际伤害**的百分比；1V1 留英雄。无治疗计算树，不造直接治疗量。  
- W：`TotalMinDamage` / `TotalMaxDamage`（`(1+MissingHealthAmpPercent)×min`，amp=1）、`WDuration=5`、`CDRefundPercent=0.05`（**P 治疗返还自身 W 冷却**）都留。`MonsterMod` 可排除，不能把 P↔W 冷却返还一起丢掉。`TickRate=0.5` 与「每秒」口径未接线，不把每秒树直接当 tick。  
- E：`Trait_Shield`+`Trait_CCImmune`，正文是持续魔法护盾并阻挡限制/定身直至打破，不是单次技能法术护盾。`mAffectsTypeFlags=1`，自身施放未证排除。  
- R：同一 `TotalDamage` 用两次 + `ChainDuration=3`；施放获得 `HastePercent` 移速。`HastePercent[0]=0`，必须走技能等级 index 1。

### 索引（交叉官方数组后）
冷却：`clientCooldown` index 1–N 对齐官方 5/3 段（如璐璐 R `[120,100,80]`、莫甘娜 R `[120,110,100]`、迦娜 W `[8,7.5,7,6.5,6]`）。  
法力：常为 index 0–N 对齐官方（迦娜 R `mana[3]=0`，误用 index 1 会把 3 级打成 0）。  
官方 `effect[]` 大量为 0/旧值（如娜美 E），不以它覆盖客户端 `DataValues`。Cherry/ARAM 覆盖不是峡谷默认。
