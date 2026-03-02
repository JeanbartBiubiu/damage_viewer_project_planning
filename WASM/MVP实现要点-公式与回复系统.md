# MVP 实现要点 - 公式与回复系统

## 1. 背景结论（已拍板）
- 属性录入阶段统一为“每秒”，不再维护 `per_5s/per_1s` 双单位。
- 属性定义需要区分值类别：`scalar | ratio | rate | flag`。
- 对于 `rate` 属性，必须声明它作用到哪个属性（`rate_target_attr_key`），不使用固定枚举（如 hp/mana/energy），以适配不同游戏。

## 2. DB 契约（game_manage）
- `attribute_definitions` 与 `attribute_definitions_log` 新增：
  - `value_kind`：`scalar | ratio | rate | flag`
  - `rate_target_attr_key`：仅 `value_kind=rate` 时必填
- 约束：
  - `value_kind=rate` -> `rate_target_attr_key IS NOT NULL`
  - `value_kind!=rate` -> `rate_target_attr_key IS NULL`

## 3. 运行时结算模型（事件驱动）
- 不做帧循环；采用“惰性更新”：
  - 实体维护 `last_update_ms`
  - 在需要读取状态/判定施法时，先把状态推进到 `now_ms`
- 推荐施法流程：
  1. `applyStateUntil(now_ms)`（回复、持续效果等）
  2. 读取当前资源并判定是否可施法
  3. 扣资源、写入冷却结束时间、派发事件

## 4. 回复属性计算规则
- `rate` 属性含义：每秒变化量（可为负数）
- 对于某个 `rate` 属性 `r`：
  - `delta = r_value_per_sec * dt_seconds`
  - 累加到 `rate_target_attr_key` 指向的属性
- 示例：
  - `hp_regen`：`value_kind=rate`，`rate_target_attr_key=hp`
  - `mana_regen`：`value_kind=rate`，`rate_target_attr_key=mana`

## 5. 公式系统（可复用，不按技能硬编码）
- 公式定义：`formula_profiles`
- 公式绑定：`formula_bindings`
- 技能/英雄/装备只绑定 `formula_id`，不重复写公式逻辑。
- 同一游戏内 A/B 技能使用同一冷却公式时，仅复用同一个 `formula_id`。

## 6. 伤害类型覆盖策略
- 单次结算允许输出多个伤害分量：
  - `physical`
  - `magic`
  - `true`
- 每个分量按自身减伤链计算，再汇总。
- 可覆盖混合伤害（物理+魔法）场景。

## 7. 精度与边界建议
- 使用整数时间（ms）+ 定点数（或统一高精度小数）避免浮点边界误差。
- 资源判定统一在“推进到当前时刻”之后执行，避免“晚释放”误判。
- 性能上保证 O(1) 结算：只更新参与当前事件的实体，不全量扫描。

## 8. MVP 范围内暂不做
- 复杂脚本表达式执行引擎
- 公式热更新与沙箱
- 跨实体高阶联动（后续在 formula params/事件系统扩展）
