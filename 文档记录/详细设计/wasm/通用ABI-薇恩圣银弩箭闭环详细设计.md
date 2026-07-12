TASK_KEY: wasm-generic-vayne-silver-bolts
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-12

# 通用 ABI 薇恩圣银弩箭闭环详细设计

验证证据：[通用 ABI 薇恩圣银弩箭闭环验证记录](../../测试记录/wasm/通用ABI-薇恩圣银弩箭闭环验证记录-2026-07-12.md)

## 1. 目标与边界

目标是在通用 `engine_compile -> engine_run -> engine_release_session` ABI 内，用可复用的数据契约表达“同一提供者、同一目标连续命中三次后造成真实伤害并清零”的机制，不在 Wasm 中硬编码薇恩、技能或固定数值。

本任务覆盖 Wasm 通用运行时、Web combat-data 组装、Backend reserved type/seed 和发布数据。装备选择聚合、旧 `single_attacker_dps` lane 改造及其他英雄被动不属于本任务。

## 2. 数据所有权

- Backend 数据拥有 provider、状态字段、事件 matcher、阈值、真实伤害公式与挂载关系。
- Wasm 拥有公式编译执行、provider 状态生命周期、事件关系匹配和 operation 提交顺序。
- Web 拥有 combat-data 到 `CompileRequest` 的无损投影与 Wasm 产物同步。
- Planning 拥有设计决策和跨端验证证据。

## 3. 通用契约

### 3.1 条件公式

`OperationDefinition.condition` 为可选公式。公式结果非零时执行 operation，零时跳过。比较操作 `eq/ne/lt/lte/gt/gte` 返回数值 `1` 或 `0`，以便继续参与统一公式求值。

公式读取新增：

- `provider.state.<key>`：provider owner 级、与目标无关的状态。
- `provider.target_state.<key>`：provider owner 当前目标级状态。

### 3.2 状态作用域

- `state_scope/provider`：跟随 provider owner，不因目标切换清空。
- `state_scope/provider_target`：绑定 provider owner 的当前目标；目标改变时清空旧目标值。

`state_change` 支持 `add`、`override/set`。编译期只允许 `target=source/self`，状态实际归属由 provider owner 决定，避免把 provider 状态误写到事件来源或对手。

运行帧必须显式保存 provider owner combatant；ability、provider tick、provider listener 分别从其编译引用、tick 引用和 listener owner 取得该值。读取、暂存、提交和 snapshot materialization 使用同一个 owner key。

### 3.3 事件关系

listener 不使用无条件 source-owner gate。事件来源关系由 matcher type 表达：

- `event/source_owner`
- `event/source_opponent`

薇恩 W listener 使用 `match_mode/all`，同时匹配 `event/basic_attack_hit` 与 `event/source_owner`。其他受击型 listener 可选择 opponent 或不配置关系 matcher，不受薇恩规则反向限制。

## 4. 薇恩 W 数据图

1. 薇恩普攻伤害序列在伤害 operation 后发出 `event/basic_attack_hit`。
2. `provider_hero_vayne_silver_bolts` 挂载到 `hero_vayne`，声明 `silver_bolts_hits` 状态字段。
3. listener 的 ALL matcher 限定基本攻击命中且事件 source 为 provider owner。
4. 第一步对 `provider_target` 状态加一。
5. 第二步在 `gte(provider.target_state.silver_bolts_hits, 3)` 时造成真实伤害：`max($opponent.attr.hp.max * 0.06, 50)`。
6. 第三步在同一条件下把计数重置为零。

步骤顺序是契约的一部分：先累加，再判断伤害，最后清零。第四次命中从一层重新开始。

## 5. 写入范围

- Wasm：`wasm/tinygo_engine_v2/internal/{model,compile,formula,runtime}/**`
- Web：`web/src/types/genericEngine.ts`、`web/src/engine/combatDataAssembler*`、同步后的 `web/src/engine/wasm/tinygo_engine_v2.wasm`
- Backend：`db/game_manage/seeds/reserved_types_seed.sql`、`db/game_manage/seeds/lol_vayne_silver_bolts_seed.sql`、对应 SQL 静态契约测试与 README

## 6. 必须覆盖的回归

- 命中 1/2 不触发，命中 3 触发并清零，命中 4 不再次触发。
- provider owner 隔离；同一 provider 在不同 combatant 间不串状态。
- provider_target 切换目标后清空。
- snapshot hydration/materialization 与 tick/listener owner 一致。
- source-owner/source-opponent matcher 关系正确，受击型 listener 不被全局 owner gate 破坏。
- 非法 state scope、非法 state_change target 和错误公式在编译期失败。
- Web 保留 condition、state_change detail 和 ALL matcher 的全部成员。

## 7. 发布与回滚

Seed 必须幂等。live DB 依次执行 rollback dry-run、正式执行、完全相同脚本重跑；仅在数据发生变化时推进 current revision。seed 本身不自动 publish，发布通过 Backend Admin version 接口完成。
