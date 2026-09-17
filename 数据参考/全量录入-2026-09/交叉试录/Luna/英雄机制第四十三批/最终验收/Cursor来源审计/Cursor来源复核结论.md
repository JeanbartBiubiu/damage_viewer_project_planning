**VERDICT: READY**  
**REVIEWED_PLAN_REV: hero43-source-v1**

客户端 16.17、官方 16.17.1。24 公共冷却/法力已与根绑定索引一致，仅作保护，不视为技能写入完成。未保存，不声称业务/页面/战斗通过。技能等级 DataValues/冷却取索引 1；资源消耗取索引 0。mStat2+formula2=额外攻击力；省略 formula=总攻击力；mStat12 省略 formula=最大生命（窄证）。mPrecision 仅显示精度。

---

**普朗克 P 烈火审讯**  
可录：`TotalDamage`=插值下 50 / 上 250 + **1.0×额外AD**（mStat2/formula2，`ADRatio=1`）；`DoTDuration=2.5s` 为**全程总和**非每跳；`MoveSpeed` 比例下 0.15 / 上 0.30（`mDisplayAsPercent`，展示 15%–30%），`MoveSpeedDuration=2s`；被动冷却 `Cooldown=15s`（当前消费）。  
未知：插值算法，不可线性化 18 级。无施法时间。  
范围外：防御塔 `TurretDamageMult=0.5`。樱桃冷却 10 不录。

**普朗克 Q 枪火谈判**  
可录：冷却 4.5s（4500ms 已复用）；法力 50/45/40/35/30（索引 0）。`ShotDamage`=`SpellDamage` 10/40/70/100/130 + **1.0×总AD**（mStat2 省略 formula）。`ShotCrit` 当前消费（扩展树），保留为修正树。  
未知：主提示 `{{…_@GameModeInteger@}}` 未展开，不以 gzip 补句；`mStat9` 暴击乘区未证；无 `mCastTime`，**不得作瞬发**。`ManaRefundPercent` 无值。  
范围外：`GoldProc`/`SSProc`、银蛇币与金币统计。

**普朗克 W 坏血病疗法**  
可录：冷却 22/20/18/16/14s、法力 60/70/80/90/100（已复用）；`mCastTime=0.25s`。`BaseHealth`（tooltipOnly 且当前消费）=`BaseHeal` 45/70/95/120/145 + **0.9×法强**（省略 mStat 窄证 AP）；`PercentHeal=13` 为**已损失生命百分点**（`@PercentHeal@%`），非 0.13。  
未知：已损失生命选择器；`mStat15` 仅 Bot 树，单列未消费。`BuffDuration_unused`/`SteroidAmount_unused` 不录。

**普朗克 E 火药桶**  
按陷阱跳过：放置物、连锁爆炸、桶伤、桶减速、生命衰减、充能弹药。不按英雄名清空槽，但本槽无独立本体伤害/治疗/位移可录。`BarrelEnemyGoldBounty` 经济排除。`BarrelDecayTime` 断点（7/13 级）属桶系统，不录。

**普朗克 R 加农炮幕**  
可录：冷却 160/140/120s、法力 100（已复用）；`mCastTime=0.25s`。单波 `OneWaveDamage`=`DamagePerWave` 40/70/100 + **0.1×法强**；`TotalDamageTooltip`=单波×`TotalWavesTooltip=12`（**全程总和**，非每秒）；`ZoneDuration=8s`、`SlowPercent=30` 百分点、`SlowDuration=0.5s`。死亡之女（当前敌）：`DeathsDaughterDamage`=120/210/300+**0.3×法强**，减速 75%×1s。文本明示额外 6 波可保留为升级分支。  
未知：8s/`CannonInterval=2`/`CannonDelay=0.5` 与 12 波关系，不编跳数/DPS。  
范围外：鼓舞士气友军移速；纯商店经济。

---

**千珏 P 千珏之印**  
可录战前层数（勿与经济掉落混同）：`InitialMarkThreshold=4`、`AdditionalMarkThreshold=3`；`RangeIncrease=25`；`QMarkBonus`（tooltipOnly 已消费）每层 **0.05 且 displayAsPercent=5%攻速**；`WMarkBonus` 每层 **0.01→1%当前生命**；`EMarkBonus` 每层 **0.005→0.5%已损失生命**。  
未知：匿名 `{d34fc902}`=`RangeIncrease×FirstTierMultiplier(3)` 与 `@FirstTierRangeIncreaseTT@` 未证同名。`BaseHealAmount=45`、`HealAmountPerLevel=2` 未消费。`EDamagePerMark=0.5` 未被 E 公式使用。  
范围外：野怪狩猎流程/野区专用说明。

**千珏 Q 乱箭之舞**  
可录：冷却 9s、法力 35（已复用）。`TotalDamage`=`BaseDamage` 40/65/90/115/140 + **0.75×额外AD**；`TotalQAttackSpeed`（tooltipOnly 已消费）=0.35 + 印记×0.05（displayAsPercent）；`BaseASDuration=4s`；W 内冷却 `CDNewValue` 4/3.5/3/2.5/2s。位移保留。  
未知：**`mCastTime≈0.01` 与 `spellCastTime=0.25` 冲突，不任取、不冒充瞬发。** 至多 3 名敌人中额外目标分配排除，只录当前唯一敌人。

**千珏 W 狼灵狂热**  
可录自身：冷却 18/17/16/15/14s、法力 40（已复用）；`AttackHeal` 纯加法断点 1 级 47、每级 +2，18 级 **47–81**（至多治疗；已损失生命折算未知）；`ZoneDuration=8.5s`。仅 `spellCastTime=0.25`，无 `mCastTime`，不作冲突瞬发。  
跳过：狼灵自主攻击 `BaseWolfDamage`/`PercentWolfDamage`、`{fe248f68}`（mStat13 未证）、野怪加成/减速。`LambToWolfAttackSpeedConversionPercent=0.25` 属狼咬频率，跳过。

**千珏 E 横生惧意**  
可录：冷却 14/12.5/11/9.5/8s（已复用）；官方消耗 0，`manaUiOverride=50` 不作实耗。`BaseBiteDamage` 加法=80/110/140/170/200+**1.0×额外AD**；`PercentBiteDamage`=0.05+印记×0.005（displayAsPercent，precision 1）为**已损失生命比例**；`TotalSlow`=30 百分点 + **0.05×法强**；`SlowDuration=1s`、`TotalDuration=4s`。仅 `spellCastTime=0.25`。  
未知：乘区 `mStat8/9` 暴击未证，不猜；`CritDamage` 树未在主提示消费，单列。  
范围外：`MonsterCap` 野怪上限。

**千珏 R 羊灵生息**  
可录当前双方：冷却 160/140/120s、法力 100（已复用）；`BuffDuration=4s`；赐福结束治疗 `HealFlat` 225/300/375；文本 10% 生命地板。仅 `spellCastTime=0.25`。  
范围外：第三友方、中立单位治疗。`mCoefficient` 0.22/0.33 无名未证。无 `mSpellCalculations` 伤害树。

---

**纳亚菲利 P 狂烈种群**  
跳过犬群生成/自主攻击/召回输出（`PackmateTotalDamage`、狂暴乘区、数量/冷却断点）。  
未消费：`HealthRegenDelay=5`、`HealthRegenPercent=0.25`。  
范围外：兵野处决、野怪/防御塔修正、视野外群体承伤。AOE 断点有 16 级空断点，不可线性化。

**纳亚菲利 Q 暗裔犬牙**  
可录本体：冷却 9/8.5/8/7.5/7s、法力 50/60/70/80/90（已复用）；`mCastTime=0.25s`（展开对象有值，索引头 null 不覆盖）。一段 `TotalDamageFirstCast`=35/40/45/50/55+**0.2×额外AD**；流血 **全程** `TotalBleedDamage`=35/60/85/110/135+**0.8×额外AD**，`BleedDuration=5s`（`BleedInterval=0.5` 不编每跳）；再施 `TotalMinDamageSecondCast`=30/42.5/55/67.5/80+**0.4×额外AD**；上限 `TotalMaxDamageSecondCast`=2×(同基础+**0.7×额外AD**)，**不是** 2×下限；英雄治疗 `TotalHealSecondCast`=45/60/75/90/105+**0.4×额外AD**；`RecastWindow=4s`。跨技能 `@spell.NaafiriQ:*` 按当前消费保留。  
范围外：犬群跳跃嘲讽、小兵/非史诗处决。空断点处决曲线不线性化。

**纳亚菲利 W 暴吼**（根绑定 `NaafiriR`，槽位已校正）  
可录本体：冷却 26/24/22/20/18s、法力 60（已复用）；`mCastTime=spellCastTime=0.75s`。不可选取 1s；`BonusAD`=**0.2×总AD**（mStat2 省略 formula）；移速比例 0.20/0.225/0.25/0.275/0.30（`×100` 为百分点），持续 `Duration=5s`。  
跳过：额外犬群、召回。`NaafiriADFlatBoost` 无值。

**纳亚菲利 E 剔骨本能**  
可录本体两段：冷却 11/10/9/8/7s、法力 40（已复用）。一段 15/25/35/45/55+**0.4×额外AD**；二段 60/85/110/135/160+**0.8×额外AD**（分段，不默认求和）。`DashDistance=450`。  
未知：无 `mCastTime`/`spellCastTime`，**不冒充瞬发**。  
跳过：犬群召回与 100% 犬群治疗。

**纳亚菲利 R 猎狗血性**（根绑定 `NaafiriW`）  
可录本体：冷却 110/95/80s、法力 100（已复用）。`TotalDamage`=125/200/275+**1.0×额外AD**；护盾 `ShieldTotal`=100/150/200+**1.5×额外AD**，`ShieldDuration=3s`；`TakedownWindow=7s`、`RecastWindow=12s`。减速数值未进当前提示（仅“短暂”）。  
未知：**`spellCastTime=0` 与 `mChannelDuration=0.75` 冲突，不用 0 冒充瞬发。** `ArmorShred` 纯加法 1 级 6、每级 +2 未消费，单列。  
跳过：`PackmateDamage`、召回冲刺。视野/显形排除。

---

**劫 P 灭魂劫**  
可录当前敌：阈值 `CurrentHealthThreshold=0.5`（50%）；`PerUnitCD=10s`。匿名 `{6a1a62e9}` 经 `MaxHPDamage` 当前消费：1 级 0.05（displayAsPercent、precision 1）；7/17 级各 `mAdditionalBonusAtThisLevel=+0.025`；省略每级斜率按构造 0，**不线性插值**。`TotalDamage`=该比例×**最大生命**（mStat12 省略 formula）。  
未知：断点是否立即计入、条件树 `FinalDamage` 实际门控。`{a8cb9c14}` 未证。  
范围外：野怪修正/上限；慎劫任务 `{ad3d785f}` 未消费。

**劫 Q 诸刃**  
可录本体：冷却 6s（已复用）；能量 75/70/65/60/55（索引 0，**能量非法力**，不在 24 复用内）。`TotalDamage`=80/120/160/200/240+**1.0×额外AD**。仅 `spellCastTime=0.25`。  
范围外：影分身复制；`PassThroughDamage=0.6×` 额外敌人。

**劫 W 分身**  
可录自身位移/能量：冷却 20/19/18/17/16s、能量 40/35/30/25/20（均未复用）。被动回复 `EnergyRestoreDoubleHit` 30/35/40/45/50（同技能重复命中当前英雄，每次技能一次）；`ShadowDurationTooltip=5s`（与内部 `ShadowDuration=5.25` 区分，用当前消费 5）。互换为自身位移。仅 `spellCastTime=0.25`。  
跳过：分身作为额外攻击主体与复制输出。`mCoefficient=0.9` 无名未证。

**劫 E 鬼斩**  
可录本体：冷却 5/4.5/4/3.5/3s（已复用）；能量 40。`TotalDamage`=70/92.5/115/137.5/160+**0.7×额外AD**；命中英雄缩短 W `ShadowHitCDR=3s`。仅 `spellCastTime=0.25`。  
跳过：影分身斩击与其减速（`MoveSpeedMod`/`MoveSpeedModBonus` 绑定分身/多重斩击）。不把分身伤并入本体。

**劫 R 瞬狱影杀阵**  
可录：冷却 120/110/100s；无消耗。自身不可选取与突进；标记 `RDeathMarkDuration=3s`；引爆 `RCalculatedDamage`=**1.0×总AD**（mStat2 省略 formula）+ 印记期**本体**伤害×`RDamageAmp` 0.25/0.40/0.55；再施互换为自身位移。`RShadowDurationDisplayed=7.5s` 只作标记窗口时长，不分身伤害。仅 `spellCastTime=0.25`。  
未知：`RBaseDamage` 无值；匿名 `{43a019eb}`=7.5+0.5 未消费（扩展写额外 1.5s，对不上）。击杀窃取 AD 仅摘要、主提示未消费。  
范围外：影分身复制输出、`RVisionDuration` 视野。印记统计不得混入分身伤害。

---

资格：20 槽根绑定齐全；公共 24 参与来源逐级一致。樱桃/URF 覆盖不进召唤师峡谷。未证选择器（mStat 8/9/13/15）不猜输入。
