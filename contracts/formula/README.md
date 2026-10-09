# 共同公式契约

`formula.schema.json` 是共同公式结构及局部预算的唯一规范，`cases.json` 是三端一致性样例的唯一来源。字段语义、错误顺序与本批边界见[共同公式定义与校验详细设计](../../文档记录/详细设计/项目/共同公式定义与校验详细设计.md)。

生成器只操作明确指定工作树的模块产物，不同步共享治理文件。分别给出 `web`、`backend` 或 `wasm` 目标；示例中的工作树路径由调用者明确填写：

```powershell
node tools/formula-contract/generate.mjs --target web --root C:/project/damage_web_dev
node tools/formula-contract/generate.mjs --target web --root C:/project/damage_web_dev --check
```

修改规范或样例后重新生成三端，再分别运行共同样例和模块门禁。检查模式比较重新生成的实际内容，同时检查测试样例；只核对摘要字符串不足以确认一致。

共同校验现已接入伤害类型与技能公式的正式管理保存、快照及原生编译。各使用点独立建立真实游戏、对象、时点及口径的授权目录，不能把客户端提供的授权清单当作服务端权限证明；完成范围及后续默认分支清理见规划验收记录。
