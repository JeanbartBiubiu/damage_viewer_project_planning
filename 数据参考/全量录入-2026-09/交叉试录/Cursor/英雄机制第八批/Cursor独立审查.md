先只读本目录待审资料，核对冻结 SHA 与候选结构，再按六项清单逐条对照公式、资格和范围。先核 SHA256 与冻结清单，再对照审查说明和候选 JSON 的关键字段。SHA 已对上。接下来用只读 Node 抽出候选结构、公式映射和待审资格字段。接下来对照完整计算树：先抽出凯特琳/烬公式、效果资格、以及 `mStatFormula=2` 的映射。组成文件已对照完。下面从冻结计算树抽出 `mStat`/`mStatFormula`、暴击子式，以及伤害效果的资格字段。VERDICT: REVISE  
REVIEWED_PLAN_REV: HERO8-CANDIDATE-20260909-PRE1

候选 SHA 与冻结声明一致：`待审资料/前十技能候选.json` = `dacd38819423c7df00ca342d6e6fead31c4a9ad3204da958061968aaf2ac8b42`；`待审资料/后十技能候选.json` = `7f5b6436f399b479f3a1d9bb1361f80917b317d90a55825b1fa1b403693d04bb`。23 项既有公共参数与 `待审资料/写前现值.json` 同键同值复用。本审查只读本目录冻结来源与候选，未跑生成器/核算写盘。

---

阻塞项

1. Caitlyn R 把显式 `mStatFormula=2` 建成 TOTAL（第 1 项成立）

- 字段：`前十技能候选.json` → `skills.caitlyn_r.write.formulas.raw_damage` 中 `SOURCE.attack_damage.TOTAL`；同文件 `parameters.total_ad_ratio` 名称/描述「总攻击力」；`凯特琳组成.mjs` 第 86–89 行把 `parts[1].mStat===2 && mStatFormula===2` 直接接 TOTAL。
- 树：`根绑定与数值证据.json` `caitlyn_r` `mSpell.mSpellCalculations.RTotalDamage.mFormulaParts[1]` = `{mStat:2, mStatFormula:2, mDataValue:"RADRatio"}`。官方/中文只有 `@RTotalDamage@`，升级列表无 RADRatio 的 Total/Bonus 名称。
- 同组合反证：同英雄 `caitlyn_w` 同形节点 `{mStat:2, mStatFormula:2, mDataValue:"ADRatio"}` 建成 `attack_damage.BONUS`；`德莱文组成.mjs` `explicitBonusAD()` 以 Draven R `nameOverride=Spell_ListType_BonusADRatio` 作为「`mStat=2`+`mStatFormula=2` = 额外攻击力」的独立证据；烬 P `mStat=4/mStatFormula=2` 也建成额外攻速。
- 结论：R 的 `mStatFormula=2` 在本批证据里应是 BONUS，不是 TOTAL。官方 16.17.1 tooltip 未写「总攻击力」，不能用来压过该字段。
- P/R 暴击乘数：P/R 均把树里的 `(mStat=9×1 − 1)` 建成 `1 + critical_strike_damage_bonus_percent`，R 再对整段和式乘 `1 + 暴击几率×0.3×(…)`，结构与 `HeadShotBonusDamage` / `RTotalDamage.mMultiplier` 一致；根 `critDamageMultiplier=2` 与目录「40 个百分点、不是最终倍率」同向。此项不是 R 的 TOTAL 错误。缺的是完整暴击倍率属性键，不是漏乘。

2. 前十对未证资格写了默认 DAMAGE/hit，并把未解码输入接到空绑定规则（第 2 项成立）

`候选.mjs` 的 `damage()` 固定 `spellShieldBlockScope="RESULT"`、`vampRules=[]`、`critical.mode="DISALLOWED"`，注释写「空列表不代表不能吸血」。这正好违反「空 vamp 与默认 RESULT 不是未知」。后十在同类缺口下只留公式、不写 DAMAGE（`draven_q/e/r`、`kalista_q`）。

- `caitlyn_e`：`pending`「法术护盾、吸血资格未确证」，仍写 `write.effects.net_damage.results[damage]` 上述默认值，且 `triggerRules.actual_hit.actions[0].runtimeInputBindings=[]`，而 `net_damage` 使用 `unresolved_scaling_attribute`（RUNTIME_INPUT）。冻结树 `NetDamage.mFormulaParts[1]` 只有 `mCoefficient=.8`，无 mStat。
- `jhin_q`：`pending`「法术护盾和吸血资格按真实技能结果接线」，同样默认 DAMAGE + `actual_hit` 空 `runtimeInputBindings`，公式第三项为未解码输入。
- `caitlyn_r`：`pending`「实际暴击期望口径、法术护盾…需要真实命中上下文」，仍写 DAMAGE 的 `RESULT`/`vampRules=[]`。树内暴击是确定性 `mMultiplier`，与再套一层默认资格不是一回事。
- `caitlyn_q`、`jhin_w`：冻结来源没有暴击/吸血/法术护盾资格句，同样写出上述默认 DAMAGE+`SKILL_HIT`。缺的就是这三项资格的来源句；不能靠 helper 默认。

允许：只保存带未解码输入的公式（后十 `kalista_e` 即如此）。不允许：无 `runtimeInputBindings` 的规则去执行该公式。

3. 范围外纯小兵/多目标/空间参数被新增（第 4 项部分成立）

- `jhin_w.write.parameters.minion_damage_ratio`：来源 `DataValues.MinionMod`；`补充文本证据.json` `spell_jhinw_tooltipextendedbelowline`「对小兵造成@MinionMod*100@%伤害」。首英雄公式未用该键。纯小兵，不应新增。
- `jhin_q` 的 `kill_bounce_amp_ratio` / `bounce_count` / `bounce_range`：多目标弹跳与查找距离；审查说明已把弹跳列为范围外，首目标公式未引用它们。
- `caitlyn_q` 的 `secondary_damage_ratio` 与公式 `secondary_damage`：后续弹体；排除项已后置多目标，1V1 首目标只用 `initial_damage`。独立核算还测了「后续目标乘 0.6」。
- `draven_r` 的 `minimum_damage_ratio` / `damage_reduction_per_hit`：官方为「每命中一个敌人」衰减；保存的 `first_target_damage` 未用；同目标往返文案说折返重置。属多目标穿透参数新增。

混合依赖未整体删掉：`caitlyn_w` 强化爆头公式仍在；`jhin_e` 跳过实体但 `jhin_w` pending 仍留陷阱标记；`draven_p` 无金币参数但 R 有 `current_adoration_stacks`。这些不是本条的问题。

4. 独立算例复述同一错误公式（第 6 项成立）

- `前十技能独立核算.mjs` 第 148 行期望 `caitlyn_r` 等级 1/3 raw=500/850、完整=552.5/939.25，即 `300/650 + 1.0×TOTAL200` 再乘 1.105。核算器只 eval 候选树，不对照 `mStatFormula`。
- `Cursor前十技能短体验.md` 同步写 500/552.5。若 R 按同批 BONUS 口径，等级 1 应为 `300+1.0×BONUS100=400`，不是 500。
- 0 失败只证明自洽，不能为第 1 项放行。

---

非阻塞（含第 3、5 项核实）

- Jhin P 等级增长：`TotalADPercent` 第 0 项 `mLevel1Value=.04`、`mInitialBonusPerLevel=.01`，10 级 `mBonusPerLevelAtAndAfter=.02`、12 级 `.04`。候选 `level_attack_damage_percent` 为 1=0.04、10=0.14、12=0.20、18=0.44，是在切换级改步长后立刻加新步长，没有沿 0.01 前斜率，也没有把缺失的 `mAdditionalBonusAtThisLevel` 加成 0。冻结中文/官方只有 `@TotalADPercent@`，没有数字端点；短体验 0.2775/0.3775/0.4375/0.6775 是再叠 25% 暴击与 50% 额外攻速后的合成值，不能当文本端点。缺：字符串表或官方把该曲线展开成的 1/10/12/18 数字。
- P 爆头等级断点 0.6/0.8/1.0（7/13 级 `mAdditionalBonusAtThisLevel`）是阶跃，不是插值。生成器里的 `??0` 在这两条树上未落到缺字段。
- Draven 崇拜→R：`current_adoration_stacks` 无初始默认；`adoration_execute_threshold` 为层数×系数，proof 写明不是额外真实伤害；P 未录金币。因果保留，规则未接，符合尚未接线。未把 `{577427b5}` 写成 `DravenPassiveStacks` 的结构化引用，接线时再补即可。
- Kalista E：`cooldown_ms` 来自 `DataValues.FakedCooldown`（10/9.5/9/8.5/8s），LevelUp `type=FakedCooldown` + `nameOverride=Spell_ListType_Cooldown`；根 `Cooldown` 全 0 未当零冷却。`additional_spear_count` 等为 RUNTIME_INPUT、`fixedValue=null`，无内部状态初始层。无 DAMAGE、无空绑定规则。击杀返还/重置效果有 `skillKeys:["kalista_e"]`，未挂假 KILL。
- `jhin_w` `total_ad_ratio` 描述写「官方说明为总攻击力」：官方/中文只有 `@TotalDamage@`，LevelUp 无 TotalADRatio；节点是省略 `mStatFormula` 的 `mStat=2, mCoefficient=.5`。与卡莉丝塔 E「省略则不默认」不一致。修订时应改未绑定输入，不要再引用不存在的官方「总攻击力」。`caitlyn_q`/`jhin_q` 有 `Spell_ListType_TotalADRatio`，不在此列。
- `caitlyn_p` 外层、`jhin_r` 的 `mStat=2` 也省略 `mStatFormula` 却建成 TOTAL；冻结没有对应 nameOverride。不与 R 的显式 formula=2 同类，但同一「不猜省略枚举」标准下应改为未绑定或补到来源句。
- 官方 16.17.1 Caitlyn Q `effect[5]=1.3/1.45/1.6/1.75/1.9` 与客户端 `tADRatio` 索引 1–5 `1.25/1.45/1.65/1.85/2.05` 不一致；候选跟客户端+`Spell_ListType_TotalADRatio`。不是本批写入错误，但不要用 ddragon effect 数组当交叉证明。
- 后十独立核算算术与后十公式一致（Q/E/R 用 BONUS100），没有复述前十 R 的 TOTAL 错误。
