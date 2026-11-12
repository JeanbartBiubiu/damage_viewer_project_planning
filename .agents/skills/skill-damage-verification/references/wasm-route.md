# 真实配置的 Wasm 运行入口

本文件只定位接线，不复制运行协议。开始前读 `web/AGENTS.md`、`web/README.md` 和涉及路径最近的规则；涉及引擎修改时再读对应模块规则和 `wasm-batch-mechanism-development`。

## 实际保存对象

1. 使用 `web/src/services/simulationSnapshotClient.ts` 的 `getSimulationSnapshot` 发起当前只读快照查询。核对本次角色、显式技能选择、技能挂载、全部依赖和配置摘要；认证方式沿[接口录入技能](../../damage-api-authoring/SKILL.md)的现行入口，不复用旧脚本中的 Bearer 认证。
2. 复用生产校验、公式预检、快照检查及 `prepareSimulation`（模拟准备）。`web/tests/fixtures/firstHeroWorker.ts` 示范从快照到编译、动作请求、运行、结果检查和释放；它含游戏、初始生命比例、背景普攻等专项假设，不能原样视为通用执行器。
3. 按技能真实入口选择主动、自动或条件触发请求。`web/tests/e2e/simulation-active-skills.spec.ts` 提供显式选技能、隔离无关来源的例子；间接技能和控制应保留实际消费它的后续动作。
4. 使用正式分发 Wasm，记录文件摘要及当前适配身份，运行后检查对应结果评估、错误、截断和完成情况，成功失败都释放本次会话。保存原始结构化结果，再按字段路径交给离线对照工具。

现有专项采集脚本不能宣称通用验证入口。若当前宿主不能运行所需角色、目标行动或控制，记录具体缺口；不要换成合成英雄而继续声称验证了真实保存配置。

## 通用机制与正式产物

- `web/tests/mechanisms/README.md` 维护机制格式、独立期望、运行命令及覆盖规则；`mechanismRunner.ts` 使用生产适配与真实 Wasm，但输入是合成机制数据。
- 新机制或接线修复按模块规则补必要机制回归；只保存业务数据不因此重建引擎或重跑所有模块测试。
- 源码或分发产物变化时，正式重建与字节比较由 `wasm/tinygo_engine_v2/README.md` 和[开发流程](../../../../文档记录/项目说明/开发与独立评审流程说明.md)维护。旧二进制、静态校验、Go 单测或身份刷新均不能代替本次真实对象验证。
