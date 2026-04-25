TASK_KEY: wasm-effects-runtime-hardening
DOC_TYPE: 任务单
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: pending

# Godel 任务单：效果层与状态正确性

## 写入范围

- `wasm/katarina_mvp_engine/src/effects.rs`
- `wasm/katarina_mvp_engine/src/runtime.rs`

不要修改：

- `sim.rs`
- 测试文件
- 文档

## 背景依据

- `wasm/20260328版review报告.md`
- `wasm/WASM详细设计.md`

## 任务目标

1. 实现“数3”机制：
   - 命中累计标记
   - 达到 3 层后额外造成 `1% * 目标最大生命值` 真实伤害
   - 触发后标记重置为 0
2. 实现反甲回击：
   - 条件：受到“可以触发攻击特效”的攻击
   - 结果：对攻击者造成 `10 + 0.1 * 自身护甲` 的魔法伤害
3. 将生命偷取计算基准改为 `dealt_damage`，不要基于护盾吸收后的 `hp_damage`。
4. 处理 `apply_status_effects_after_hit`：
   - 要么落实为真实后置阶段
   - 要么删除这个空 stub，避免误导
   - 请选择更稳妥的方案并说明原因
5. 保证现有 profile 行为不被破坏。

## 交付要求

- 不要回退他人改动
- 如果发现邻近逻辑已被其他人调整，适配它，不要强推旧实现
- 最终回复必须包含：
  - 你改了什么
  - 改动文件路径
  - 对主控的集成注意事项
