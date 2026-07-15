# Damage Viewer 项目设计说明书

> 本说明书的目标是**讲清每个端要做什么功能、并指引该怎么开发**：即使没有现成代码参考，开发者（或 AI）也能据此理解系统、还原各端实现。
>
> - 编写/对齐时间：2026-07-15
> - 依据基线：master 当前通用 1v1 **combat-data** + 通用 Wasm ABI
> - 内容层次：每章「功能说明 → 机制与契约 → 开发指引」；以**当前已落地能力**为准。
>
> **真源层级**：
> 1. **本说明书是当前架构总览与导航**（帮助理解系统组成、数据流与各端职责；不是与实现文档竞争的「总契约」）。
> 2. **对应真源**：`文档记录/**` 下的详细实现文档、各模块代码/API 定义，以及可执行 DDL（`db/game_manage/*.sql`；分区父表清单以 `triggers.sql` 为准）。
> 3. 后端 `文档记录/详细设计/server/**/接口定义.md` 等为接口细节附录；与本说明书冲突时以代码与详细设计为准并对齐导航表述。
> 4. 详细映射见 [08 · 适配层](./08-适配层编译规范.md) 与 [接口与页面索引](../文档记录/详细设计/接口与页面索引.md)。
> 5. 任务/文档映射与状态真源仍是 `db/task_doc_governance/task_rules.json`；本说明书不取代任务治理。

---

## 一句话定位

Damage Viewer 是一个面向游戏玩家与攻略者的**纯 Web 数值分析平台**：通过 Web 后台维护通用 1v1 **combat-data**（实体/Provider/能力/效果等），按 `changeRevision` 版本化发布（冻结 `publishRevision`，并增量拷贝 `change_revision ∈ (previousPublishedRevision, publishRevision]` 的行到对应 `*_log`），由浏览器端 **TinyGo（Go→Wasm）** 用通用 ABI（`engine_compile` / `engine_run` / `engine_release_session`）完成本地战斗模拟。

核心特征：**读多写少、重客户端计算、revision 安全读取、多游戏可扩展、编辑/只读权限分离**。

---

## 系统组成（四端 + 协作治理）

| 模块 | 技术栈 | 职责 | 详见 |
|------|--------|------|------|
| **前端 Web** | React 18 + Vite 5 + TypeScript + Arco Design | combat-data 分表编辑、版本发布、通用 Wasm 验证、IndexedDB graph 缓存 | [02-前端设计](./02-前端设计.md) |
| **后端 Server** | Java 21 + Spring Boot 3.5 + MyBatis | 多游戏 combat-data 读写、revision、`versions:publish`、公共只读 API | [03-后端设计](./03-后端设计.md) |
| **数据库 DB** | PostgreSQL（`public` + `"user"` schema） | 最新主表 + `_log` 发布快照，按 `game_id` LIST 分区 | [04-数据库设计](./04-数据库设计.md) |
| **计算引擎 Wasm** | TinyGo → wasm32 | 通用 CompileRequest 编译与确定性运行 | [05-Wasm计算引擎设计](./05-Wasm计算引擎设计.md) |
| **开发协同治理** | AGENTS.md + 任务治理 | worktree 路由、文档分层、任务-文档映射 | [06-开发模式与协同流程](./06-开发模式与协同流程.md) |

整体视图见 [01-系统总览](./01-系统总览.md)；端到端走查见 [07-端到端开发示例](./07-端到端开发示例.md)。

---

## 端到端数据流（一句话版）

```
管理员在 Web 编辑 combat-data → Admin PUT 写入最新主表并递增 change_revision
  → publish：冻结 publishRevision 到 game_versions，增量拷贝 change_revision ∈ (previousPublishedRevision, publishRevision] 的行到 *_log
  → 读端：GET current + combat-data/**（combatDataLoader / IndexedDB）
  → combatDataAssembler → CompileRequest
  → genericEngineClient：engine_compile → engine_run → engine_release_session
```

详见 [01-系统总览 · 数据流](./01-系统总览.md#5-端到端数据流)。

---

## 阅读指引

- 想了解**项目是什么、各端如何协作** → [01-系统总览](./01-系统总览.md)
- 想了解**某一端怎么实现的** → 对应模块章节（02~05）
- 想了解**新功能如何交给 AI 开发** → [06-开发模式与协同流程](./06-开发模式与协同流程.md)
- 想看**端到端开发走查** → [07-端到端开发示例](./07-端到端开发示例.md)
- 想了解**combat-data → CompileRequest** → [08-适配层编译规范](./08-适配层编译规范.md)
- 想追溯**原始分层设计** → `文档记录/{需求澄清,概要设计,详细设计,测试记录}/**`

---

## 落地成熟度速览

| 能力 | 成熟度 |
|------|--------|
| 后端 combat-data + `versions:publish`（revision / `_log`） | ✅ 已落地 |
| 前端 combat-data 分表页 + 通用 Wasm 验证 | ✅ 已落地 |
| combat-data graph IndexedDB 缓存 | ✅ 已落地 |
| 通用 ABI compile / run / release | ✅ 已落地 |
| 产品级场景工作台、Worker 宿主 | ⬜ 规划中 |

> 历史路径（全量 Bundle / Wasm Catalog 快照、旧 `engine_init`/`begin_run`/`step` 宿主主链）已从当前架构移除，不再作为现行实现描述。
