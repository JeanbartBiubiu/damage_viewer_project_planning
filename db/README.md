# Damage Viewer 数据库导览

当前结构由 [建表脚本](game_manage/schema.sql) 和 [约束与图片分区脚本](game_manage/triggers.sql) 定义；后端接口、迁移及检查命令见[后端说明](../server/data_manage/README.md)。本文只说明目录与阅读入口，不保存第二份字段定义。

## 目录职责

| 目录 | 用途 | 真源 |
| --- | --- | --- |
| `game_manage/` | 游戏配置、角色、装备、技能组成、状态、构筑与图片 | 当前建表及约束脚本 |
| `user_manage/` | 用户、权限及编辑记录相关结构 | [用户结构脚本](user_manage/schema.sql)及对应后端实现 |
| `task_doc_governance/` | 仓库任务与文档的本地查询 | [任务规则](task_doc_governance/task_rules.json)；SQLite仅为派生索引 |

当前 `game_manage/schema.sql` 定义30张业务逻辑表，含图片父表，不含实际图片子分区。普通管理表不按游戏分区；现行分区函数只维护图片。已部署数据库的结构仍须另行核对，建表脚本不证明实库状态。

## 先理解模型

- [系统精简设计](../文档记录/概要设计/项目/实录驱动的系统精简设计.md)：技能组成、构筑、结构化内容和模块责任。
- [共同公式规范](../contracts/formula/README.md)：作者公式结构及三端一致性样例。
- [后端说明](../server/data_manage/README.md)：组合保存、引用保护、关联管理与迁移入口；完整字段查建表脚本及对应源码。

作者配置经后端场景快照读取，由前端装配为计算请求，再交给Wasm编译和运行。数据库保存配置，计算过程和会话由引擎负责。管理数据保存成功不代表对应机制已通过战斗运行验收。

## 初始化与已有库升级

新库按顺序执行 `game_manage/schema.sql` 和 `game_manage/triggers.sql`，没有必跑业务种子；迁移目录不属于新库初始化。

已有库先核对实际结构，再按后端说明选择对应功能的迁移。`build_system_management.sql` 是符文专用三表到构筑系统的破坏式替换；`rune_management.sql` 仅是更早基线的历史迁移。不要批量重放迁移，也不要将 `CREATE TABLE IF NOT EXISTS` 当作结构升级器。

旧实体模型、版本发布、发布快照和旧分区说明已清理，需追溯时查看Git历史。当前规则与数据操作边界见[根协作规则](../AGENTS.md)及[后端规则](../server/data_manage/AGENTS.md)。
