# 稳定基础层

本目录归集同一 Go 模块中的五个独立包，本层没有公共大包或单独的发布模块。默认写入边界见 [AGENTS.md](AGENTS.md)；战斗用途、事件读值权限及状态管理留在外层组合。

| 包 | 能力 | 允许的项目内直接依赖 |
| --- | --- | --- |
| `abi` | 二进制帧、内存桥接、输出缓冲区及错误运输 | `model` 的既有协议结构 |
| `attribute` | 属性槽、存在性、不可变分页、编辑器与快照隔离 | `model` 的属性槽结构 |
| `expression` | 纯公式校验、程序编译、数学原语与数值求值 | 无，仅标准库 |
| `inputbinding` | 将声明输入绑定到明确的只读数值 | `base/expression` |
| `typeset` | 类型编号、目录、位集合和匹配 | `model` 的类型协议结构 |

`formula` 继续在本目录外组合纯公式并绑定技能、事件、过程和供值器上下文。`pipeline`、`scheduler`、`status`、`shield` 和 `resource` 同样属于业务侧，不反向进入基础层。

在引擎模块目录执行：

```powershell
go test -count=1 ./internal/base/...
node scripts/check-package-boundaries.mjs
node --test scripts/check-package-boundaries.test.mjs
```

在仓库根目录检查公式生成物：

```powershell
node tools/formula-contract/generate.mjs --target wasm --root "$PWD" --check
```

生成器只写 `internal/base/expression/` 下的当前生成物。涉及基础算法、共享模型或协议时继续按[模块规则](../../AGENTS.md)执行全量 Go 测试及相应正式构建和宿主验证；包迁移不改变任何数学、槽位、帧或错误语义。
