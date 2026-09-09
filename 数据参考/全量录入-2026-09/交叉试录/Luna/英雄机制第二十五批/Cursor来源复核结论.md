**VERDICT: READY**  
**REVIEWED_PLAN_REV: hero25-source-v1**

十槽来源口径与《主负责人源值核对说明.md》一致，可进入候选；未见需要改计划的实质错误。客户端根引用为 `Characters/DrMundo/CharacterRecords/Root`、`Characters/Tryndamere/CharacterRecords/Root`。

**阻塞项：** 无。

**非阻塞建议**
- `drmundo_w` 的 extraSpell `Characters/DrMundo/Spells/DrMundoWAbility/DrMundoWRecast` 仍带旧式 `FlatHeal` / 叠层 / `TotalDamage`（总 AD + `BaseDamage` + 0.05×生命），与当前 `DrMundoW` 的 `RecastBaseDamage`、`TotalDamage`（`RecastBaseDamage` + 0.07 额外生命）及官方 16.17.1 正文不符。后续只跟主对象，不要把 Recast 当现行替换组抄入。
- 属性枚举现有 `hp` / `mana` / `energy`，无 `fury`。与计划“写入前再核 RESOURCE_CHANGE”一致，不要把怒气写进法力。

**明确认可的来源口径**

- **`drmundo_q`**：`CurrentHealthDamage` 等级 1–5 为 20/22.5/25/27.5/30% **目标当前生命**；`MinimumDamage` 80/130/180/230/280。BotData `{8a96ea3c}` 与扩展句“至少造成”支持 `MAX(最低值, 比例×目标当前生命)`，不可改最大生命。`MaximumMonsterDamage` 与小兵回复排除；英雄命中按 `HealthCost`×1 回复保留。
- **`drmundo_w`**：`DamagePerTick` 5/8.75/12.5/16.25/20，正文 `×4` → 每秒 20/35/50/65/80，不据此填 tick 排程。再施放用主对象 `RecastBaseDamage` 20/35/50/65/80 + 0.07 额外生命。两阶段灰血：前 750ms 为 `GrayHealthStorageInitial`（0.8–0.95 等级插值，无默认），其后 `GrayHealthStorage` 0.25；灰血外供，不用缺血代替。命中英雄回全部灰血，否则 0.5。`spellCastTime` 0、重施锁 500ms。
- **`drmundo_e`**：`PassiveBonusAD` 必须带根乘数 0.01×`HealthToADRatio`[2, 2.3, 2.6, 2.9, 3.2]×来源总生命。主动 `BaseDamage` 5/15/25/35/45 + 0.05 额外生命。`MaxDamageAmp` 1.4 只作最高端点，缺血曲线不线性。扩展句把 `MaxMissingHealthThreshold` 0.7 写成“被动”，与主正文/计算树（被动=最大生命转 AD）冲突，不拿 70% 造曲线。兵野修正与拍飞第三人排除。
- **`drmundo_r`**：最大生命增益 15/20/25% 已损失生命；持续回复 20/40/60% 最大生命。获得最大生命与立即治疗顺序未证，不直接造 HP 变动，两项各自用当时基准、不让新增最大生命回流。三级才有附近每个敌方英雄 +5% 两项治疗；1V1 附近人数只外供 0 或 1，不默认 1。`TakedownDurationExtension` 仅留源。
- **`tryndamere_p`**：正文每点怒气 0.5 百分数点暴击 → 比例 0.005（系统 `critical_strike_chance` 以 1=100%）。怒气 INTEGER 无默认。根 `primaryAbilityResource.arType=4`、`arIncrements=100` 未证即上限，不满怒固定 100。Cherry 倍率排除。
- **`tryndamere_q`**：治疗按实际消耗怒气：基础 30–70+0.3AP，每怒气 0.5/0.95/1.4/1.85/2.3+0.012AP。`MaximumHeal` 的 `mAbilityResource=4` 不映射成默认满怒。AD 最高 20/35/50/65/80，在 10% **剩余**生命封顶，中间不线性。无施法字段不补 0。
- **`tryndamere_e`**：`TotalDamage` = 80/120/160/200/240 + 1×额外 AD（`mStat` 2 / `mStatFormula` 2）+ 0.8AP。命中英雄 5 怒气；英雄暴击缩短 1500ms。非英雄暴击 750ms 只作历史进度，不混入唯一敌人直伤。
- **`tryndamere_r`**：生命下限 `TryndRMinHealth` 30/50/70，持续 5000ms，立即怒气 50/75/100。不死保留。无施法字段不补 0。死亡拒绝/下限应用/怒气资源类型未证则只录明确数值。
