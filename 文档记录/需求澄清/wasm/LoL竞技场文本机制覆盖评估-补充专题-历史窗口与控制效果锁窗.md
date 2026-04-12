TASK_KEY: wasm-lol-entity-coverage-audit
DOC_TYPE: 需求澄清
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-04-11 00:00:00

# LoL竞技场文本机制覆盖评估-补充专题-历史窗口与控制效果锁窗

日期：2026-04-11
状态：补充修正

## 目标

这页只回答一个问题：基于新增样本回看后，之前的 LoL 竞技场分类是不是漏了重要家族。

结论是：`是`。此前按首批高频样本收口得到的 4 层主轴还能保留，但对“英雄 / 装备 / 符文 / 海克斯强化”的全量遍历来说，至少还缺两类必须显式建模的语义：

- `history_window`
- `control_runtime_and_repeat_gate`

问题不在公式 AST，而在审计脚本和实现口径把一些真实语义误吸进了 `remaining_charges`、`damage_formula_base` 或 `filter_out_of_scope`。

## 1. 历史窗口家族

### 1.1 为什么之前漏掉了

- `Sett W`、`Dr. Mundo W`、`Mordekaiser W` 之前被误吸进 `remaining_charges` 或直接过滤。
- 这类机制的核心不是“还能放几次”，而是“最近窗口累计值”和“消费这个值”。
- 仓库里其实已经有独立任务 [概要设计-历史值追踪与时间窗口机制.md](C:/project/damage_viewer_project_planning/文档记录/概要设计/wasm/概要设计-历史值追踪与时间窗口机制.md)，之前只是没有接回 LoL 审计分类。

### 1.2 现在稳定下来的模板

- `damage_memory_window`
- `gray_health_window + recast_burst`
- `damage_exchange_memory + consume_to_shield_heal`
- `damage_memory_window + consume_to_shield_damage`
- `damage_memory_window + cleanse_cc`
- `state_snapshot_rewind`

### 1.3 代表样本

- `Sett W`
- `DrMundo W`
- `Mordekaiser W`
- `Rengar W`
- `Tahm Kench E`
- `Pyke P`
- `Ekko R`

### 1.4 最小运行时口径

- 优先复用现有 `wasm-history-window` 任务里的 `TemporalRingBuffer`
- 按窗口类型挂到运行时，而不是继续塞回节奏层
- 最小字段只需要：
  - `window_kind`
  - `window_ms`
  - `decay_rule`
  - `consume_rule`
  - `value_selector`

## 2. 控制结果态与重复施放限制

### 2.1 为什么之前漏掉了

- `Taric E`、`Vi R`、`Malphite R` 之前会被压成纯伤害条目。
- `Olaf R`、`augment:112` 这类明确的控制免疫会被过滤。
- `Yasuo E`、`Udyr E` 这种“每目标锁窗 / 每目标冷却”没有被单列，链式控制风险不可见。

### 2.2 现在稳定下来的模板

- `control_apply`
- `control_immunity_window`
- `defensive_window`
- `per_target_lockout`
- `control_apply + control_immunity_window`
- `control_apply + per_target_lockout`
- `per_target_lockout + damage_ramp`

### 2.3 代表样本

- `Ambessa R`
- `Jhin W`
- `Taric E`
- `Udyr E`
- `Yasuo E`
- `Malphite R`
- `Vi R`
- `Olaf R`
- `augment:11`
- `augment:112`

### 2.4 对竞技场额外规则的推广

用户提到的“`N` 秒内被控超过 `M` 秒就获得一个霸体 buff”不需要再发明新的神秘顶层。

更稳的表达是：

- `recent_cc_duration_window`
- `counter_state + stack_threshold_proc`
- `defensive_window`

也就是：

1. 先用历史窗口累计最近 `N` 秒内承受的控制时长
2. 达到阈值 `M` 后触发
3. 结果态落到 `defensive_window`

## 3. 修正后的分类结论

### 3.1 对全量遍历来说，之前确实少了东西

之前“4 层就够”的说法只对首批高频样本成立；全量审计里至少还要显式补上：

- `history`
- `control`

### 3.2 但这不意味着要推翻旧口径

- `mark / attr / tempo / counter` 仍然是主轴
- `history` 更像把已有实现任务接回 LoL 分类
- `control` 更像把之前被过滤或压扁的语义抬出来

### 3.3 当前最稳的实现方向

- 不把 `remaining_charges` 再当成“储存值 / 二段施放 / 每目标锁窗”的垃圾桶
- 不把 `damage_formula_base` 再当成“带硬控技能”的默认归宿
- 不把 `control immunity / unstoppable / defensive window` 再直接过滤掉
- `ability_on_hit_bridge` 仍然可以继续 deferred，不影响这轮补分类

## 4. 本轮继续扫描后的残留

继续扫剩余样本后，当前最明显的残留不是“又少了一整个新顶层”，而是主表还不擅长表达“主机制 + repeat_gate”的复合行。

代表条目：

- `JarvanIV passive`
  - 主语义是 `damage_formula_ratio`
  - 但同时带“数秒内不能重复作用于同一目标”的 `per_target_lockout`

这类条目说明后续如果还要继续压缩误分，最自然的增量不是再扩 `runtimeLayer`，而是给审计表补一个横向字段，例如：

- `repeatGate`
- `secondaryEffectTags`

当前阶段先不强行改主表结构，先把它记成“复合机制表达能力不足”的剩余风险。

## 5. 本轮判断

这轮补充后，更接近真实情况的口径是：

- 审计层最少需要 `formula / sustain / trigger / mark / attr / tempo / counter / history / control / filter`
- 运行时层最少需要在旧草案上补回 `historyWindows` 和 `controlRuntime`
- 竞技场里“短窗承伤”“短窗受控累计”“每目标锁窗”“霸体/0伤害结果态”都不该再算边角例外
