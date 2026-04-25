TASK_KEY: wasm-core-runtime-dataflow
DOC_TYPE: 任务单
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: pending

# Ptolemy 任务单：战斗调度与完整战斗流

## 写入范围

- `wasm/katarina_mvp_engine/src/sim.rs`

不要修改：

- `effects.rs`
- `runtime.rs`
- 测试文件
- 文档

## 背景依据

- `wasm/20260328版review报告.md`
- `wasm/WASM详细设计.md`

## 任务目标

1. 让 `run_minimal_benchmark_battle` 在 `t=0` 真正种入敌方相关事件，使敌方护盾/眩晕参与完整战斗时间线。
2. 自方自动决策在完整战斗中正确受控制效果影响，不要只在隔离测试路径里生效。
3. 将普攻冷却启动逻辑统一收入 `execute_` 路径，不再依赖调用方补 `start_action_cooldown(...)`。
4. 修正 `sim.rs` 所有物理分量的黑切 flag：
   - 普攻本体 -> 应触发黑切
   - 吸血刀物理附伤 -> 应触发黑切
   - 秘术射击本体 -> 应触发黑切
   - 魔法刀 / 奥术跃迁 / 面具 DoT -> 不应触发黑切
5. 给 `FormulaBypass` fallback 常量补简短注释，说明它们属于测试 profile 的固定口径。

## 交付要求

- 不要回退他人改动
- 如果发现邻近逻辑已被其他人调整，适配它，不要强推旧实现
- 最终回复必须包含：
  - 你改了什么
  - 改动文件路径
  - 任何需要主控进一步集成的注意点
