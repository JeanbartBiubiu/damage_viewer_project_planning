# TinyGo Engine V2

浏览器内运行的确定性数值计算引擎。正式业务链为 `engine_compile → engine_run → engine_release_session`；浏览器后台工作线程是正式宿主，Node脚本用于本地验证。当前约束见[模块规则](AGENTS.md)，调用关系见[架构图](ARCHITECTURE.md)。

## 源码与职责

| 入口 | 职责 |
| --- | --- |
| `cmd/engine_wasm/`、`internal/base/abi/` | 正式导出、请求帧、线性内存及输出缓冲 |
| `internal/model/`、`internal/plan/`、`internal/compile/` | 共享协议、只读执行计划及规则编译 |
| `internal/runtime/` | 会话登记、请求身份检查及单场运行组合 |
| `internal/runtime/execution/` | 门禁、命中、监听、因果、预检与统一提交 |
| `internal/scheduler/` | 唯一时钟、稳定队列、循环与停止账 |
| `internal/runtime/actor/`、`action/`、`effect/` | 角色数值、行动过程与效果实例的私有状态 |
| `internal/formula/`、`internal/pipeline/` | 战斗输入绑定与数值结算；管道同时承接命令、资源计算和护盾底层值 |
| `internal/runtime/report/` | 可靠累计、有界记录及观察采样 |
| `internal/base/` | 六个稳定基础包，详见[基础层说明](internal/base/README.md) |
| `internal/testkit/`、`tests/runtime/` | 固定构造输入及公开入口的组合回归 |

具体类型的 `类型名API` 声明列出公开能力及中文约束，实际高频调用优先使用具体类型。共享字段与完整返回值查 `internal/model/`，数学结构查[共同公式](../../contracts/formula/README.md)；不再另抄一套逐方法详细设计。

当前责任与剩余边界见[子系统现状](../../文档记录/概要设计/项目/Wasm子系统职责与协作现状及调整方向.md)，有限排程与决策接口见[待讨论草案](../../文档记录/概要设计/项目/Wasm子系统接口设计草案.md)。草案不代表已实现方法。

## 运行边界

只读编译计划可以复用，每场状态独立。事件时间、实际来源与完整使用身份必须明确；数值读取保留缺失与有效0的区别。数值管道产生结果，所属子系统暂存，执行层按现有帧边界发布；不能推断整条派生链可回滚。

可靠累计、战斗预算、明细限额和采样分别负责；明细截断不改变数值。通用操作存在不等于任意管理配置可以运行，具体对象仍需生产适配、机制范围及首次运行验收。

## 构建工具与正式产物

正式工具链固定Go 1.25.2、TinyGo 0.40.1和Binaryen 129，构建脚本会检查版本。目标配置 `targets/wasm-256m.json` 固定初始与最大内存256MiB，参数为 `-scheduler=none -no-debug -opt=2`。

在 `wasm/tinygo_engine_v2/` 执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
```

macOS／Linux使用 `bash scripts/build-wasm.sh`。产物是 `dist/tinygo_engine_v2.wasm`；前端分发位于 `web/src/engine/wasm/tinygo_engine_v2.wasm`，更新须核对正式构建身份与最终字节。

工具不在PATH时，脚本继续查仓库 `.tools/` 和上一级目录的 `tinygo0.40.1/tinygo/bin/`、`binaryen-version_129/bin/`。也可用PowerShell参数 `-TinyGo`、环境变量 `TINYGO` 或 `WASMOPT` 指定。Node加载与编译器同版本的 `wasm_exec.js`，可用 `TINYGO_WASM_EXEC` 指定。

在前端目录运行 `npm run check:wasm-build`，会把当前源码按正式参数重建到被忽略目录并与分发文件逐字节比较，不改分发文件或正式证明。

## 验证入口

在本模块按改动范围执行：

```powershell
go test -count=1 ./...
node scripts/check-package-boundaries.mjs
go run ./scripts/check-contract-layout
go run ./cmd/bench
node .\scripts\smoke-node.mjs
node .\scripts\bench-node.mjs --mode generic-run --iterations 10 --warmup 2
```

涉及协议或会话时先构建最终Wasm再做真实冒烟。生产适配与真实Wasm回归见[固定机制用例](../../web/tests/mechanisms/README.md)，正式证明刷新见[开发与独立评审流程](../../文档记录/项目说明/开发与独立评审流程说明.md)。原生单测、Node、浏览器和真实对象各自说明验证范围。

保留旧 `generic_p0_basic_damage.json` 基准字节，不修改或复制来迁就实现；当前基准由 `scripts/formula-phase4-input.mjs` 和独立显式公式样例构造。测试不固化已录入英雄配置或资料摘要。

## 性能与后续目标

当前单次性能专项保持暂停，后续方向见[网格优化](后续网格优化.md)。正式采样和分配工具为 `scripts/profile-run-node.mjs`、`scripts/allocation-run-node.mjs`，输入、工具链、输出模式和观测窗口须同口径；诊断Wasm及冻结输入缺失时不能报告零分配或复用旧结论。

CPU归因只统计真实调用栈中含 `runLoop` 的样本，按叶函数汇总；优化后无可用符号时明确无法归因。原生Go耗时只辅助定位，Node往返包含宿主及垃圾回收，不能冒充纯计算耗时。基础分页取舍核对实际复制页数及正式Wasm测量。

本页只维护当前操作入口。历史性能、逐轮机制范围与安装证据从[重构验收摘要](../../文档记录/测试记录/项目/共同公式与引擎重构验收摘要.md)、对应证据目录及Git历史追溯。
