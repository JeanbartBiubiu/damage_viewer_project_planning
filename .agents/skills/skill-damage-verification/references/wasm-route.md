# Wasm 运行接线

只在本次比较需要运行 Wasm 时读取。已有同一组输入的 Wasm 结果时，直接交给对照工具，不补做数据库回读或资料检查。

## 按输入选择入口

- 已提供系统场景快照：直接使用 `validateSimulationSnapshot`、`preflightSkillFormulas`、`inspectSimulationSnapshot`、`prepareSimulation` 校验和装配输入，再编译、运行和释放。
- 需要读取已保存配置：用 `web/src/services/simulationSnapshotClient.ts` 的 `getSimulationSnapshot` 获取本次场景；明确选择需要的技能和输入，不默认开启全部角色来源。
- 已提供引擎请求：经当前宿主入口直接编译和运行，无需重新装配管理数据。

浏览器接线参考 `web/tests/fixtures/firstHeroWorker.ts`，Node 接线参考 `web/tests/mechanisms/mechanismRunner.ts` 的 `mechanismEngine()`。只复用接线，不沿用示例中的合成数据、半血初值或背景普攻；本次场景仍采用调用方给定的结构和条件。

按主动、自动或条件触发选择对应请求；间接效果要带实际消费它的后续动作。运行后保存结构化结果，检查本次所需明细是否完整，并释放本次会话。无法运行时返回具体错误或缺项，不在本技能内启动引擎开发、重建正式证明或整角色验收。

原始结果字段按当前 `web/src/types/genericEngine.ts` 读取。吸血等变化可能记在逐伤生命字段和对应事实中，不一定形成独立治疗记录；只按实际输出契约选取对照字段，不从最终总额反造逐笔记录。
