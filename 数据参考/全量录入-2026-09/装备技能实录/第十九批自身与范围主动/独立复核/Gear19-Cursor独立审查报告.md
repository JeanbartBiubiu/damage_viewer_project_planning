# 第十九批装备技能独立审查

结论：**REVISE**。候选与来源冻结哈希一致，Cursor 已在隔离副本完成真实只读审查；业务写入前需要处理下列范围边界和参数问题。

候选 SHA256：`79e35c56d222d1248433f310276a8e3a91784d884ff0075dc4d1837f0d623f71` ；来源 SHA256：`1ce775810bd1a252438386f6959dd8adf7a1de51224e3e055e3ffe8826ad7a79` ；只读 GET SHA256：`ebe75831b1a118ff1abe34683fa9d30f588eacc6c8edbd0348787d73a1462773`。

## Cursor 运行证据

- runId：`run-5e78767c-a8e2-4a1e-a724-9fcd87b227da`；requestId：`99347ebe-28a7-4d26-a8c5-5f30bb496c03`；agentId：`agent-ed400dd5-7ff0-4bc4-99e3-2ee2326f6e95`。
- SDK、模型与参数：`sdk`、`grok-4.6`、effort=high、fast=false；实际工具事件 140，已完成工具 70，失败 0。
- 工具：glob、grep、read、shell；设置来源为 project；允许读取副本中的“参考资料”。
- 审计：范围外写入 0，运行差异 0，隔离副本 Git 前后干净，diff.patch 为 0 字节。审计是受记录的写入范围核对，不等同操作系统隔离。
- 原始证据：`C:\project\damage_web_dev\.agents\artifacts\gear19-independent\隔离审查副本\.agents\artifacts\run\summary.json`、`C:\project\damage_web_dev\.agents\artifacts\gear19-independent\隔离审查副本\.agents\artifacts\run\events.jsonl`、`C:\project\damage_web_dev\.agents\artifacts\gear19-independent\隔离审查副本\.agents\artifacts\run\diff.patch`。

## 必须修订

- **item_6664_passive.aura_range（实质修订）**：新增 aura_range，FIXED INTEGER 325，说明为献祭光环半径；保留350/500为触发脉冲半径。
- **item_3222.scope-classification（范围边界修订）**：将 3222 从已排除改为目标归属待补证，保留来源治疗/净化字段，不凭缺证补建当前技能。
- **item_3107.friend-heal-scope（范围边界修订）**：将友方治疗从范围外改为目标资格待补证；保留150/350端点和未证插值，不创建默认 DIRECT_HEAL。
- **item_3190.self-target-proof（语义说明修订）**：保留850范围、290/360端点和运行时护盾输入；把“支持自身在范围内”改成“自身目标资格待补证”。
- **item_3190.actual_self_shield_value（类型与语义修订）**：保留稳定键 actual_self_shield_value，改 DECIMAL/RUNTIME_INPUT；名称和说明改为“当前合资格英雄基础护盾值”，不宣称 SelfAoe 已证明自身受益。

其中 6664 的来源同时给出 `Range=325`、`AuraDuration=3`、`TicksPerSecond=1`，候选只录了触发脉冲半径 350/500；350/500 不能代替“附近敌人”的光环资格半径。11 条公式的计算树保持正确，最小修订是补参数，不要改公式或凭它新增周期过程。

3222 和 3107 的共同边界问题是：来源证明了友方目标文字，却没有证明施法者必不在目标集合中。缺少 SelfAoe 或目标枚举证据不能直接写成范围外；应改为目标归属待补证，保留数值来源但不默认创建治疗效果。3190 的 SelfAoe 说明几何原点，8193 位义没有同版枚举旁证；保留护盾端点和运行时护盾值，同时收窄说明，并把未知求值的护盾输入改为 DECIMAL。

## 数值与负例

- 独立按候选表达式重新求值 21/21 个算例：包括 3074、3748 两种攻击距离、6698、3107 真实伤害、6664 每次/每秒/英雄触发三棵树和 8020 增幅。
- 负例 7/7 个通过：范围外不满足、6664 脉冲半径不冒充光环、缺运行时输入不补零、3222 无 SelfAoe 不推出第三方专属。
- 3748 的两个 mStat=12 具名旧节点满足外部最大生命窄补证的形状；当前 RUNTIME_INPUT 是安全保守值，可由主负责人另行决定是否按该窄条件回补。该证据不扩展到匿名节点、mStat29、CURRENT/BONUS 或其他节点类。

## 写前保护与边界

- 只读 GET 记录 198 件装备、108 件已挂载、110 条去重关系、329 次 GET、业务写入 0；十件目标装备关系为 0，目标技能 GET 为 404。
- 该 GET 文件的装备主体只有基础字段，没有直接属性或代表图数组；候选 safeguards 中的保护声明不能替代单独 GET。主负责人写入前应另留直接属性、原图和现有挂载快照。
- 3222、3085、3504 的来源均已核对。3085 的“2个额外敌人”和 3504 的“两名友方”有明确第三方/多目标边界；3222 目前只能判定目标归属未证，不能与它们同类排除。

## 限制

这是冻结资料、只读 GET 和 Cursor 静态审查；没有业务写入、浏览器验收或战斗运行证据。

