# Backend Resources AGENTS.md

本文件适用于 `server/data_manage/src/main/resources/**`，包括 `application.yml` 和 MyBatis XML mapper。

## 约束

- 改 XML 时同步读取对应 Java mapper interface、调用它的 service/store 及相关 DDL；statement id、参数和返回列必须一致。
- PostgreSQL 驼峰结果别名使用引号，例如 `AS "gameId"`；改变 `ORDER BY` 前确认管理页展示语义。
- 改 mapper location、缓存、Redis、JWT 或启动探测时同步检查 Java 配置与 properties。
- 不写入真实数据库、Redis 或 JWT 凭据，不恢复已删除的 combat-data 或 versions mapper。

## 验证

mapper 变化运行受影响测试并按模块规则执行 `mvn test`；`application.yml`、缓存、JWT 或 mapper location 变化再跑 `mvn package`。游戏或图片 SQL 变化需验证对应实库查询和接口，不能只凭 XML 静态检查。
