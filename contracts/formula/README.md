# 共同公式契约

`formula.schema.json` 是共同公式结构及局部预算的唯一规范，`cases.json` 是三端一致性样例的唯一来源。字段和错误行为查该规范与三端校验器，不再另存已实现的施工设计。

生成器只操作明确指定检出的模块产物，不同步共享治理文件。分别给出 `web`、`backend` 或 `wasm` 目标；以下从仓库根目录运行，其他检出须显式指定其根目录：

```powershell
node tools/formula-contract/generate.mjs --target web --root (Get-Location).Path
node tools/formula-contract/generate.mjs --target web --root (Get-Location).Path --check
```

修改规范或样例后重新生成三端，再分别运行共同样例和模块门禁。检查模式比较重新生成的实际内容，同时检查测试样例；只核对摘要字符串不足以确认一致。

共同校验现已接入伤害类型与技能公式的正式管理保存、快照及原生编译。各使用点独立建立真实游戏、对象、时点及口径的授权目录，不能把客户端提供的授权清单当作服务端权限证明。理解公式与结算的关系可从[规则怎样改变数值](../../文档记录/项目说明/项目知识手册/04-规则怎样改变数值.md)进入；历史实现和验证过程从Git追溯。
