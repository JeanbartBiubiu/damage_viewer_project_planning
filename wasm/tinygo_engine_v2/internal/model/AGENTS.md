# TinyGo Model AGENTS.md

本文件适用于 `internal/model/**`，只定义通用 DTO、枚举、错误码、frame kind 和载荷契约，不放编译、运行时或宿主逻辑。

## 约束

- 当前契约集中在 `generic.go`、`generic_compile.go`、`generic_run.go`、`generic_run_output.go`；`types.go` 只保留仍被引用的共享基础类型。
- 公共字段要明确 JSON tag、默认值、错误行为及编译和运行消费方，不改名复用来表达另一种语义。
- release 成功使用 `FrameKindGenericReleaseResult`，不复用 generic done。
- 已删除的 legacy Bundle 和 DPS DTO 不恢复。

## 验证

字段、枚举或错误码变化运行 `go test -count=1 ./...`；影响 ABI 或 outbox 载荷时，构建最终 Wasm 后再运行 Node smoke。
