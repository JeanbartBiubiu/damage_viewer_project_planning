# WASM 内部事件流转概要设计（V1）

## 1. 目标
- 解决引擎内部“事件如何流动与联动”，重点覆盖：
- `onSkill` 触发被动/装备效果。
- 普攻命中触发攻击特效。
- 持续伤害（DoT）在事件驱动下高效计算。

前提：
- 只做 1v1 纯伤害模拟。
- 前端只负责组装输入，WASM 负责内部执行。

## 2. 运行时核心模型

### 2.1 `RuntimeState`
- `combatants`：双方当前属性快照、资源、血量、护盾、状态。
- `cooldowns`：技能与充能冷却状态。
- `stacks`：叠层与过期时间。
- `modifiers`：Buff/Debuff 实例（含持续时间、叠层策略）。
- `dotInstances`：正在生效的 DoT 列表。

### 2.2 `EventQueue`（最小堆）
- 键：`(tMs, priority, seq)`。
- `tMs`：事件发生时刻。
- `priority`：同时刻事件优先级。
- `seq`：全局递增序号，保证稳定顺序与可复现。

### 2.3 `TriggerIndex`
- 初始化时把所有 `mechanicsConfig.triggers` 编译为索引：
- `eventType -> TriggerRuleRef[]`。
- `TriggerRuleRef` 保存来源（英雄/装备/其它 ownerType）、条件树、动作列表。

## 3. 事件类型分层

### 3.1 外部可见触发事件（对齐配置）
- `on_spell_cast`
- `on_basic_attack_hit`
- `on_damage_dealt`
- `on_tick`
- `on_stack_change`

### 3.2 内部过程事件（引擎自用）
- `cast_intent`（尝试施法）
- `cast_resolved`（施法成功并进入生效）
- `basic_attack_intent`
- `damage_apply`
- `modifier_expire`
- `dot_tick_fire`

说明：
- 内部过程事件不暴露给配置层，配置层只订阅 3.1 的标准触发事件。

## 4. 触发分发机制

1. 从 `EventQueue` 取出最早事件。  
2. 执行事件本体逻辑（改状态/排新事件）。  
3. 生成对应“外部可见触发事件上下文 `TriggerContext`”。  
4. 用 `TriggerIndex[eventType]` 取候选规则。  
5. 对每条规则按 `conditions` 判定。  
6. 命中后执行 `actions`，动作可继续入队新事件。  

关键点：
- 装备特效、被动技能、角色技能一律通过同一分发链路，不写分支特判。
- 触发上下文至少包含：`sourceId/ownerType/targetId/tMs/eventType/valueSnapshot`。

## 5. 关键链路

### 5.1 `onSkill` 自动联动
1. 入队 `cast_intent`。  
2. 校验资源、冷却、控制状态。  
3. 成功后写入资源/冷却并触发 `on_spell_cast`。  
4. `TriggerIndex["on_spell_cast"]` 分发：  
- 角色被动可响应。  
- 装备被动可响应。  
- 其它来源（如符文）可响应。  
5. 响应动作可能入队 `damage_apply`、`apply_modifier`、`schedule_tick`。  

### 5.2 普攻命中触发攻击特效
1. 入队 `basic_attack_intent`（含命中时刻）。  
2. 命中时执行 `damage_apply`（普攻基础伤害）。  
3. 紧接触发 `on_basic_attack_hit`。  
4. 分发攻击特效规则（如额外伤害、减速、叠层）。  
5. 若产生额外伤害，再统一走 `damage_apply -> on_damage_dealt`。  

## 6. DoT 高效计算设计

## 6.1 DoT 实例模型
- 每个 DoT 实例记录：`instanceId/source/target/everyMs/remainingTicks/nextTickAt/formulaRef`。
- 不按“每毫秒扫描”，只在 `nextTickAt` 入队 `dot_tick_fire`。

## 6.2 结算循环
1. 事件到时执行 `dot_tick_fire`。  
2. 计算本次 tick 伤害并走 `damage_apply`。  
3. `remainingTicks--`。  
4. 若剩余 > 0：`nextTickAt += everyMs` 后重新入队。  
5. 否则销毁实例。  

## 6.3 刷新与叠加策略
- `refresh`：刷新持续时间，不新增实例。
- `stack`：新增实例或增加层数（按配置上限）。
- `replace`：同源覆盖旧实例。

优势：
- 复杂度由“时间步进扫描”变为“事件驱动触发”，常见路径为 `O(log N)` 入队/出队。

## 7. 一致性与可复现
- 随机模式使用固定 `seed` 与确定性 RNG。
- 所有同刻事件按 `(priority, seq)` 稳定排序。
- 所有公式读取值的时机固定（快照 or 动态）并由规则配置控制。

## 8. V1 建议优先级
1. 先打通 `on_spell_cast` 与 `on_basic_attack_hit` 的统一分发。  
2. 再打通 `on_damage_dealt` 联动链。  
3. 然后实现 DoT 实例调度（`dot_tick_fire` + `schedule_tick`）。  
4. 最后补齐日志与回放校验（同输入一致）。  

## 9. 与现有文档关系
- 协议层：`WASM/引擎协议与数据结构.md`
- 规划层：`WASM/需要可以完成的挑战.md`
- 本文档：只定义 WASM 内部事件流转，不展开公式细节和代码实现细节。
