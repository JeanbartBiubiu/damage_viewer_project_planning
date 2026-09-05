# Backend Java AGENTS.md

本文件适用于 `server/data_manage/src/main/java/**`。默认只写 Java controller、service、mapper interface、config 与 support；SQL 和配置分别由资源目录及其近层规则约束。

## 约束

- controller 保持薄转发，业务与持久化语义沿当前 service、store、mapper 调用链确定，不从路由层猜测。
- 改 mapper interface 时同步核对对应 XML id、参数和返回列；改缓存、Redis、JWT 或启动探测时同步读取 `application.yml`。
- 图片接口位于 `controller/publicapi/ImagePublicController.java`、`controller/adminapi/image/**`，业务位于 `service/image/**`。图片写入只清理必要的图片缓存。
- 鉴权变化同时检查 filter、properties、错误模型和 README 配置；不得恢复旧 combat-data 控制器、发布服务或 `currentVersion` 缓存。

## 验证

先运行受影响测试，再按 `server/data_manage/AGENTS.md` 收尾。公共读取、图片或缓存链变化必须验证对应接口与缓存刷新；配置和依赖装配变化补跑打包。
