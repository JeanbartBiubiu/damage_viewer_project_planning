# Web AGENTS.md

## 范围与入口

本文件适用于 `web/**`。先读同目录 `README.md`，再读目标路径更近的 `AGENTS.md`；技术入口、环境变量和命令以 README 与 `package.json` 为准，不在本文件重复。

默认只写 `web/**` 及本任务明确包含的前端文档或工具。`server/**`、`db/**`、`wasm/**` 和接口定义默认只读；跨模块契约变化返回主负责人统一处理。

## 当前边界

- 当前产品面是属性、角色、装备、构筑系统、技能分类、伤害类型、技能、状态、修正区域、图片和游戏配置管理页；导航真源为 `src/config/navigation.ts`，路由壳层为 `src/App.tsx`。
- API 基址统一经 `src/services/apiClient.ts` 解析，默认同源，开发代理见 README。账号使用浏览器安全凭据（Cookie），正式会话与受限流程分别校验防跨站请求伪造值（CSRF）；不在浏览器本地存储密码、绑定二维码、恢复码或凭据。
- 当前页面只使用现行业务与图片接口。已删除的 `/combat-data/**`、`versions/current`、旧发布、旧实体、Provider、Ability、Effect Sequence 和 Effect Step 页面不恢复兼容。
- Wasm 宿主使用 TinyGo V2 的 `engine_compile`、`engine_run`、`engine_release_session`。只改宿主桥接时不在前端隐式改变 ABI。

## 编码与测试指南

修改实现前阅读[前端编码指南](../文档记录/项目说明/开发指南/前端编码指南.md)，按其中的类型、草稿、异步和组件责任检查实际调用链。编写或选择用例前阅读[测试编写与运行指南](../文档记录/项目说明/开发指南/测试编写与运行指南.md)的前端、浏览器及发现规则部分；构建命令继续查同目录 README。

## 验证

| 改动 | 最低证据 |
| --- | --- |
| 文档 | 核对提到的文件、脚本和命令，检查差异 |
| 局部逻辑、类型或服务 | 受影响测试；功能收尾运行 `npm run lint`、`npm run typecheck`、`npm run test`、`npm run build` |
| 页面、交互或服务调用 | 上述检查，加受影响 Hash 路径的真实浏览器验证 |
| 公共路由、认证、API 基址或缓存 | 扩到所有受影响页面；里程碑收尾按 README 运行非 Wasm 桌面端到端检查 |
| Wasm 桥接或产物 | 核对前端产物与所需导出，并验证实际 compile/run/release 路径 |

已有证据只有在对应最终代码未受后续改动影响时复用。Node 单测和构建不等于浏览器或真实 Wasm 证明。
