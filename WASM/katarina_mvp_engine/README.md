# katarina_mvp_engine

当前 `katarina_mvp_engine` 已不再是最早那版 Katarina/BORK/Nashor 的单点伤害样例，而是一个“测试基准驱动”的 Rust Wasm MVP 引擎。

这版实现的定位很明确：

- 先围绕 [测试基准.md](..\测试基准.md) 跑通一条可自测、可回归的 1v1 战斗链路
- 用稳定的 benchmark fixture 和验收测试验证主机制
- 暂不追求通用公式系统、正式前端数据接入和多单位通用引擎能力

对应设计与验收文档：

- [测试基准.md](..\测试基准.md)
- [详细设计-测试基准驱动Wasm实施方案.md](..\详细设计-测试基准驱动Wasm实施方案.md)
- [验收方案-测试基准驱动Wasm.md](..\验收方案-测试基准驱动Wasm.md)
- [性能测试报告-当前M1基准.md](..\性能测试报告-当前M1基准.md)

## 当前状态

当前实现已经达到一个可 review 的 M1 里程碑：

- benchmark fixture 已接入真实运行链路
- `cargo test` 当前为 `21/21` 通过
- `cargo build --target wasm32-unknown-unknown --release` 通过

当前主链路覆盖：

- 固定属性初始化
- 普攻
- 秘术射击
- 奥术跃迁
- 攻击特效
- 生命偷取
- 普通护盾
- 黑切叠层与过期
- 面具 DoT
- 眩晕阻断
- 生命回复 / 法力回复
- 蓝量不足禁止施法

## 模块结构

`src/` 目录当前结构：

```text
src/
  benchmark_fixture.rs   # 基准角色、装备、技能、固定属性与默认规则
  benchmark_tests.rs     # 基于测试基准的验收测试
  catalog.rs             # benchmark fixture -> compiled catalog
  effects.rs             # 伤害、护盾、偷取、DoT、黑切、眩晕等效果处理
  engine.rs              # init/run 入口，benchmark 路由与测试辅助
  lib.rs                 # Wasm ABI 导出
  model.rs               # 外部 JSON ABI 与公共模型
  runtime.rs             # RuntimeState / ActorRuntime / 事件日志 / 冷却 / 回复
  sim.rs                 # 事件调度、自动战斗循环、benchmark 行为选择
```

## Wasm ABI

当前对外 ABI 仍然是 JSON over Wasm memory：

- `alloc(len) -> *mut u8`
- `dealloc(ptr, len)`
- `engine_init(ptr, len) -> i32`
- `engine_run(ptr, len) -> i32`
- `engine_response_ptr() -> *const u8`
- `engine_response_len() -> usize`

成功响应：

```json
{
  "ok": true,
  "value": {}
}
```

失败响应：

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_INPUT",
    "message": "..."
  }
}
```

其中：

- `engine_init` 接收 `EngineInitPayload`
- `engine_run` 接收 `EngineRunInput`
- benchmark 模式通过 `engineConfig.testProfile` 启用

## Benchmark 模式

当前 M1 主要依赖内部 benchmark fixture，而不是正式前端 bundle。

当 `engineConfig.testProfile` 有值时，会编译 benchmark catalog，并走 benchmark 路由。当前支持的 profile：

- `full`
- `formula_bypass`
- `bucket_identity`
- `no_control`
- `no_shield`

这些 profile 的作用是做机制隔离测试，不是生产模式能力。

## 当前支持的 benchmark 行为

对外 `EngineActionPlan` 仍是：

- `basic_attack`
- `cast_skill`

但在 benchmark 路径下，当前只支持这些测试基准技能：

- `skill_basic_attack`
- `skill_mystic_shot`
- `skill_arcane_shift`
- `skill_generate_shield`
- `skill_stun`
- `skill_benchmark_black_cleaver_probe`
- `skill_benchmark_final_kill`

其中：

- `skill_benchmark_black_cleaver_probe` 和 `skill_benchmark_final_kill` 仅用于验收测试
- 真正的完整战斗计算走 `sim.rs` 的自动调度，不是手工拼结果

## 输出结构

`EngineRunOutput` 当前包含：

- `result`
- `samples`
- `events`

每个 `event` 表示一次聚合命中结算，包含：

- `sequence`
- `tMs`
- `label`
- `enemyHpBefore`
- `enemyHpAfter`
- `totalRawDamage`
- `totalDealtDamage`
- `components[]`

每个 `component` 包含：

- `sourceKind`: `basic_attack | skill | item`
- `sourceId`
- `label`
- `damageType`: `physical | magic | true`
- `rawDamage`
- `dealtDamage`

当前 benchmark 路径还会在运行时记录更细的 `RuntimeLog`，用于验收这些中间状态：

- 护盾变化
- 黑切叠层 / 过期
- 眩晕开始 / 结束
- 冷却变更
- HP 回复 / 蓝量回复
- 蓝量消耗
- 动作被阻止的原因

## 测试覆盖

当前 benchmark 验收测试覆盖这些场景：

- `T01` 初始化编译
- `T02` 首次普攻
- `T03` 首次秘术射击
- `T04` 首次奥术跃迁
- `T05` 护盾生成与刷新
- `T06` 眩晕阻断
- `T07` 黑切过期与护甲恢复
- `T08` 最终击杀与结果完整性
- `T09` `no_shield`
- `T10` `bucket_identity`
- `T11` `no_control`
- `T12` `formula_bypass`
- `T13` 每秒生命回复
- `T14` 每秒法力回复
- `T15` 蓝量不足阻止直接施法
- `T16` 自动战斗在缺蓝时回退到可释放动作

此外还保留了一组非 benchmark 的旧 `engine.rs` 核心测试，保证现有 JSON ABI 与基础数值路径不被误改。

## 构建与测试

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

如果需要把产物复制到 web 项目，可继续使用：

```powershell
./build-web-wasm.ps1
```

## 当前性能快照

基于 [性能测试报告-当前M1基准.md](..\性能测试报告-当前M1基准.md)：

- 初始化时间平均约 `5.385 us`
- 一次完整 benchmark 战斗计算平均约 `80.593 us`
- 当前基准配置下，敌方生命值在模拟时间 `21789 ms` 时归零
- 当前完整击杀链路稳定为 `43` 次命中

这些数字只代表当前内核和当前 benchmark 规模，不代表最终浏览器端到端性能。

## 当前边界

这版实现已经适合做 code review、回归测试和后续扩展，但仍然有明确边界：

- 仅覆盖当前测试基准，不是正式通用战斗引擎
- 仅支持 1v1
- 尚未接入正式前端 bundle / 编辑后台数据
- 尚未实现通用公式解释器
- 尚未实现多单位、多目标、复杂动作 DSL
- 性能报告只覆盖 Rust 内核，不含 Wasm FFI / 浏览器调用开销

如果后续继续扩展，应始终以 benchmark 文档和验收文档作为当前阶段的权威基准，而不是直接把现有实现误当成最终架构。
