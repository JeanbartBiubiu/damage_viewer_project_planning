**VERDICT: READY**  
**REVIEWED_PLAN_REV: hero44-source-v1**

本批未业务写入。快照仅冻主体与 26 项公共冷却/法力，不声称业务、页面或战斗通过。已消耗冷却按索引 1 起、资源按索引 0 起，与官方 16.17.1 一致。DataValues 技能等级一律索引 1 起；索引 0 为未学槽，含负数/0 时长，禁止当 1 级。Cherry/ARAM 覆盖不用。插值与空断点不展开。

---

**1. illaoi_p 古神先知**  
当前消费：无公共参。可录：缺血治疗比例 `MissingHPPercentHeal=0.05`（5% 已损生命，自己）；触手消散 `TentacleDisabledLifetime=30s`。  
公式：`SpawnCD`=角色等级插值 18→7（算法未知，不展开 18 级）；拍击伤害引用 Q 的 `TentacleDamageTotal`。  
资格：自己治疗保留；同敌多触手衰减（二段 50%、其后 25%）保留。  
范围外：触手生成/自主拍击（召唤）。  
未知：插值曲线；「1 名以上」是否含恰好 1 名；地形生成密度/半径。

**2. illaoi_q 触手猛击**  
当前消费：冷却 10000–6000ms；法力 40–60。  
公式：`TentacleDamageTotal=(1+TentacleDamageAmp)×(插值9→180 + 1.1×总AD + 0.4×AP)`；Amp 1–5 级=10/15/20/25/30%（索引 1）。`DamageIncreaseTooltip` 插值 9→162，与主式不同，仅提示。  
资格：被动 Amp=自身强化；主动拍击=召唤输出，须拆开。  
范围外：召唤拍击过程。  
未知：插值；`mCastTime=0.75` 与 `spellCastTime=0.25` 冲突，不任取。

**3. illaoi_w 严酷训诫**  
当前消费：冷却固定 4000ms；法力固定 30。  
公式：`HealthPercentTotal=0.01×(HealthPercentDamage + 0.035×总AD)`，`mDisplayAsPercent`；1–5 级 HealthPercentDamage=3/3.5/4/4.5/5（百分点）。本体额外伤=目标总生命×该比例。下限 `WMinDamage`=20/30/40/50/60。R 期间冷却 `CooldownDuringR=2s`。  
资格：跃击+%生命=本体；附近触手拍击=召唤。  
范围外：野怪封顶 300；`mStat7` 冲刺速度无默认。  
未知：仅 `spellCastTime=0.25`（无 `mCastTime`）；强化窗 `BuffDuration=6` 未进主提示。

**4. illaoi_e 灵魂试炼**  
当前消费：无。可录冷却 16–12s、法力 35–55。  
公式：`EchoPercent=BaseDamageTransferPercent + 0.0008×总AD`（显示百分）；转移比 1–5 级=25/30/35/40/45%。拍击间隔断点可展开：1–6 级 4s，7–12 级 3.5s，13–18 级 3s。减速 80%、1.5s；灵魂 7s；躯壳 4s。  
资格：扯魂/标记/减速=本体控制；转移链与触手自动拍击另列。  
范围外：躯壳生成触手（召唤）；伤害转移链。  
未知：匿名 `{87aff6dd}`（5/4/3s 断点）未进提示；`EchoTADScalar` 为比例加算非再乘百分。

**5. illaoi_r 过界信仰**  
当前消费：冷却 120/95/70s；法力固定 100。  
公式：`DamageCalc=BaseDamage + 0.5×额外AD`；1–3 级基础=150/250/350。持续 8s；半径 500。  
资格：砸地物理伤=本体；自身 W 冷却改 2s=自身强化。  
范围外：每命中英雄生成触手（召唤+额外敌人）。  
未知：`mCastTime=0.5` 与 `spellCastTime=0.375` 冲突；「拍击变快 50%」无独立 DataValue。

**6. monkeyking_p 金刚不坏**  
当前消费：无。  
公式：`BonusArmor` 插值 6→10（未知）；满层提示=`BonusArmor×6`。每 5 秒（非每秒）回 `0.35%` 最大生命，满层提示 `2.1%`。最多 5 层、层持续 5s、`StackMultiplier=1`（提示「提升 100%」）。  
资格：自己护甲与生命回复；战前层数保留。  
范围外：非兵野专用（英雄或野怪都可叠，野怪触发不单列删除）。  
未知：插值；分身叠层是否计入本体；`cooldownTime=20` 未进提示（旧树排除）；`FallOffRate`/`CombatDuration` 未证。

**7. monkeyking_q 粉碎打击**  
当前消费：冷却 8–6s；法力固定 20。  
公式：`TotalDamage=BaseDamage + 0.5×额外AD`；1–5 级基础=20/45/70/95/120（索引 0 为 −5）。护甲削减 10/15/20/25/30%，3s。距离加成 135–175。命中缩 CD 0.5s。  
资格：本体强化普攻与同目标多次缩 CD 保留。  
范围外：分身复制该攻击。  
未知：`mCastTime=0.5` 与 `spellCastTime=0.25` 冲突；显示距离与 `AttackRangeBonus` 两套。

**8. monkeyking_w 真假猴王**  
当前消费：冷却 22–18s；法力 60–40。  
可录本体：隐身 1s；突进速度 900。  
资格：本体隐身位移保留。  
范围外：分身主体、分身伤害修正 `CloneDamageMod` 40–60%、分身持续 4s。  
未知：无 `mCastTime`，仅 `spellCastTime=0.25`。

**9. monkeyking_e 腾云突击**  
当前消费：冷却 10–7s；法力 30–50。  
公式：`TotalDamage=BaseDamage + 1×AP`（省略 `mStat`→窄证法强）；1–5 级基础=80/120/160/200/240。自己攻速 40/45/50/55/60% 百分点，5s。  
资格：主目标魔法伤与自己攻速=本体；同目标不另算额外敌人。  
范围外：至多 2 名额外敌人与分身模拟突进；`TotalDamageMonsters`。  
未知：无施法时间字段。

**10. monkeyking_r 大闹天宫**  
当前消费：冷却 130/110/90s（勿用索引 0/6 的 10）；法力固定 100。  
公式：每秒=`BasePercentMaxHPDmgPerSec + 1.375×总AD`，1–3 级生命比=4/6/8%；每跳 0.25s=每秒×0.25；全程 2s 总数=`tooltipOnly` 的 `TotalDamageTT`/`PercentHPDamageTT`（生命比 8/12/16% + 2.75×总AD）。移速 20%；击飞 0.6s；再施放窗 8s。  
资格：本体每秒/每跳/全程须分列；同敌多跳≠额外敌人；击飞保留。  
范围外：野怪全程上限 `MonsterCap`（200/400/600 可展开但兵野排除）。  
未知：匿名 `{26c20668}` 仅生命比显示。

**11. neeko_p 天生幻魅**  
当前消费：无。可录提示冷却 `PassiveCooldown=6s`。  
资格：无本体伤害。  
范围外：完整角色伪装/变形。  
未知：`MagicPen=0.2`、`MagicPenDuration=4`、`ChargeTime=2` 未进当前提示，旧树排除，不录入穿透。

**12. neeko_q 盛开花种**  
当前消费：冷却 9–7s；法力 50–90（勿用末位 85）。  
公式：首爆 `ExplosionDamage=ZoneDamage + 0.6×AP`，1–5 级基础=60/110/160/210/260；再爆 `SecondDamage=SecondaryDamage + 0.25×AP`=35/60/85/110/135。间隔 `RepeatDelay=0.75s`，最多再盛开 2 次。  
资格：同敌最多 3 段≠额外敌人。  
范围外：野怪 `MonsterBonus`。  
未知：`SlowAmount=40`/`SlowDuration=1` 未进当前提示，排除。

**13. neeko_w 两生花影**  
当前消费：冷却 16–12s；无消耗（无 mana 字段，不复用法力）。  
公式：第三击 `PassiveBonusDamageCalc=PassiveDamage + 0.6×AP`；1–5 级基础=30/65/100/135/170（索引 0 为 −5）。被动移速 10/17.5/25/32.5/40% 百分点、1s；主动移速 20–40%、3s；隐身 0.5s。  
资格：第三击、自己移速、隐身=本体。  
范围外：分身主体；野怪额外伤 75。  
未知：分身 `CloneDamageTimer=0.75` 属召唤。

**14. neeko_e 缠结倒刺**  
当前消费：冷却 12–10s；法力 60–80（勿用末位 60）。  
公式：`BaseDamage=Damage + 0.65×AP`；1–5 级基础=70/105/140/175/210。最短禁锢 0.7/0.9/1.1/1.3/1.5s；强化后 1.8/2.1/2.4/2.7/3.0s。  
资格：首目标伤害与禁锢保留；控制链保留。  
范围外：额外敌人分配。  
未知：摘要「击杀或穿过英雄」与提示「命中敌方英雄后强化」冲突；`BaseRootDuration` 未进提示。

**15. neeko_r 怒放**  
当前消费：冷却 120/105/90s；法力固定 100。  
公式：`TotalDamage=Damage + 1.2×AP`；1–3 级基础=150/350/550（索引 0 为 −50）。击飞用 `DelayUntilExplosion=0.6s`（非 `Duration=2.5`）；晕眩 0.75s。  
资格：本体范围伤与控制；SelfAoe 伤的是敌人。  
范围外：无。  
未知：`BaseShield`/`ShieldMultiplier`/`SlowAmount` 未进当前提示，排除不猜自己护盾；无 `mCastTime`，`spellTotalTime=0` 不与冲突字段对打后任取。

**16. yuumi_p 猫的博爱**  
当前消费：无。  
公式：`HealAmount`=插值 20→110 + 0.3×AP（插值未知）；`PassiveCooldown` 1 级 20、每级 −1，14 级空断点（斜率是否停止未证，不展开）。延迟 `HealDelayTime=4s`。  
资格：击中英雄时**自己**治疗保留。  
范围外：4s 内附身则友军同获治疗；已附身自动触发的友军治疗；友谊值/附身目标；补兵友谊。  
未知：匿名 `{656dde8a}`=50 常数未进提示。

**17. yuumi_q 摸鱼飞弹**（6 级）  
当前消费：冷却固定 6500ms；法力 50–75。  
公式：`TotalMissileDamage=MissileDamage + 0.2×AP`，1–6 级基础=60/95/130/165/200/235；强化 `EmpoweredMissileDamage + 0.3×AP`=80/135/190/245/300/355。减速 20% 百分点；强化减速 50–65% 百分点、2s。  
资格：本体飞弹伤与减速（未附身/附身可控弹道仍是本体伤）。`spellCastTime=0` 为单字段明示，非冲突任取。  
范围外：挚友 OnHit `OnHitDamageCalc=OnHitBase + 0.05×AP`、暴击增幅 75%（第三友方）。  
未知：未强化减速时长提示未写 `SlowDuration=1`。

**18. yuumi_w 悠米出动！**  
当前消费：无（官方/客户端技能冷却皆 0；真实间隔是 `AttachCooldown`）。  
公式：附身间隔断点可展开：1–5 级 10s，6–10 级 5s，11–18 级 0s。自己 HSP `HealAndShieldPower` 1–5 级=4/5/6/7/8%（比例）。`HealthOnHit=BaseHealthOnHit + 0.03×AP`，基础 3–7。定身封锁 5s。  
资格：提示写明**悠米自己**获治疗护盾强度（附身挚友时）。突进附身是否算可独立位移：主动目标是友军，附身选择排除，不把 DashSpeed 当已证自己位移收益。  
范围外：附身目标选择；友军 OnHit 治疗。  
未知：`Min/MaxBonusHealShieldPower` 未进提示；`spellCastTime=0`。

**19. yuumi_e 旺盛精力**  
当前消费：法力 80–120；**无冷却**（客户端无 `cooldownTime`，有弹药回复 18–14s，与官方 10s 冲突，不任取 0 或 10）。  
公式：`TotalShielding=BaseShielding + 0.4×AP`，1–5 级基础=65/90/115/140/165；`TotalAttackSpeed=AttackSpeedAmount + 0.08×AP`（百分点 25–35）；移速 20% 百分点、3s（护盾存留时）。  
资格：未附身且 `Self`：**自己**护盾/攻速/移速。提示「附身则**转而**影响友军」——附身时自己不吃，证据是「转而」而非仅「友军」一词。  
范围外：附身态护盾/攻速/移速/回蓝（第三友方）；`ManaRestore`/`MaxManaPercIncrease`。  
未知：弹药上限全 0 与回复数组并存，实际冷却机制未证。

**20. yuumi_r 魔典终章**  
当前消费：冷却 120/110/100s；法力固定 100。  
公式：每波伤 `TotalMissileDamage=BaseMissileDamage + 0.25×AP`，1–3 级=75/125/175；同敌后续波×0.25；全程同敌 `TotalSingleTargetDamage=每波×(1+4×0.25)=每波×2`（5 波，非额外敌人）。每波治疗 `TotalHealPerWave=BaseHealPerWave + 0.12×AP`=30/50/70。5 波、波间隔 0.75s、引导 3.5s；3 波后禁锢 1.25s。减速字段为有符号比例（`BaseSlow=-0.1` 等）。  
资格：本体每波/同敌全程伤与控制保留。  
范围外：`EnhancedHealPerWave`/`AllyHealingPerc` 友方加成。  
未知：基础每波治疗受益者（自己或仅友方）须靠提示指认，不凭 Boon/Heal 标签判断自己；`AllyHealingPerc` 13 级空断点不展开；`MissileSlowPercent`/`BaseSlow`/`BonusSlowPerWave` 哪条进当前减速未在已读计算名中钉死；`spellCastTime=0`；超额护盾持续 1.5s 未证进提示。
