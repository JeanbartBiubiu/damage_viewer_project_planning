---
name: wasm-batch-mechanism-development
description: "规划、实现或验证 Damage Viewer TinyGo V2 运行机制或直接宿主适配时使用；管理录入、任务记账和旧 DPS 路径不使用。"
---

# Wasm 机制开发

## 范围与入口

本技能用于 TinyGo V2 机制和直接相关的宿主集成。普通管理页保存数据结构，不因此启动运行时、旧发布或批次开发流程。行为保持的模块重构另见 `design-pattern-refactor`。

1. 确认工作树、分支和修改状态，读取根规则及目标模块 `AGENTS.md` / `README.md`。
2. TinyGo V2 继续读取 `wasm/tinygo_engine_v2/ARCHITECTURE.md`，按需查询 CodeGraph 并定点核对源码。
3. 当前唯一业务入口为 `engine_compile` / `engine_run` / `engine_release_session`，对应编译、会话运行和释放。机制落在 provider / ability / operation 及相应编译和运行层。
4. 旧单攻 DPS、step-loop 和对应导出已经删除，不恢复兼容实现，也不把旧文档路径当作当前代码入口。

## 责任与交接

- 后端拥有源数据和持久化契约；当前管理接口不提供旧战斗数据发布链路。
- Wasm 拥有编译、会话、执行、动作限制和确定性计算。
- Web 拥有输入映射、宿主桥接和用户界面；管理配置存在不等于运行时已经执行。
- 规划文档保存当前契约和范围，任务状态由 `task_rules.json` 唯一维护。

主负责人可直接实现关键部分。实际委派时，交接目标、有效契约、允许写入范围、参考实现、验收和升级条件；不固定执行工具。只在选择 Cursor 时读取 `cursor-local-agent`。重要运行时协议和业务语义按根规则做独立评审。

按一个可独立验收的机制组织任务，不强制沿用旧批次编号或旧里程碑任务键。文档按复杂度拆分，定义只有一个来源；当前方案与历史执行记录分开。

## 验证

开发中先验证受影响部分；功能收尾按模块 `AGENTS.md` 完成下列必要检查。已有证据有效且代码未受后续改动影响时不重复执行。

| 改动 | 收尾验证（在相应模块目录执行） |
| --- | --- |
| TinyGo V2 Go 逻辑 | `go test -count=1 ./...` |
| 编译、运行、调度、公式、数值管道 | 加 `go run ./cmd/bench` |
| Wasm 导出、协议、会话生命周期 | 构建最终 Wasm 后执行 `node .\scripts\smoke-node.mjs` |
| TinyGo 构建、target | `powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1` |
| Node 性能脚本 | `node .\scripts\bench-node.mjs --mode generic-run --iterations 10 --warmup 2` |
| Web 适配或页面 | 按 `web/AGENTS.md` 的检查及受影响路径浏览器验证 |
| 任务状态或文档映射 | 更新相关条目后 `node tools/task-governance/cli.mjs check`；需要查询索引时才显式 `rebuild` |
| 纯文档 | 检查路径、命令存在性和 `git diff --check` |

报告实际命令、退出结果、代码状态及关键断言。真实 Wasm 验证记录最终产物路径和摘要；浏览器验证记录路径与操作。Node 单测不代替浏览器或真实 Wasm 证明，静态文档不证明数据库或运行时支持。

复用当前 `internal/testkit/fixtures/generic_p0_basic_damage.json`，不要修改或复制它来迁就实现。工具缺失与产品错误分开说明，不虚报通过。
