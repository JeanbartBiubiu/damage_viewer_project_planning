# Cursor独立复核

真实SDK运行完成，事件全部可解析且未截断，仅read/grep/glob，无文件改动。11份输入逐项散列不变。主负责人接受凯南E累计总时长与真实剩余混淆问题，将初始效果限制为已证4秒；原公式可保留作总时长上限。未写业务数据、未运行战斗。

**VERDICT: REVISE**  
**REVIEWED_PLAN_REV:** `c65e0a8866d7658a4646241d6a96f94da3f1ad75496914e23cfdd61c3ec86e24`  
**来源:** 客户端 16.17.8104348 + 官方 16.17.1  
**组成:** 20槽，154参数 + 34公式 + 25效果 = 213；复用 24 公共参数（8字段完整保留、不发更新）；拟新增 189。过程/内部状态/触发均为空，无 DAMAGE / 瞬时周期治疗。

---

### 阻塞（写入前必须改候选）

**1. `kennen_e` / `after_attack_speed` 不得按当前绑定写入**

效果是 `PERSISTENT` + `APPLICATION_SNAPSHOT`，`durationValue` 指向公式 `capped_after_duration_ms`，该式含运行时输入 `confirmed_critical_extension_count`；生命周期 `reapplicationDurationMode: REFRESH_ALL`。

正文是「结束后 4 秒攻速，暴击延长 1 秒、延长部分不超过初始时长」。候选公式 `4000 + MIN(次数×1000, 4000)` 作为**已知次数下的总时长上限**可以单独保存。把它绑成持续效果时长则：

- 应用时若次数未知，不是真实剩余状态；
- 若按满档次数应用，等于无条件得到 8 秒；
- 若每次暴击再套用，`REFRESH_ALL` 会重置完整总时长，不是「剩余 +1 秒再夹限」。

25 个效果里**没有** `PERSISTENT + MOMENT_EVALUATION`。本条是持续效果**时长**间接引用含传入参数的计算。快照语义是生成器默认，不能据此判该效果可写。对齐 `xerath_e`：只留公式/参数；效果时长只用已确定的 `after_duration_ms`，或等剩余状态接线后再写效果。

---

### 非阻塞

- **凯南 E 伤害冲突：** 当前 `DataValues.BaseDamage` 索引1–5 = 80/120/160/200/240；同根 `mEffectAmount[0]` 与官方 `effectBurn` = 85/125/165/205/245。候选记录冲突并采用当前具名绑定，正确。
- **凯南能量 / W 9/2：** 消耗与回复均为 `energy`，未外推 RESOURCE。暴击分支把 9/2 做成无默认运行时输入 `source_stat_9_2_value`，未猜暴伤枚举。
- **维克兹 R：** 正文 2.5 秒完整总伤（`EffectValue` + 1.25 AP），未乘跳数；根 `mChannelDuration` ≈ 2.6 秒只在来源待核，未当伤害持续。被动真伤等级项为运行时输入，未填 0、未展开 18 表。2.6 秒可另存独立参数，但不要并进伤害时长。
- **吉格斯：** Q/E 法强按技能级（Q 0.6–0.8，E `APRatioPerMine` 0.25–0.45）。后续地雷 0.4、R 边缘 0.65 均为 `GameCalculationModified.mMultiplier` 乘**整段**（基础+法强），不是只乘基础。
- **泽拉斯：** 非英雄补蓝保留为自身资源效果；Q 返还 = 实际已扣法力 × 0.5；E 晕眩最终夹限 750–2250 ms，距离未线性展开。P/Q 三个瞬时 `RESOURCE_CHANGE` 引用含运行时输入的公式，但非 `PERSISTENT+MOMENT_EVALUATION`，与上条后端拒绝条件不同，写入时仍按效果引用核对，不凭公式可存即写入。
- **StatBy：** 本批实际用到的是 AP 0/0、AD 2/2 BONUS；9/2 未映射。生成器里另有未使用的 12/2=额外生命，本批公式未吃到。
- **公共参数 8 字段：** 抽查 `kennen_q.cooldown_ms` 与现值一致（description/sortOrder/valueMode/levelValues 等），政策为完整复用、不更新。

主负责人保存审计即可，此处不落报告文件。
