# katarina_mvp_engine

`katarina_mvp_engine` 是一个以 benchmark 场景为核心的 Rust/Wasm 1v1 战斗引擎 MVP。

它当前的目标不是“通用战斗框架”，而是：

- 围绕固定 benchmark bundle 跑通一条可自测、可回归、可做性能比较的战斗链路
- 通过稳定的 `cargo test` 和 `perf_bench` 约束机制演进
- 先把模块边界、可维护性和性能基线立住，再继续扩功能

## 当前状态

当前版本已经完成一轮结构重构，核心变化是把原来的 `sim.rs` / `effects.rs` 超级文件拆成子模块，并把冷却计算等纯逻辑从 runtime 状态层中分离出来。

当前实际验证结果：

- `cargo test`：`32/32` 通过
- `cargo run --example perf_bench --release`：通过
- `cargo build --target wasm32-unknown-unknown --release`：应作为发布前检查项继续保留

当前主链路覆盖的机制包括：

- 普攻
- Mystic Shot
- Arcane Shift
- Damage Window Burst
- 护盾生成与刷新
- 眩晕施加与过期
- DoT 调度与结算
- 吸血
- 黑切叠层与过期
- 反甲反伤
- 每秒生命回复 / 法力回复
- 缺蓝阻止施法
- 不同 test profile 下的机制隔离验证

## 模块结构

当前 `src/` 目录结构：

```text
src/
  lib.rs
  model.rs
  catalog.rs
  formula.rs
  combat_math.rs
  types.rs
  runtime.rs
  sim/
    mod.rs
    battle_loop.rs
    action.rs
  effects/
    mod.rs
    damage.rs
    status.rs
  benchmark_fixture.rs
  benchmark_tests.rs
  benchmark_review_regressions.rs
```

模块职责约定：

- `lib.rs`
  - Wasm ABI 导出
  - Rust 公共入口导出
- `model.rs`
  - 外部 JSON ABI
  - 输入输出模型与错误码
- `catalog.rs`
  - benchmark bundle -> runtime catalog 编译
  - 编译期校验、默认值与结构整理
- `formula.rs`
  - benchmark 公式编译与求值
- `combat_math.rs`
  - 纯计算函数
  - 不允许依赖 `RuntimeState`
- `types.rs`
  - 共享常量、纯类型、事件定义、runtime DTO
- `runtime.rs`
  - `ActorRuntime` / `RuntimeState`
  - 采样、队列、regen、公式桥接
  - 少量状态变更 helper
- `sim/battle_loop.rs`
  - 事件循环、调度、动作选择入口
- `sim/action.rs`
  - 动作执行、DoT 调度、法力处理
- `effects/damage.rs`
  - 伤害包结算、减伤、吸血、post-hit
- `effects/status.rs`
  - 护盾、眩晕、黑切状态处理
- `benchmark_fixture.rs`
  - 仅测试使用
  - 通过 `#[cfg(test)]` 编译

## 对外接口

Rust 公共接口：

- `init_session(payload)`
- `run(session, input)`
- `run_full_battle(session)`

Wasm ABI：

- `alloc(len) -> *mut u8`
- `dealloc(ptr, len)`
- `engine_init(ptr, len) -> i32`
- `engine_run(ptr, len) -> i32`
- `engine_response_ptr() -> *const u8`
- `engine_response_len() -> usize`

返回格式仍是 JSON over Wasm memory：

成功：

```json
{
  "ok": true,
  "value": {}
}
```

失败：

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_INPUT",
    "message": "..."
  }
}
```

## Benchmark 模式

当前主路径依赖 `GameDataBundle.benchmark`。

支持的 `TestProfile`：

- `full`
- `formula_bypass`
- `bucket_identity`
- `no_control`
- `no_shield`

这些 profile 的作用是做机制隔离与回归测试，不是生产模式特性。

当前 `EngineActionPlan` 支持：

- `basic_attack`
- `cast_skill`

当前主要 benchmark 行为对应的 action behavior：

- `basic_attack`
- `mystic_shot`
- `arcane_shift`
- `damage_window_burst`
- `generate_shield`
- `stun`

## 输出结构

`EngineRunOutput` 当前包含：

- `result`
- `samples`
- `events`

`result` 提供总览结果，例如：

- `stopReason`
- `timeToKillEnemyMs`
- `timeToDieMs`
- `totalDamageToEnemy`
- `totalDamageToSelf`
- `executedHits`
- `actionDurationMs`

`events` 是聚合后的伤害事件流，每个事件包含：

- `sequence`
- `tMs`
- `label`
- `enemyHpBefore`
- `enemyHpAfter`
- `totalRawDamage`
- `totalDealtDamage`
- `components[]`

`RuntimeLog` 仍用于更细的内部机制验证，例如：

- 动作选择 / 阻塞
- 冷却变化
- 护盾变化
- 黑切叠层 / 过期
- 眩晕开始 / 结束
- HP 回复 / 法力回复
- 法力消耗

## 构建、测试与性能

本地测试：

```powershell
cd wasm/katarina_mvp_engine
cargo test
```

构建 Wasm：

```powershell
cd wasm/katarina_mvp_engine
cargo build --target wasm32-unknown-unknown --release
```

复制产物到 Web 侧：

```powershell
cd wasm/katarina_mvp_engine
./build-web-wasm.ps1
```

性能基准：

```powershell
cd wasm/katarina_mvp_engine
cargo run --example perf_bench --release
```

一轮本地参考结果（Windows，本仓库当前代码）：

- `init_session` 平均约 `54.6 us`
- `run_full_battle` 平均约 `207.6 us`
- `run_damage_window_probe` 平均约 `13.9 us`
- 多线程吞吐大致在：
  - `2T` 约 `7.0k ops/s`
  - `6T` 约 `19.3k ops/s`
  - `14T` 约 `32.8k ops/s`
  - `28T` 约 `40.7k ops/s`

这些数字只代表当前 benchmark 规模下的 Rust 内核表现，不代表最终浏览器端到端性能。

## 开发规范

下面这些约束不是建议，是这个目录继续演进时默认应遵守的约定。

### 1. 模块所有权

- 新功能先判断所有权，再决定放到哪个文件。
- 不要按“文件太大了”机械拆分，要按“谁拥有这段逻辑”拆。
- `combat_math.rs` 只放纯函数。
- `runtime.rs` 负责状态对象，不负责变成新的总入口门面。
- `sim/*` 负责战斗流程、动作执行、调度。
- `effects/*` 负责伤害与状态效果结算。
- `catalog.rs` 只做编译与校验，不参与 runtime 行为。

### 2. Import 约定

- 不要重新引入 `pub use crate::types::*` 这类 runtime 门面。
- 调用方应直接从拥有者模块 import，而不是都从 `runtime` 兜底拿。
- 不要同时保留旧平铺文件和新模块树。
  - 例如已经有 `sim/mod.rs` 时，不要再保留旧的 `sim.rs`
  - 已经有 `effects/mod.rs` 时，不要再保留旧的 `effects.rs`

### 3. 纯函数边界

- 纯计算必须放在 `combat_math.rs`。
- 纯函数不允许：
  - 依赖 `RuntimeState`
  - 写日志
  - push event
  - 修改 actor 状态
- 冷却、减伤、数值四舍五入这类逻辑只能保留一份实现，不能复制粘贴到 `engine.rs` 或其他模块。

### 4. 性能约定

- `sim/*`、`effects/*`、`runtime.rs` 是热路径，新增逻辑默认要考虑分配成本。
- 在热路径里新增 `clone()`、`to_string()`、临时 `Vec`、重复扫描前，先确认是否必要。
- 改动 battle loop、damage resolve、cooldown、DoT、post-hit 逻辑后，至少跑一次：
  - `cargo test`
  - `cargo run --example perf_bench --release`
- 如果 `run_full_battle` 或多线程吞吐出现明显回退，默认当成回归处理，先解释原因再合并。

### 5. 测试约定

- 新机制必须至少补一条回归测试。
- 机制隔离优先放到 `benchmark_review_regressions.rs`。
- 行为链路和主流程验证继续放在 `benchmark_tests.rs`。
- 如果改了路径结构、模块拆分或大小写，额外在 Linux / WSL 上跑一遍测试，避免 Windows 大小写不敏感掩盖问题。

### 6. 重构约定

- 重构按阶段做，每个阶段都必须可编译、可测试、可回滚。
- 不要把“迁移中间态”直接留在主分支。
- 旧入口文件、兼容 wrapper、临时桥接层在迁移完成后要尽快删掉。
- README、性能基线和测试覆盖说明要跟着结构变更一起更新。

## 当前边界

这版仍然有明确边界：

- 仍然是 benchmark 驱动的 1v1 MVP，不是通用战斗引擎
- 仍然依赖 benchmark bundle，不是正式前端编辑链路
- 公式系统仍是当前 benchmark 所需子集，不是完整 DSL
- Wasm ABI 稳定，但不代表上层业务协议已经冻结
- 当前性能基准覆盖 Rust 核心，不覆盖浏览器调用、序列化和前端渲染开销

后续如果继续扩展，应优先维护：

- 模块边界清晰
- 测试可回归
- 性能可对比
- 文档与现状同步
