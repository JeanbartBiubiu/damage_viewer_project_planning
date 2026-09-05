# TinyGo Compile AGENTS.md

本文件适用于 `internal/compile/**`。该层把 `CompileRequest` 校验并编译为 `CompiledSession`，不拥有可变运行时状态。

## 约束

- `generic.go` 负责编译与索引，`generic_validate.go` 采用 collect-all（收集全部）语义错误。
- 新 DTO 字段先在 `internal/model/generic*.go` 定义，再由编译层消费。
- abilityRef 和 providerRef 在编译期转换为运行时可查的标识或索引。
- 不引入 scheduler、outbox 或运行时状态，不恢复旧 Bundle 编译路径。

## 验证

局部修改先跑 `go test -count=1 ./internal/compile`；影响运行时消费形态时按模块规则跑全量 Go 测试，影响宿主协议时再验证最终 Wasm smoke。
