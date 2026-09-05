# TinyGo Engine V2 AGENTS.md

## 范围与入口

本文件适用于 `wasm/tinygo_engine_v2/**`。先读同目录 `README.md`、`ARCHITECTURE.md`，再读目标路径更近的 `AGENTS.md`；完整入口、协议和命令由这些模块文档维护。

默认只写本模块及任务明确包含的 Wasm 设计、测试记录和任务映射。`web/src/engine/**` 默认只读；只有任务包含宿主适配或产物更新时才进入前端规则。

## 当前架构边界

- 正式业务路径是 `CompileRequest -> engine_compile -> CompiledSession`，再由 `engine_run` 执行，最后 `engine_release_session` 释放。正式宿主是浏览器 Worker；Node 脚本只用于本地和持续集成验证。
- 新机制进入 provider（供值器）、ability（能力）、operation（操作）及其编译、门禁和执行层。旧 Rust、单攻 DPS、step-loop（分步循环）及对应导出已删除，不恢复兼容。
- 当前目标是 1 对 1、单线程、确定性计算。热路径禁止 goroutine、channel、lock、反射和以 panic/recover 控制流程；优先使用编译后短标识、索引、定长结构和位集合。
- 数值变化经过 operation 与 pipeline（数值管道）；监听器产出操作，不直接写运行时状态。已进入评审门槛的公共 DTO 不随手改变字段语义。
- Wasm 初始和最大内存当前固定为 `256 MiB`，低配置设备不是当前目标。改变该基线或 TinyGo 主线必须提供同口径包体、性能和宿主延迟证据。
- `internal/testkit/fixtures/generic_p0_basic_damage.json` 是通用基准样例，只复用，不修改或复制来迁就实现。

## 验证

| 改动 | 最低证据 |
| --- | --- |
| 文档 | 核对路径、命令和当前源码，检查差异 |
| Go 逻辑 | 受影响测试；功能收尾运行 `go test -count=1 ./...` |
| 运行时、调度、公式、资源或数值管道 | 上述测试，加 `go run ./cmd/bench` |
| ABI、frame、outbox 或会话生命周期 | 构建最终 Wasm 后运行 `node .\scripts\smoke-node.mjs` |
| 构建脚本、target 或导出 | 运行 `powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1` |
| Node 验证或性能脚本 | 运行对应语法、单测、smoke 或 `generic-run` benchmark |
| 前端宿主 | 按 `web/AGENTS.md` 检查并验证受影响浏览器路径 |

Node 单测、原生 Go 测试和静态文档分别只证明对应层面，不替代最终 Wasm、浏览器或真实运行时证据。
