# 执行协调与功能入口

本目录组合一次运行，使用根入口创建的唯一循环。添加功能时先按下表确定所有者，运行算法和局部状态进入对应子包，跨所有者的执行顺序与提交由本包协调。

| 要修改的功能 | 入口 | 负责的边界 |
| --- | --- | --- |
| 运行前的来源、初始快照和机制准入 | `admission/` | 明确输入的校验，不执行战斗 |
| 命中事实、首接触、分组与阻挡范围 | `hit/` | 局部命中账和判断，不执行候选操作 |
| 动态监听、事件匹配和施放节流 | `listener/` | 列表及条件的选择依据，不执行子帧 |
| 属性派生、缓存和作者防御求值 | `evaluation/` | 准备完成的视图到计算结果，不发布状态 |
| 普攻、过程、命中与监听实际执行 | 根目录的对应协调文件 | 取得真实身份、选择读值时点、执行操作与派发 |
| 同次使用额度 | `use_trigger.go` | 命中规则与监听共享的预留、提交和失败释放 |
| 帧暂存、预检及发布 | `frame*.go` | 跨数值、行动、效果、队列与事实的现有提交边界 |

根目录的协调入口按功能阅读：

| 功能 | 文件入口 |
| --- | --- |
| 单场装配与循环适配 | `engine.go`、`loop_driver.go` |
| 驱动尝试与角色解析 | `driver_attempt.go`、`driver_actor.go` |
| 取值准备与事件快照 | `frame_context.go`、`event_snapshot.go` |
| 操作路由与状态操作 | `frame_operations.go`、`state_operations.go` |
| 命中、监听及事件派发 | `skill_hit.go`、`skill_hit_groups.go`、`listener_dispatch.go`、`event_dispatch.go` |
| 预检、发布及生命周期 | `frame_commit*.go`、`frame_lifecycle.go`、`shield_lifecycle.go` |
| 延迟复制和续接 | `replay.go` |
| 角色初始化与结果投影 | `combatant_initialization.go`、`report_projection.go` |
| 普攻、过程与技能计划 | `basic_attack*.go`、`process*.go`、`skill_actions.go`、`automatic_skills.go` |

角色数值、行动和效果的私有状态继续由相邻的 `actor/`、`action/`、`effect/` 持有，恢复及快照转换也由效果包负责。报告包消费已提交事实和已拥有的快照，数值管道只计算，不决定事件顺序。

四个执行子包彼此不导入，也不导入执行根包或调度器。父层传递明确值、有限只读视图和准备好的公式输入，不传完整 `Engine` 或 `Frame`，不以大接口替代状态所有权。

当前暂存、帧入口、事件入口和事件冻结值各有读取时点，复制伤害另用原冻结防御视图。命中候选完成后的事件当前值刷新仍由父层在原位置执行；监听先冻结条件，再逐项复查实际挂载资格。提交失败沿原有已发布事实处理，不隐含整条派生链回滚。

实现与私有不变量测试同包；跨所有者的组合回归位于模块 `tests/runtime/`。正式构建、真实Wasm机制、浏览器及性能验证入口见[引擎说明](../../../README.md)。
