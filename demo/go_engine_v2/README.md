# Go Engine V2 Demo

这个目录是一个可读性优先的 Go 版战斗 demo。它不是现有 Rust wasm 内核的翻译件，而是按 `demo/java_engine_v2` 的 benchmark battle 场景，抽出最小可比的机制集合，用来回答两个问题：

1. Go 版 wasm 的体积大概有多大。
2. Go 版 wasm 在一个代表性 1v1 场景下能跑到什么量级。

当前支持的机制子集：

- 数据驱动的角色 / 动作 / 状态 / 物品 / 伤害 profile / 公式定义
- 常量、属性、输入值、加法、乘法、最大值、除法、符号分支公式
- 物理 / 魔法 / 真实伤害结算
- 法力消耗、冷却
- `ON_ACTION_CAST` 触发挂盾 / 眩晕
- `ON_DAMAGE_TAKEN` 触发反伤
- 状态过期事件队列

当前没有实现 Java demo 的完整能力，例如计数器、暴击、充能、自动重复、属性修改状态、历史窗口等。这个 demo 的目标是评估 Go wasm，可比对象是同一条 benchmark 场景，不是 Java demo 的全量功能覆盖率。

## 目录

- `enginev2demo/` 核心引擎与 benchmark fixture
- `cmd/bench` 原生 Go benchmark 入口
- `cmd/wasm` Go wasm 导出入口
- `build-wasm.ps1` 构建 wasm 与输出体积
- `scripts/bench_wasm.mjs` 用 Node 跑 wasm benchmark

## 本地验证

```powershell
go test ./...
go run ./cmd/bench
./build-wasm.ps1
node ./scripts/bench_wasm.mjs
```

## wasm 导出

Go wasm 通过 `syscall/js` 暴露两个函数到 `globalThis.goEngineV2Demo`：

- `runBenchmarkBattle()`: 返回单次战斗 summary 的 JSON 字符串
- `measureBenchmark(warmup, samples)`: 返回 init/run 内部 benchmark 报告的 JSON 字符串

Node 脚本默认按“每次宿主调用一次 wasm 战斗”的方式测量，这样能把真实的 JS -> Go wasm 调用成本算进去。
