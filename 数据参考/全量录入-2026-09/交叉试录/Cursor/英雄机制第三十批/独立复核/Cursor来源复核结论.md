核对了五项会录错的风险与官方 16.17.1 正文，计划与绑定一致，没有需要改公式的阻塞。

**VERDICT: READY**  
**REVIEWED_PLAN_REV: hero30-source-v1**

固定来源为客户端 **16.17**、官方 **16.17.1**。十槽均有根绑定；永恩 E 为同一角色 `YoneE`（`Trait_RecastOrReplaceSpell`），不是完整变形或独立召唤。当前无本批候选或业务写入。

**阻塞**  
无。五项易录错点均有当前正文或计算树证据，说明未把未消费树、默认等级盾、`CritDamageMod=.95` 或错误暴击/护甲口径写进应录公式。

**待接（单列，不整技能排除）**  
- 攻速求值：亚索/永恩 Q、永恩 W 仅有系数与端点（Q 冷却上限 `.66667`，W 为 `.57142`），缺执行关系；根施法字段不是全攻速最终时长。  
- 等级算法：亚索 P `ShieldValue` 125–600 且 `mScaleByStatProgressionMultiplier=true`；永恩 W 盾 40–90 插值。两者都不要默认生成 18 级数组。  
- `mStat9`：`CurrentCritDamage` 与 Q 暴击树只证明取该属性，应用前后阶段与选择器无窄证，实际暴击倍率无默认。  
- 施法字段冲突：亚索 W `spellCastTime=0` / `mCastTime≈13ms`；永恩 R `spellCastTime=125ms` / `mCastTime=750ms`。  
- 资格与事件：剑意积攒与护盾触发/持续；亚索 W 飞行道具碰撞；亚索 E 叠层与本次伤害先后、每目标锁、E 中 Q；永恩 E 到期/硬控延迟返回；永恩 R 击飞时长仅有字段、正文无持续数值。

**其他建议（不影响本轮 READY）**  
- 官方英文永恩 E 将返还基数收窄为 **Attack and Ability damage**；中文只写「对英雄造成伤害」。录入用无默认实际存量时按英文收窄，不要扩成任意来源。伤害类型仍未标明，保持不猜。  
- 官方敌方提示写亚索护盾持续 2 秒，但被动无对应时长字段；可单列待核，不要当已证客户端值。  
- 永恩 W 的 `WDamage`（总 AD）、`WCritMultiplier=.8`、`mRollForCriticalHit`、永恩 E 匿名 `DeathmarkBase+.25` 总 AD 与 `MissingHealthPercent` 均无当前正文消费，维持不加入。  
- 永恩 Q/W 另有 `mDoesNotConsumeCooldown=true`，公共冷却字段保存不等于真实起算。
