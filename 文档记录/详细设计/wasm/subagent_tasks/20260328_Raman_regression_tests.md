TASK_KEY: wasm-benchmark-regression
DOC_TYPE: 任务单
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: pending

# Raman 任务单：Review 回归测试补齐

## 写入范围

- `wasm/katarina_mvp_engine/src/benchmark_review_regressions.rs`

不要修改：

- 现有测试文件
- `lib.rs`
- 引擎实现文件
- 文档

## 背景依据

- `wasm/20260328版review报告.md`
- `wasm/WASM详细设计.md`

## 任务目标

新增一个 review 对应的回归测试模块，只补新增用例，不改现有 `benchmark_tests.rs`。

覆盖这些缺口：

1. 普攻本体 / 吸血刀物理附伤可触发黑切
2. 数3每 3 次命中触发一次真实伤害并清零
3. 反甲回击会对我方造成魔法伤害
4. 生命偷取具体数值基于 `dealt_damage`，即使存在护盾也不退化成 `hp_damage`
5. 完整自动战斗中敌方确实行动，至少能观察到护盾或眩晕进入时间线 / 日志

## 约束

- 不修改 `lib.rs`
- 如果需要模块注册，请在结果中明确告诉主控需要补哪一行
- 尽量复用现有 benchmark helper 风格；必要时可在新测试文件内复制最小 helper

## 交付要求

- 最终回复必须包含：
  - 你创建的文件路径
  - 新增测试名称
  - 主控需要在 `lib.rs` 里补的接线
