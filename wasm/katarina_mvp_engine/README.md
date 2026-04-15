# katarina_mvp_engine

`katarina_mvp_engine` 是 Damage Viewer 当前的 Rust/Wasm 数值模拟内核。

它不是通用战斗框架，也不是前端页面层代码；当前职责是围绕固定 benchmark bundle，提供一条可构建、可测试、可做性能对比的 1v1 战斗模拟主链路。

## 模块定位

它在整条链路里的位置是：

1. 上游准备 `GameDataBundle` 与 benchmark 输入。
2. 当前 crate 在 Rust 侧编译 bundle、构建运行时、执行模拟。
3. 通过 JSON over Wasm memory 暴露 `engine_init` / `engine_run`。
4. Web 宿主通过 `web/src/engine/wasmBridge.ts` 和 `web/src/engine/worker.ts` 消费产物。

当前目标不是继续堆功能，而是优先保证：

- 模块边界清晰
- 回归测试稳定
- 性能基线可比较
- README 与代码现状同步

## 当前状态

当前版本已经完成一轮结构收敛，运行时代码拆分到 `engine`、`runtime`、`sim`、`effects`、`conversion_pipeline` 等模块，避免把模拟逻辑继续堆在单一超级文件里。

当前主链路覆盖的机制包括：

- 普攻
- `Mystic Shot`
- `Arcane Shift`
- `Damage Window Burst`
- 护盾生成与刷新
- 眩晕施加与过期
- DoT 调度与结算
- 吸血
- 黑切叠层与过期
- 反甲反伤
- 每秒生命回复 / 法力回复
- 缺蓝阻止施法
- 不同 `TestProfile` 下的机制隔离验证

当前常用验证基线：

- `cargo test`
- `cargo build --target wasm32-unknown-unknown --release`
- `cargo run --example perf_bench --release`

## 开发范围

默认主写入范围：

- `wasm/katarina_mvp_engine/**`
- `最小验证/**`
- 与 Wasm 构建、验证直接相关的 `tools/**`

默认只读参考：

- `web/**` 中的宿主桥接代码
- `server/**` 与 `db/**` 中的 bundle 来源
- `文档记录/**` 中与 Wasm 直接相关的设计说明

如果任务涉及 ABI、Wasm 产物复制或宿主桥接，才最小化联动 `web/src/engine/**`。

## 关键入口地图

第一次进入这个目录时，优先看这些文件：

| 文件 | 作用 |
| --- | --- |
| `AGENTS.md` | crate 级快速规则、完成定义、常见排查 |
| `src/lib.rs` | Wasm ABI 导出、响应缓冲、Rust 公共导出 |
| `src/engine.rs` | `init_session()`、`run()`、`run_full_battle()`、benchmark 路由 |
| `src/catalog.rs` | bundle 编译、编译期校验、运行时 catalog 组织 |
| `src/conversion_pipeline.rs` | 数据转换与运行时准备链路 |
| `src/runtime.rs` | `RuntimeState`、采样、日志、队列与状态对象 |
| `src/sim/**` | 战斗循环、调度、动作执行 |
| `src/effects/**` | 伤害、护盾、控制、状态效果结算 |
| `src/critical_strike.rs` | 暴击相关规则处理 |
| `examples/perf_bench.rs` | 性能基线与吞吐基准 |
| `build.ps1` | 本地构建 Wasm 产物 |
| `build-web-wasm.ps1` | 构建并复制到 `web/src/engine/wasm/` |

## 当前目录结构

```text
src/
  lib.rs
  engine.rs
  model.rs
  catalog.rs
  conversion_pipeline.rs
  formula.rs
  combat_math.rs
  critical_strike.rs
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
examples/
  perf_bench.rs
```

模块职责约定：

- `lib.rs`
  - Wasm ABI 导出
  - Rust 公共入口导出
  - 宿主共享响应缓冲
- `engine.rs`
  - 会话初始化
  - 主运行入口
  - benchmark route 解析
- `model.rs`
  - 外部 JSON ABI
  - 输入输出模型与错误码
- `catalog.rs`
  - benchmark bundle -> runtime catalog 编译
  - 编译期校验、默认值与结构整理
- `conversion_pipeline.rs`
  - 编译输入到运行时模型的转换链路
- `formula.rs`
  - benchmark 公式编译与求值
- `combat_math.rs`
  - 纯计算函数
  - 不允许依赖 `RuntimeState`
- `critical_strike.rs`
  - 暴击相关规则与计算辅助
- `types.rs`
  - 共享常量、纯类型、事件定义、runtime DTO
- `runtime.rs`
  - `ActorRuntime` / `RuntimeState`
  - 采样、队列、regen、公式桥接
- `sim/battle_loop.rs`
  - 事件循环、调度、动作选择入口
- `sim/action.rs`
  - 动作执行、DoT 调度、法力处理
- `effects/damage.rs`
  - 伤害包结算、减伤、吸血、post-hit
- `effects/status.rs`
  - 护盾、眩晕、黑切等状态处理

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

如果修改这些导出、返回结构或错误码，必须同步检查 `web/src/engine/wasmBridge.ts` 与相关文档。

## Benchmark 模式

当前主路径依赖 `GameDataBundle.benchmark`。

支持的 `TestProfile`：

- `full`
- `formula_bypass`
- `bucket_identity`
- `no_control`
- `no_shield`

这些 profile 用于机制隔离与回归测试，不是生产模式特性。

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

## 本地开发命令

当前目录没有单独的 `package.json` 风格脚本；本地开发默认直接使用 Cargo 与 PowerShell 脚本。

| 命令 | 用途 | 依赖 |
| --- | --- | --- |
| `cargo test` | 默认回归检查 | Rust 工具链 |
| `cargo build --target wasm32-unknown-unknown --release` | 生成发布用 Wasm | Rust 工具链、Wasm target |
| `./build.ps1` | 脚本化构建当前 crate | PowerShell、Rust 工具链 |
| `./build-web-wasm.ps1` | 构建并复制 Wasm 到 Web 侧 | PowerShell、Rust 工具链、`web/src/engine/wasm/` |
| `cargo run --example perf_bench --release` | 跑性能基线与吞吐对比 | Rust 工具链 |

## 完成定义

按改动类型，默认最低验证标准如下：

| 改动类型 | 最低验证 |
| --- | --- |
| 只改 README / 设计文档 | 复核入口、命令、结构描述与当前代码一致 |
| 改 `src/**` Rust 逻辑 | `cargo test` + `cargo build --target wasm32-unknown-unknown --release` |
| 改 ABI / 输出 JSON / 复制脚本 | 在上面基础上追加 `./build-web-wasm.ps1`，并检查 `web/src/engine/**` |
| 改热路径 / 调度 / 伤害结算 / 公式 | 在上面基础上追加 `cargo run --example perf_bench --release` |
| 改结构拆分或模块入口 | 同步更新 README、相关设计文档与验证说明 |

如果当前任务只改文档，不必为了形式强跑构建；但必须保证文档与代码入口不脱节。

## 常见失败与排查

1. **找不到 `cargo` 或构建失败**
   - 先确认 Rust 工具链已安装。
   - 再确认 `wasm32-unknown-unknown` target 可用。
2. **`build-web-wasm.ps1` 失败**
   - 优先看前面的 `cargo build` 是否已失败。
   - 再检查目标产物 `target/wasm32-unknown-unknown/release/katarina_mvp_engine.wasm` 是否生成。
   - 最后检查 `web/src/engine/wasm/` 是否存在且可写。
3. **PowerShell 脚本无法执行**
   - 先确认当前 PowerShell 环境允许执行本地脚本。
   - 如果组织策略限制脚本执行，优先使用等价的 Cargo 命令完成构建，再人工复制产物。
4. **前端宿主调用异常**
   - 先对照 `src/lib.rs` 的 ABI 导出。
   - 再检查 `web/src/engine/wasmBridge.ts` 中的导出声明、响应读取与错误处理是否仍匹配。
5. **性能明显回退**
   - 优先核对热路径里是否引入了新的 `clone()`、临时 `Vec`、`to_string()` 或重复扫描。
   - 用 `perf_bench` 对照 `init_session`、`run_full_battle`、`run_damage_window_probe` 的变化趋势。

## 当前性能参考

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

## 协作说明

1. 这不是独立仓，而是 monorepo 下的 Wasm 专用 worktree。
2. 默认优先保证 `wasm/**` 可单独构建、单独测试、单独做性能对比。
3. 若改动影响 bundle 输入、ABI 或宿主桥接，至少同步检查 `web/src/engine/**` 与相关文档。
4. 当前没有独立前端式 `lint/test` 脚本约定；Rust 侧最低验证标准以上面的 Cargo / PowerShell 命令为准。
5. 项目记忆默认写到 `C:\project\obsidian-game\ai-remember\wasm专用\`，但这属于本机协作约定，不应阻塞仓库内代码工作。

## 开发规范

下面这些约束不是建议，是这个目录继续演进时默认应遵守的约定。

### 1. 模块所有权

- 新功能先判断所有权，再决定放到哪个文件。
- 不要按“文件太大了”机械拆分，要按“谁拥有这段逻辑”拆。
- `combat_math.rs` 只放纯函数。
- `runtime.rs` 负责状态对象，不负责变成新的总入口门面。
- `sim/*` 负责战斗流程、动作执行、调度。
- `effects/*` 负责伤害与状态效果结算。
- `catalog.rs` 与 `conversion_pipeline.rs` 只做编译、转换与校验，不直接承担 runtime 行为。

### 2. Import 约定

- 不要重新引入 `pub use crate::types::*` 这类 runtime 门面。
- 调用方应直接从拥有者模块 import，而不是都从 `runtime` 兜底拿。
- 不要同时保留旧平铺文件和新模块树。
  - 已经有 `sim/mod.rs` 时，不要再保留旧的 `sim.rs`
  - 已经有 `effects/mod.rs` 时，不要再保留旧的 `effects.rs`

### 3. 纯函数边界

- 纯计算必须放在 `combat_math.rs` 或其他明确的纯逻辑模块。
- 纯函数不允许：
  - 依赖 `RuntimeState`
  - 写日志
  - push event
  - 修改 actor 状态
- 冷却、减伤、数值四舍五入这类逻辑只能保留一份实现，不能复制粘贴到别的运行时模块。

### 4. 性能约定

- `engine.rs`、`runtime.rs`、`sim/*`、`effects/*` 是热路径，新增逻辑默认要考虑分配成本。
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
