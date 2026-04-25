TASK_KEY: wasm-engine-v2-architecture
DOC_TYPE: 任务单
WORKSTREAM: wasm
STATUS: historical
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-04-26

# Java Demo Worker 历史任务记录

本文只保留 2026-04-11 通用战斗引擎 V2 Java 验证任务的执行背景，不再作为新的实现入口。

## 当前结论

1. Java 验证项目的机制结论已经合并进主设计文档：
   - `文档记录/概要设计/wasm/WASM概要设计.md`
   - `文档记录/详细设计/wasm/WASM详细设计.md`
   - `文档记录/需求澄清/wasm/WASM机制覆盖需求.md`
2. 旧 demo 源码目录已在 2026-04-26 删除，后续不再以 Java demo 作为 review 或开发基线。
3. TinyGo V2 的正式开发落点是 `wasm/tinygo_engine_v2`。

## 历史价值

该任务曾用于验证以下 V2 子系统拆分是否可行：

- session、bundle compile、runtime、event loop
- action gate、action execution、command 回流
- damage pipeline、resource、cadence
- control、history、counter、mark、crit

后续如果需要追溯设计来源，优先阅读当前三份 Wasm 主文档；本文件只说明这条验证路径已经收口。
