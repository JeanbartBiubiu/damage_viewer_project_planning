# Backend Java AGENTS.md

## 适用范围

本文件适用于 `server/data_manage/src/main/java/**`。

## 默认读写边界

1. 默认可写：Java controller、service、mapper interface、config、support。
2. 涉及 SQL 时必须同步读取 `server/data_manage/src/main/resources/mapper/**`。
3. 涉及配置、缓存、Redis、JWT 或启动探测时必须同步读取 `server/data_manage/src/main/resources/application.yml`。

## 关键入口

1. `xyz/game/datamanage/DataManageApplication.java`：Spring Boot 启动和缓存启用。
2. `controller/publicapi/**`：公共读取接口（游戏列表、图片）。
3. `controller/adminapi/**`：Admin 写入和查询（当前管理模块与图片）。
4. `service/GameDataService.java`：游戏列表、图片缓存与写入聚合入口。
5. `service/PostgresReadStore.java`、`service/PostgresWriteStore.java`：游戏读取、图片写入和编辑日志。
6. `mapper/**`：MyBatis Java mapper interface。
7. `config/**`、`support/auth/**`、`support/error/**`：运行配置、鉴权和错误模型。

## 最小验证

1. 开发中先跑受影响测试；controller、service、mapper、config 或 support 功能收尾时运行 `mvn test`，按模块规则复用对应最终代码的证据。
2. 改缓存、JWT、启动配置或依赖装配时补跑 `mvn package`。
3. 改公共读取或图片链时至少回归 `GET /api/games`、图片读写和缓存刷新行为。

## 常见陷阱

1. 图片写入只清 `images` 缓存，不要无意扩大缓存失效范围。
2. Admin JWT 本地可关闭；改鉴权时同时检查 filter、properties 和 README 配置说明。
3. 多数 controller 是薄转发，真实契约通常在 service/store/mapper 链路。
4. Java mapper 方法名必须和 XML mapper id 对齐。
5. 不要重新引入旧 combat-data 控制器、发布服务或 `currentVersion` 缓存。
