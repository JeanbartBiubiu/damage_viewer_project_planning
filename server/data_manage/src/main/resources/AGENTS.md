# Backend Resources AGENTS.md

## 适用范围

本文件适用于 `server/data_manage/src/main/resources/**`，包括 `application.yml` 和 MyBatis XML mapper。

## 默认读写边界

1. 默认可写：`application.yml`、`mapper/**/*.xml`。
2. 改 XML 时必须同步读取对应 Java mapper interface、`PostgresReadStore` / `PostgresWriteStore` 和相关 DB DDL。
3. 改 mapper location、缓存、Redis、JWT 或启动探测配置时同步检查 Java config/properties。

## 关键入口

1. `application.yml`：数据库、Redis、cache、JWT、启动探测和 MyBatis mapper location。
2. `mapper/*/*Mapper.xml`：实际 SQL、结果列别名和 MyBatis statement id。

## 最小验证

1. 改 mapper XML 后至少运行 `mvn test`。
2. 改 `application.yml`、cache、Redis、JWT 或 mapper location 后补跑 `mvn package`。
3. 改游戏或图片 SQL 时回归 `GET /api/games` 与图片读写。

## 常见陷阱

1. 不要把真实 DB、Redis 或 JWT 凭据写回仓库。
2. `mybatis.mapper-locations` 依赖 `classpath*:mapper/**/*.xml`。
3. PostgreSQL JDBC 要求驼峰别名加引号，例如 `AS "gameId"`。
4. `ORDER BY` 会影响 Admin 展示顺序。
5. 不要把已删除的 combat-data / versions mapper 路径当成现行映射。
