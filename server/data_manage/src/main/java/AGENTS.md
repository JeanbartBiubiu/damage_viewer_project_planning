# Backend Java AGENTS.md

## 适用范围

本文件适用于 `server/data_manage/src/main/java/**`。

## 默认读写边界

1. 默认可写：Java controller、service、mapper interface、config、support。
2. 涉及 SQL 时必须同步读取 `server/data_manage/src/main/resources/mapper/**`。
3. 涉及配置、缓存、Redis、JWT 或启动探测时必须同步读取 `server/data_manage/src/main/resources/application.yml`。

## 关键入口

1. `xyz/game/datamanage/DataManageApplication.java`：Spring Boot 启动和缓存启用。
2. `controller/publicapi/**`：公共读取接口。
3. `controller/adminapi/**`：Admin 写入、查询和发布接口。
4. `service/GameDataService.java`：缓存、校验、读写聚合入口。
5. `service/PostgresReadStore.java`、`service/PostgresWriteStore.java`：读取组装、写入和发布链路。
6. `mapper/**`：MyBatis Java mapper interface。
7. `config/**`、`support/auth/**`、`support/error/**`：运行配置、鉴权和错误模型。

## 最小验证

1. 改 controller、service、mapper、config 或 support 后至少运行 `mvn test`。
2. 改缓存、JWT、启动配置或依赖装配时补跑 `mvn package`。
3. 改公共读取或发布链时至少回归 current version、bundle、Admin 写入和缓存刷新行为。

## 常见陷阱

1. 非 publish 写入当前不清 `currentVersion` / `bundle` 缓存，不要无意扩大缓存失效范围。
2. Admin JWT 本地可关闭；改鉴权时同时检查 filter、properties 和 README 配置说明。
3. 多数 controller 是薄转发，真实契约通常在 service/store/mapper 链路。
4. Java mapper 方法名必须和 XML mapper id 对齐。
