TASK_KEY: server-wasm-db-gap
DOC_TYPE: 需求澄清
WORKSTREAM: server
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-04-30

# WASM + DB 补充设计 TODO

## 背景与范围
- 目标：基于 `wasm` 目录方案和 `db/game_manage/schema.sql`，补齐“可配置事件驱动伤害引擎”所需的关键设计缺口。
- 范围：只聚焦契约与设计，不包含本文件中的代码实现。
- 状态标记：`[ ]` 未开始、`[~]` 进行中、`[x]` 已完成。

## 现状快照（重新审视结论）
1. `formula_profiles/formula_bindings` 已有 mapper、Admin controller、service 写入链路，并已进入发布 bundle。
2. `attribute_definitions.value_kind/rate_target_attr_key` 已透出到 DTO/mapper/read-write 流程和 Public bundle。
3. `mechanics_config` 契约当前仍主要覆盖 `deal_damage/apply_modifier`，`heal/shield` 通道需要继续由 Wasm/runtime 契约收口。
4. WASM 文档是事件驱动主线，但“伤害/治疗/属性增减/护盾”尚未形成一套统一且可跨游戏切换的结算契约。

---

## P0（阻断后续联调）

### [x] P0-1 补齐 `attribute_definitions` 值类别契约闭环
- 当前实现：
  - DB 已有 `value_kind/rate_target_attr_key` 约束。
  - 后端 DTO/mapper/read-write 流程已暴露 `valueKind/rateTargetAttrKey`。
  - Public bundle 已返回这两个字段。
- 设计补充：
  1. 扩展 `AttributeDefinitionDTO` 与写入 DTO：新增 `valueKind`、`rateTargetAttrKey`。
  2. 明确默认值与兼容规则：未传时 `valueKind=scalar`，`rateTargetAttrKey=null`。
  3. 统一校验层级：
     - 请求入参校验（DTO）
     - 语义校验（`valueKind=rate` 必填 target）
     - 发布校验（bundle 内一致性）
  4. `bundle` 输出补齐这两个字段，保证 WASM 运行时无需猜测属性语义。
- 验收标准：
  - 管理端可创建/更新 `rate` 类型属性并通过发布。
  - Public bundle 可正确返回 `valueKind/rateTargetAttrKey`。
  - 非法组合可被拦截并返回明确错误码。

### [x] P0-2 公式中心（profile + binding）从“有表”变“可用链路”
- 当前实现：
  - DB 已有公式表与日志表。
  - 后端已实现公式相关 Admin 路径。
  - 发布 bundle 已包含 `formulaProfiles/formulaBindings`。
- 设计补充：
  1. 补齐接口契约：
     - `PUT/PATCH/GET` formula profiles
     - `PUT/PATCH/GET` formula bindings
  2. 统一主键与唯一性策略：
     - profile: `(gameId, formulaId)`
     - binding: `(gameId, targetCategory, targetId, bindingKey)`
  3. 补齐发布链路：
     - 版本推进
     - log 表回填
     - 参与发布快照生成
  4. `bundle` 增加 `formulaProfiles/formulaBindings` 字段，供前端/WASM 初始化消费。
  5. 语义校验：
     - binding 引用公式必须存在
     - target 必须存在（skill/hero/item/global）
- 验收标准：
  - 公式模板和绑定可独立 CRUD。
  - 发布后 bundle 包含公式数据；前端以 `versionCode` / published snapshot 作为一致性标识，不再要求 public `dataHash`。
  - 非法 binding 在写入或发布阶段被阻断。

### [ ] P0-3 明确四条“状态变更通道”并固化到 mechanics 契约
- 目标：避免把所有数值变化都塞进 `deal_damage/apply_modifier`，导致后续语义混乱。
- 设计补充：
  1. 通道拆分：
     - `damage`：会经过减伤/护盾，最终影响 HP
     - `heal`：直接回复 HP（可被治疗增减修正）
     - `modifier`：改攻击/双抗/攻速等属性，不走护盾
     - `shield`：护盾实例的增减与生命周期
  2. 扩展动作类型（示例）：
     - `deal_damage`
     - `deal_heal`
     - `apply_modifier`
     - `apply_shield` / `remove_shield`
  3. 扩展触发事件（示例）：
     - `on_damage_taken`
     - `on_heal_done` / `on_heal_taken`
     - `on_shield_gain` / `on_shield_break`
  4. 兼容策略：旧配置仅含 `deal_damage/apply_modifier` 时保持行为不变。
- 验收标准：
  - 同一技能可在配置层表达“伤害+治疗+护盾+属性增减”复合效果。
  - 不需要写特判代码即可区分 HP 与非 HP 变更链路。

### [ ] P0-4 护盾交互机制单独设计并支持跨游戏规则切换
- 现状问题：
  - 仅把护盾当“一个属性值”不足以处理类型护盾、真实伤害穿透差异、优先级与过期。
- 设计补充：
  1. 运行时数据模型：`ShieldInstance`
     - `shieldId/sourceId/ownerId/amount`
     - `scope`（all/physical/magic/true/自定义标签）
     - `priority`
     - `expireAt`
  2. 伤害包模型：`DamagePacket`
     - `damageType`、`tags`
     - `flags`（如 `ignoreShield`）
  3. 交互矩阵（按游戏或模式可配置）：
     - `damageType x shieldScope -> consume | bypass | partial`
     - 示例：LoL 真伤可打通用护盾；某些游戏真伤可直接无视护盾。
  4. 结算顺序固化：
     - 先护盾吸收，再 HP 结算，再触发后置事件。
- 验收标准：
  - 使用不同 `gameId`/规则配置，不改引擎代码即可切换护盾交互行为。
  - 同输入重复运行结果稳定可复现。

---

## P1（高优先级设计完善）

### [ ] P1-1 深化 `mechanics_config` 静态校验规范
- 设计补充：
  1. `TriggerRule.id` 唯一。
  2. `stackId/tickKey` 引用必须已定义。
  3. `ExprNode.attr.key` 必须存在于 `attributeDefinitions`。
  4. 动作参数完整性（如 `deal_damage.amount` 不可空）。
  5. 嵌套 `if` 的深度/节点数上限，防止配置层过度复杂。
- 验收标准：
  - 非法规则在写入阶段被拒绝，不拖到运行时报错。

### [ ] P1-2 把“公式计算结果”和“状态应用结果”彻底解耦
- 设计补充：
  1. `formula_profile` 只定义“怎么算”。
  2. `mechanics action` 定义“算出来后应用到哪里”。
  3. 一个公式可被多个 action 复用（例如同一数值既用于伤害又用于护盾）。
- 验收标准：
  - 修改公式不需要改动作语义；修改动作不需要改公式实现。

### [ ] P1-3 Run 观测模型补齐（用于调试与回放）
- 设计补充：
  1. 在 `tick/done` 之外提供可选简化事件日志（按开关开启）。
  2. 事件日志至少包含：`tMs/eventType/source/target/valueBefore/valueAfter`。
  3. 护盾与治疗事件必须有独立日志类型，便于排错。
- 验收标准：
  - 能从日志解释一次 run 的关键血量变化来源。

### [ ] P1-4 接口文档与实现文档同步机制
- 设计补充：
  1. `文档记录/详细设计/server/game_manage/接口定义.md` 与 `文档记录/需求澄清/wasm/**`、`文档记录/概要设计/wasm/**`、`文档记录/详细设计/wasm/**` 的字段变更需双向更新。
  2. 约定“先改契约文档，再改代码”的评审门禁。
  3. 为 formula/heal/shield 扩展增加变更记录章节。
- 验收标准：
  - 评审中可一眼看到“文档契约 == 代码实现”。

---

## P2（MVP 后续增强）

### [ ] P2-1 跨游戏规则包抽象
- 设计补充：
  1. 引入 `combat_rule_profile`（表或 bundle 配置段）承载：
     - 护盾交互矩阵
     - 护甲/魔抗曲线策略
     - 暴击与特殊伤害规则
  2. 每个 `gameId/versionCode` 绑定一个规则 profile。
- 验收标准：
  - 接入第二款规则差异大的游戏时，不需要改核心引擎代码。

### [ ] P2-2 多目标/多单位扩展预留
- 设计补充：
  1. 当前保持 1v1 实现。
  2. 但事件与动作结构预留 `targetSelector`，避免后续重写协议。
- 验收标准：
  - 协议兼容可平滑扩展到 1vN。

---

## 推荐实施顺序（建议）
1. `P0-1` 属性值类别闭环。
2. `P0-2` 公式中心打通并进 bundle。
3. `P0-3` 四通道语义定稿。
4. `P0-4` 护盾交互机制定稿。
5. `P1-1` 静态校验增强。
6. `P1-2` 公式与动作彻底解耦。
7. `P1-3` 运行观测补齐。
8. `P1-4` 契约同步门禁。

## 依赖与关联
- Bundle 读写隔离以当前发布快照链路为准：Public 侧通过 `versionCode` 读取已发布快照，不从编辑工作区临时拼装。
