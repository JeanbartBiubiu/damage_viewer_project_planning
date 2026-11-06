TASK_KEY: planning-engine-subsystem-refactor
DOC_TYPE: 概要设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: Codex 主负责人及内置独立只读评审代理
LAST_TRACKED_AT: 2026-11-07

# Wasm子系统接口设计草案入口

候选接口正文已收敛至[详细设计草案](../../详细设计/项目/Wasm子系统接口设计草案.md)，本页只保留阅读入口。有限排程、下一步决策及其候选类型只在详细稿定义，尚未实现、未冻结。

| 想了解什么 | 阅读位置 |
| --- | --- |
| 当前职责、状态所有权及仍待处理的方向 | [职责与协作现状](Wasm子系统职责与协作现状及调整方向.md) |
| 当前执行包、真实帧及跨功能次序 | [功能执行与组合设计](../../详细设计/项目/执行协调层功能执行与组合重构技术方案.md) |
| 候选接口的输入、结果、失败、副作用及验收 | [详细设计草案](../../详细设计/项目/Wasm子系统接口设计草案.md) |
| 两个视角查看职责与改动 | [子系统协作图](Wasm子系统协作图.html) |
| 当前真实协议、能力及验证命令 | [引擎说明](../../../wasm/tinygo_engine_v2/README.md)及其源码入口 |

沿用任务 `planning-engine-subsystem-refactor`，总体状态继续由[任务规则](../../../db/task_doc_governance/task_rules.json)维护。本次只更新文档与图，不以候选方案或历史验证结果声明新增运行能力。
