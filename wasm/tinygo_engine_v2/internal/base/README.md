# 稳定基础层

本目录归集同一 Go 模块中的六个独立包，本层没有公共大包或单独的发布模块。默认写入边界见 [AGENTS.md](AGENTS.md)；战斗用途、事件读值权限及状态管理留在外层组合。

| 包 | 能力 | 允许的项目内直接依赖 |
| --- | --- | --- |
| `abi` | 二进制帧、内存桥接、输出缓冲区及错误运输 | `model` 的既有协议结构 |
| `attribute` | 属性槽、存在性、不可变分页、编辑器与快照隔离 | `model` 的属性槽结构 |
| `expression` | 纯公式校验、程序编译、数学原语与数值求值 | 无，仅标准库 |
| `inputbinding` | 将声明输入绑定到明确的只读数值 | `base/expression` |
| `numeric` | 通用上下界、概率夹取及证据、按短编号聚合增幅和有限性检查 | `model` 的既有数值边界证据结构 |
| `typeset` | 类型编号、目录、位集合和匹配 | `model` 的类型协议结构 |

`numeric` 只接收明确数值和组编号，不读取角色、技能、事件、供值器或期限。夹取的既有边界存在性与证据语义保持；分组只允许有限且不小于1的倍率，0号组合法，同组按参与顺序加算，组间按首次出现顺序连乘。成员资格、精确到期、次数消费及失败来源仍由业务调用方处理，无分组时不创建聚合容器。

`formula` 继续在本目录外组合纯公式并绑定技能、事件、过程和供值器上下文。`pipeline`、`scheduler`、`shield` 和 `resource` 同样属于业务侧，不反向进入基础层。无消费者的旧 `control`、`mark`、`status` 包已删除，正式控制、标记及状态实现仍在运行子系统中。

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
