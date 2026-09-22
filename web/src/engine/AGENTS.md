# Web Engine AGENTS.md

本文件适用于 `web/src/engine/**`。默认只写该目录；`wasm/**` 默认只读，只有任务明确包含 ABI 或产物更新时才进入对应模块流程。

## 约束

- `tinygoV2Bridge.ts` 负责加载、frame 编解码和导出校验；`genericEngineClient.ts` 负责 compile/run/release 客户端。不要新建第二套 Wasm loader。
- 改请求或结果形状时同步读取 `web/src/types/genericEngine.ts` 及 TinyGo 当前 DTO；不要为已删除的旧表结构修改通用 ABI。
- `hitAdapter.ts` 负责有界命中计划；持续结果编译由 `persistentResultAdapter.ts` 的共用函数提供给命中入口和第7独立入口。不要加入跳过命中判定的布尔开关。
- 前端产物为 `wasm/tinygo_engine_v2.wasm`。所需业务导出是 `engine_compile`、`engine_run`、`engine_release_session`。
- 旧 Catalog、Bundle 和 combat-data assembler 已删除，不恢复依赖。

## 验证

先运行受影响适配测试；功能收尾按 `web/AGENTS.md` 完成前端检查。桥接、导出或产物变化必须再验证真实 compile/run/release 路径。
