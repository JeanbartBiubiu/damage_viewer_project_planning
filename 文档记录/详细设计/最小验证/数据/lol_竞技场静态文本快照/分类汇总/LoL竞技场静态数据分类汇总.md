TASK_KEY: wasm-lol-entity-coverage-audit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-04-09 16:35:22

# LoL竞技场静态数据分类汇总

- 生成时间：2026-04-08T14:42:25.530Z
- Data Dragon 版本：16.7.1
- 入口总数：1829

## 数据源计数

- champion：860
- item：702
- rune：61
- augment：206

## 适配状态计数

- out_of_scope：424
- in_scope：917
- needs_conversion：488

## 一级机制分组

### 比例与阈值

- 数量：339
- 数据源分布：champion=173，item=107，rune=15，augment=44
- 适配状态：out_of_scope=78，needs_conversion=101，in_scope=160
- 示例：
  - champion:Aatrox:passive | champion_passive | 暗裔剑魔 / 赐死剑气 | out_of_scope
  - champion:Akali:spell:AkaliR | champion_spell | 离群之刺 / 我流秘奥义！表里杀缭乱 | needs_conversion
  - champion:Akshan:spell:AkshanR | champion_spell | 影哨 / 恩怨相抵 | in_scope
  - champion:Ambessa:spell:AmbessaQ | champion_spell | 铁血狼母 / 暗袭 / 裂斩 | needs_conversion
  - champion:Amumu:spell:AuraofDespair | champion_spell | 殇之木乃伊 / 绝望光环 | needs_conversion
  - champion:AurelionSol:spell:AurelionSolQ | champion_spell | 铸星龙王 / 星河冲荡 | needs_conversion

### 护盾、治疗、吸血

- 数量：360
- 数据源分布：champion=120，item=199，rune=10，augment=31
- 适配状态：needs_conversion=60，in_scope=188，out_of_scope=112
- 示例：
  - champion:Aatrox:spell:AatroxE | champion_spell | 暗裔剑魔 / 暗影冲决 | needs_conversion
  - champion:Aatrox:spell:AatroxR | champion_spell | 暗裔剑魔 / 大灭 | in_scope
  - champion:Ahri:passive | champion_passive | 九尾妖狐 / 摄魂夺魄 | in_scope
  - champion:Akshan:passive | champion_passive | 影哨 / 无所不用 | in_scope
  - champion:Akshan:spell:AkshanW | champion_spell | 影哨 / 赴险夺人 | out_of_scope
  - champion:Alistar:passive | champion_passive | 牛头酋长 / 凯旋怒吼 | needs_conversion

### 命中触发与标记结算

- 数量：361
- 数据源分布：champion=191，item=135，rune=7，augment=28
- 适配状态：needs_conversion=101，in_scope=180，out_of_scope=80
- 示例：
  - champion:Akali:spell:AkaliE | champion_spell | 离群之刺 / 我流奥义！隼舞 | needs_conversion
  - champion:Akshan:spell:AkshanQ | champion_spell | 影哨 / 去而复还 | in_scope
  - champion:Alistar:spell:AlistarE | champion_spell | 牛头酋长 / 践踏 | needs_conversion
  - champion:Amumu:passive | champion_passive | 殇之木乃伊 / 诅咒之触 | in_scope
  - champion:Amumu:spell:Tantrum | champion_spell | 殇之木乃伊 / 阿木木的愤怒 | out_of_scope
  - champion:Anivia:spell:FlashFrost | champion_spell | 冰晶凤凰 / 寒冰闪耀 | out_of_scope

### 资源与节奏

- 数量：594
- 数据源分布：champion=343，item=178，rune=22，augment=51
- 适配状态：in_scope=280，needs_conversion=190，out_of_scope=124
- 示例：
  - champion:Aatrox:spell:AatroxQ | champion_spell | 暗裔剑魔 / 暗裔利刃 | in_scope
  - champion:Aatrox:spell:AatroxW | champion_spell | 暗裔剑魔 / 恶火束链 | in_scope
  - champion:Ahri:spell:AhriQ | champion_spell | 九尾妖狐 / 欺诈宝珠 | in_scope
  - champion:Ahri:spell:AhriW | champion_spell | 九尾妖狐 / 妖异狐火 | needs_conversion
  - champion:Ahri:spell:AhriE | champion_spell | 九尾妖狐 / 魅惑妖术 | needs_conversion
  - champion:Ahri:spell:AhriR | champion_spell | 九尾妖狐 / 灵魄突袭 | needs_conversion

### 叠层与时效

- 数量：43
- 数据源分布：champion=12，item=16，rune=3，augment=12
- 适配状态：out_of_scope=11，in_scope=20，needs_conversion=12
- 示例：
  - champion:Annie:passive | champion_passive | 黑暗之女 / 嗜火 | out_of_scope
  - champion:AurelionSol:passive | champion_passive | 铸星龙王 / 星海焕然 | in_scope
  - champion:Draven:passive | champion_passive | 荣耀行刑官 / 德莱文联盟 | needs_conversion
  - champion:Gangplank:passive | champion_passive | 海洋之灾 / 烈火审讯 | in_scope
  - champion:KogMaw:passive | champion_passive | 深渊巨口 / 来自艾卡西亚的惊喜 | needs_conversion
  - champion:Leona:passive | champion_passive | 曙光女神 / 日光 | out_of_scope

### 抗性、穿透、转化、适应之力

- 数量：26
- 数据源分布：champion=2，item=19，rune=1，augment=4
- 适配状态：in_scope=25，needs_conversion=1
- 示例：
  - champion:Rammus:passive | champion_passive | 披甲龙龟 / 锥刺甲壳 | in_scope
  - champion:Thresh:passive | champion_passive | 魂锁典狱长 / 地狱诅咒 | in_scope
  - item:1029 | item | 布甲 | in_scope
  - item:1031 | item | 锁子甲 | in_scope
  - item:1033 | item | 抗魔斗篷 | in_scope
  - item:1057 | item | 负极斗篷 | in_scope

### 基础属性加成

- 数量：18
- 数据源分布：item=18
- 适配状态：in_scope=16，out_of_scope=2
- 示例：
  - item:1011 | item | 巨人腰带 | in_scope
  - item:1026 | item | 爆裂魔杖 | in_scope
  - item:1028 | item | 红水晶 | in_scope
  - item:1036 | item | 长剑 | in_scope
  - item:1037 | item | 十字镐 | in_scope
  - item:1038 | item | 暴风之剑 | in_scope

### 需过滤或转换

- 数量：40
- 数据源分布：champion=8，item=15，augment=17
- 适配状态：out_of_scope=17，needs_conversion=23
- 示例：
  - champion:Anivia:passive | champion_passive | 冰晶凤凰 / 寒霜涅槃 | out_of_scope
  - champion:Azir:passive | champion_passive | 沙漠皇帝 / 恕瑞玛的传承 | out_of_scope
  - champion:Ivern:passive | champion_passive | 翠神 / 森林之友 | needs_conversion
  - champion:Neeko:passive | champion_passive | 万花通灵 / 天生幻魅 | out_of_scope
  - champion:TwistedFate:passive | champion_passive | 卡牌大师 / 灌铅骰子 | needs_conversion
  - champion:Yorick:passive | champion_passive | 牧魂人 / 牧魂人 | out_of_scope

### 待人工归类

- 数量：48
- 数据源分布：champion=11，item=15，rune=3，augment=19
- 适配状态：in_scope=48
- 示例：
  - champion:Fiddlesticks:passive | champion_passive | 远古恐惧 / 巫骇草人 | in_scope
  - champion:Fizz:passive | champion_passive | 潮汐海灵 / 伶俐斗士 | in_scope
  - champion:Karthus:passive | champion_passive | 死亡颂唱者 / 死亡契约 | in_scope
  - champion:Kassadin:passive | champion_passive | 虚空行者 / 虚空之石 | in_scope
  - champion:Malzahar:passive | champion_passive | 虚空先知 / 虚空穿越 | in_scope
  - champion:Naafiri:passive | champion_passive | 百裂冥犬 / 狂烈种群 | in_scope

## 高频机制标签

- duration：986
- resource_cost：902
- cooldown：523
- buff_debuff：410
- offense_stat：345
- move_speed：335
- ally_partner：305
- multi_target：300
- on_hit：296
- armor_mr_shred：290
- terrain_vision：266
- heal：246
- health_stat：237
- stack：233
- shield：208
- attack_speed：183
- regen：180
- mobility_spatial：177
- hp_max_pct：163
- haste_stat：160

## 建议的首轮分析入口

- champion:Akali:spell:AkaliR | champion_spell | 离群之刺 / 我流秘奥义！表里杀缭乱 | 阿卡丽朝着一个方向跃出，伤害被她击中的敌人。再次施放：阿卡丽朝着一个方向突进，处决所有被她击中的敌人。 阿卡丽跃过目标敌方英雄，对沿途的所有敌人造成 {{ cast1damage }}魔法伤害 。 阿卡丽可以在{{ cooldownbetweencasts }}秒后 再次施放 以施展一次带穿刺效果的突刺，造成 {{ cast2damagemin }} 到 …
- champion:Akshan:spell:AkshanR | champion_spell | 影哨 / 恩怨相抵 | 阿克尚锁定一名敌方英雄并开始储存他的子弹。在释放时，他会发射所有已储存的子弹，对命中的第一个英雄、小兵或建筑物造成基于已损失生命值的伤害。 阿克尚锁定一名敌方英雄并开始过载充能他的枪械至多{{ channelduration }}秒，至多可储存{{ numberofbullets }}颗子弹。 再次施放： 阿克尚释放已储存的子弹，每颗子弹对命中的首个敌人或…
- champion:Ambessa:spell:AmbessaQ | champion_spell | 铁血狼母 / 暗袭 / 裂斩 | 安蓓萨甩出链刃横扫她前方的半圆区域，对被链刃命中的敌人造成额外伤害。击中一个敌人后，该技能在短时间内的下一次施放会发生变化，使她向前方的一条直线猛砸链刃，对命中的首个敌人造成额外伤害。 暗袭 ：安蓓萨向前甩出链刃，对打击范围边缘区域的敌人们造成 {{ calc_damage_1_max }}+{{ calc_damage_1_percent_max }}最…
- champion:Amumu:spell:AuraofDespair | champion_spell | 殇之木乃伊 / 绝望光环 | 附近的敌人陷入绝望，每秒损失一定百分比的最大生命值并刷新身上的 诅咒 效果。 开启： 阿木木开始哭泣，每秒对附近的敌人们造成 {{ basedamage }}外加{{ totalhealthdamage }}%最大生命值的魔法伤害 并刷新 诅咒 。{{ spellmodifierdescriptionappend }} 每秒{{ cost }}{{ abi…
- champion:AurelionSol:spell:AurelionSolQ | champion_spell | 铸星龙王 / 星河冲荡 | 奥瑞利安·索尔引导他的龙息若干秒，伤害首个命中的敌人并对附近的敌人们造成削减过的溅射伤害。龙息在一个敌人身上每直接引导一秒就会造成额外伤害，这个伤害可通过已收集的【星尘】来提升。如果目标是一名英雄，那么这个技能还会收集【星尘】。 奥瑞利安·索尔喷吐星焰，至多持续{{ maxchannelduration }}秒，每秒对首个命中的敌人造成 {{ damage…
- champion:Belveth:spell:BelvethE | champion_spell | 虚空女皇 / 搠面皇锋 | 卑尔维斯将她自身禁锢在原地，引导一阵切割风暴环绕自身，这个风暴会以生命值最低的敌人为目标并为她提供生命偷取和伤害减免。 卑尔维斯引导并斩击她自身的周围区域，获得{{ drpercent*100 }}%伤害减免、{{ totallifesteal }}生命偷取、并在{{ totalduration }}秒持续攻击{{ f2.0 }}次，攻击次数可通过 攻击速…
- champion:Blitzcrank:passive | champion_passive | 蒸汽机器人 / 法力屏障 | 布里茨在血量过低时会获得一层基于它法力值的护盾。
- champion:Briar:spell:BriarQ | champion_spell | 狂厄蔷薇 / 冲头 | 贝蕾亚跃向一个单位并用她的（痛苦之）脚镣命中敌人们，将他们晕眩并削减他们的护甲。 贝蕾亚跃向一个单位，将其 晕眩 {{ stunduration }}秒，造成 {{ totaldamage }}物理伤害 和持续{{ shredduration }}秒的{{ shredpercent*100 }}% 护甲削减 与 魔抗削减 。 如果贝蕾亚在 血莽 期间对一个…
- champion:Briar:spell:BriarW | champion_spell | 狂厄蔷薇 / 血莽 / 噬击 | 贝蕾亚向前跳跃并击碎她的囚枷，进入一种【血莽】状态来使她无休止地追击相距最近的那个敌人（优先以英雄为目标）。在【血莽】状态下，她的攻击速度和移动速度获得提升，并且她的攻击会在她目标四周的一个区域内造成伤害。 贝蕾亚可以在【血莽】状态下再次激活这个技能，来让她的下一次攻击噬咬她的目标，造成基于目标已损失生命值的额外伤害，并且基于她造成的伤害来为她提供治疗效果…
- champion:Briar:spell:BriarE | champion_spell | 狂厄蔷薇 / 惊吼 | 贝蕾亚重新集中她的意志，移除【血莽】并将能量引导为一次强力吼叫，对敌人造成伤害和减速。在蓄力时，她获得伤害减免并回复一部分最大生命值。一次完全蓄力的吼叫会将敌人们击退，对那些与墙体碰撞的敌人造成额外伤害和晕眩。 开始蓄力 ：贝蕾亚移除 血莽 并聚集能量，获得{{ drpercent }}%伤害减免并在1秒里持续获得共 {{ percentmaxhpheal…
- champion:Briar:spell:BriarR | champion_spell | 狂厄蔷薇 / 毙除 | 贝蕾亚踢出她的囚枷中的血石，让被它命中的第一个英雄成为她的猎物。她随后会径直走向该目标，在抵达目标处时恐惧周围的其它敌人们，并进入一个彻底血狂的状态。她将追击她的猎物直至阵亡才罢休，获得【血莽】的助益以及额外的护甲、魔抗、生命偷取和移动速度。 贝蕾亚踢出她的囚枷中的血石并飞到被它命中的第一个英雄的位置，将这个英雄标记为她的猎物。在着陆时，她对附近的一切造成…
- champion:Camille:passive | champion_passive | 青钢影 / 适应性防御 | 对敌方英雄发起的普攻会基于该英雄的伤害类型（物理或魔法）提供一层专门吸收该类型伤害的护盾，护盾的生命值相当于卡蜜尔的一部分最大生命值，持续一小段时间。

## 说明

- 这里的分类是“后续机制分析索引”，不是最终实现定案。
- `in_scope` 表示可直接进入 1v1 数值分析；`needs_conversion` 表示需要先做语义折叠；`out_of_scope` 表示当前阶段不作为主样本。
- 英雄按“被动/技能”拆成原子入口，避免一个英雄同时落入多个机制组后难以抽样。
