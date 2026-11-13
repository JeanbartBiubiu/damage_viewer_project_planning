# Wasm 运行接线

只在本次比较需要运行 Wasm 时读取。已有同一组输入的 Wasm 结果时，直接交给对照工具，不补做数据库回读或资料检查。

## 按输入选择入口

- 已提供系统场景快照：直接使用 `validateSimulationSnapshot`、`preflightSkillFormulas`、`inspectSimulationSnapshot`、`prepareSimulation` 校验和装配输入，再编译、运行和释放。
- 需要读取已保存配置：用 `web/src/services/simulationSnapshotClient.ts` 的 `getSimulationSnapshot` 获取本次场景；明确选择需要的技能和输入，不默认开启全部角色来源。
- 已提供引擎请求：经当前宿主入口直接编译和运行，无需重新装配管理数据。

浏览器接线参考 `web/tests/fixtures/firstHeroWorker.ts`，真实维护的 Node 接线复用 `tools/maintenance/engine-client.ts`。它只读取正式后端签发的维护计算票据，并校验最终分发产物；固定机制测试的签发材料不用于真实对象验证。本次场景采用调用方给定的结构和条件。

按主动、自动或条件触发选择对应请求；间接效果要带实际消费它的后续动作。运行后保存结构化结果，检查本次所需明细是否完整，并释放本次会话。无法运行时返回具体错误或缺项，不在本技能内启动引擎开发、重建正式证明或整角色验收。

原始结果字段按当前 `web/src/types/genericEngine.ts` 读取。吸血等变化可能记在逐伤生命字段和对应事实中，不一定形成独立治疗记录；只按实际输出契约选取对照字段，不从最终总额反造逐笔记录。

## 显式场景运行脚本

已有场景快照文件时，可复用 `scripts/run-wasm-scenarios.ts`，避免逐次编写运行接线。在 `web/` 目录执行：

```powershell
node node_modules/vite-node/vite-node.mjs ../.agents/skills/skill-damage-verification/scripts/run-wasm-scenarios.ts --plan <场景计划.json> --output <新的证据目录> --grant-file <后端维护计算票据文件>
```

票据按 `tools/maintenance/README.md` 经正式维护会话取得，私密文件不进入场景计划、证据或输出。每次编译和运行重新读取，过期、错误类别或主体变化立即失败；不能回退到测试票据或关闭验签。计划顶层只有 `cases`。每个场景必须提供：

- `id`：唯一小写字母、数字、下划线或连字符标识，用作输出文件名。
- `snapshotFile`：场景快照文件，路径相对计划文件。
- `attributeInputs: {source: {}, target: {}}`：明确补充属性，缺少必要值直接失败，不填默认0或覆盖固有属性。
- `initialHealth: {source: 数值, target: 数值}`：双方当前生命，不默认满血或半血。
- `durationMs`：明确观察时长；`mode` 为 `fixed`（固定技能指令）或 `continuous`（连续普攻）。
- `fixed` 模式提供非空 `actions`，形状使用 `web/src/engine/skillActionRequest.ts` 的 `SkillActionInput`；`continuous` 不接受非空技能指令。

可选 `equipmentAssumptions`、`mechanicStateInputs`、`sceneParameterInputs`、`initialResourceInputs`、`ignoredCastCosts`，形状沿当前生产类型，省略时为空数组。普通施法费用只在场景明确填写 `ignoredCastCosts` 后忽略，引用可由 `simulationCastCostCandidates` 取得；费用被忽略的场景不验证相应资源资格或扣付。脚本关闭时间序列采样，场景攻速准入上界为10；不改变角色的实际攻击速度。

每场经生产校验、预检、装配后，以正式分发 Wasm 编译、运行两次并比较完整结果，最后释放会话。输出 `<id>.json` 的 `prepared / runRequest / done / assessment / release` 等原始内容，以及供离线对照使用的 `results.json` 和执行汇总 `summary.json`。脚本不读取资料、不生成数值期望、不写接口或数据库。

输出目录必须不存在，父目录须先存在。首场非预期错误、结果截断、重复不一致或释放失败立即停止，保留已有证据并以退出码1结束；全部完成为0。`summary.complete` 只表示这些场景运行完整，不表示数值已与预期一致。
