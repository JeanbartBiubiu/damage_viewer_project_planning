# 公式执行路径性能基准（Go）

## 目的
在 MVP 阶段对比三种公式执行方式：
- Direct：固定函数（switch/opcode 的极限基线）
- AST：`go/parser` 解析后按 AST 递归求值
- DSL：自定义表达式编译为字节码（RPN）后栈机执行
- Template：用户提交参数（JSON/struct），编译成预定义模板程序执行
- Lowered：用户表达式先 parse AST，再降级成“预定义基础算子序列（register 逻辑）”执行

## 目录
- `eval/eval.go`：执行器实现（Direct/AST/DSL/Template）
- `eval/bench_test.go`：benchmark 用例

## 运行
```powershell
cd wasm/formula_bench_go
go test ./eval -bench . -benchmem
```

固定执行 10000 次（方便横向比较）：
```powershell
go test ./eval -bench . -benchmem -benchtime=10000x -count=1
```

只看线性伤害模板 demo：
```powershell
go test ./eval -bench "Linear" -benchmem -benchtime=10000x -count=1
```

## 线性模板 demo
公式：`base + ap*0.5 + bonus_ad*0.5`

用户定义（JSON）：
```json
{
  "base_var": "base",
  "terms": [
    {"var": "ap", "coef": 0.5},
    {"var": "bonus_ad", "coef": 0.5}
  ]
}
```

流程：
1. `CompileLinearFormulaJSON`：校验并把变量名转为 `slot`
2. 运行时 `Eval`：仅按 slot 取值并乘系数累加，不解析字符串

## Lowered（表达式 -> 预定义算子序列）demo
目标：支持“用户写表达式”，但运行时不走 AST 解释，不做字符串解析。  
流程：`CompileLowered(expr)` 把 AST 降级为定长算子序列（`LoadVar/LoadConst/Add/Mul/...`），运行时只执行算子。

## 建议解读
1. 重点看 `Direct` vs `DSL` vs `AST` 的 `ns/op`。
2. `*CompileAndEval` 用例用于看“每次现编译”的代价，生产不建议走这条。
3. 如果 DSL 与 AST 差距明显，MVP 推荐 `formula_kind + params + compiled DSL/opcode`。
