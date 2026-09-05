# Web AGENTS.md

## 范围与入口

本文件适用于 `web/**`。先读同目录 `README.md`，再读目标路径更近的 `AGENTS.md`；技术入口、环境变量和命令以 README 与 `package.json` 为准，不在本文件重复。

默认只写 `web/**` 及本任务明确包含的前端文档或工具。`server/**`、`db/**`、`wasm/**` 和接口定义默认只读；跨模块契约变化返回主负责人统一处理。

## 当前边界

- 当前产品面是属性、角色、装备、技能分类、伤害类型、技能、状态、修正区域、图片和游戏配置管理页；导航真源为 `src/config/navigation.ts`，路由壳层为 `src/App.tsx`。
- API 基址统一经 `src/services/apiClient.ts` 解析，默认值和页面切换行为见 README。Admin Token 与基址可写入浏览器本地存储，不把机器绝对路径或真实密钥写入源码。
- 当前页面只使用现行业务与图片接口。已删除的 `/combat-data/**`、`versions/current`、旧发布、旧实体、Provider、Ability、Effect Sequence 和 Effect Step 页面不恢复兼容。
- Wasm 宿主使用 TinyGo V2 的 `engine_compile`、`engine_run`、`engine_release_session`。只改宿主桥接时不在前端隐式改变 ABI。

## 验证

| 改动 | 最低证据 |
| --- | --- |
| 文档 | 核对提到的文件、脚本和命令，检查差异 |
| 局部逻辑、类型或服务 | 受影响测试；功能收尾运行 `npm run lint`、`npm run typecheck`、`npm run test`、`npm run build` |
| 页面、交互或服务调用 | 上述检查，加受影响 Hash 路径的真实浏览器验证 |
| 公共路由、认证、API 基址或缓存 | 扩到所有受影响页面；里程碑收尾按 README 运行非 Wasm 桌面端到端检查 |
| Wasm 桥接或产物 | 核对前端产物与所需导出，并验证实际 compile/run/release 路径 |

已有证据只有在对应最终代码未受后续改动影响时复用。Node 单测和构建不等于浏览器或真实 Wasm 证明。
