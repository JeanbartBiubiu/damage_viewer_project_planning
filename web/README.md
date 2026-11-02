# Damage Viewer Web

前端提供“数据管理／计算模拟”两种模式。管理页维护作者配置；模拟页读取一致性场景快照，装配请求，在浏览器后台工作线程中调用Wasm并展示结果。当前路由由[导航定义](src/config/navigation.ts)维护，工作边界见[模块规则](AGENTS.md)。

## 页面与源码入口

| 范围 | 入口 |
| --- | --- |
| 应用、模式、路由与草稿离开保护 | `src/App.tsx`、`src/config/navigation.ts` |
| 11类管理页面 | `src/pages/admin/`；属性、角色、装备、构筑、技能分类、伤害类型、乘区、技能、状态、游戏配置及图片 |
| 技能统一编辑 | `src/pages/admin/skills/SkillConfigurationWorkspace.tsx`；完整基线、六模块草稿及共同保存 |
| 普攻模拟 | `#/simulation/basic-attack`；单次／连续普攻及固定时刻技能计划 |
| 混合战斗分析 | `#/simulation/combat-analysis`；自动连招、背景普攻、曲线及使用／结算联动 |
| 请求与错误 | `src/services/apiClient.ts`，各业务服务位于 `src/services/` |
| 场景与生产适配 | `src/engine/simulationAdapter.ts`、`simulationActiveSkills.ts`、`processAdapter.ts` |
| 模拟来源准备 | `src/engine/simulation/sources/`；装备与自然来源分别拥有选择、身份、执行闭包和所属常驻贡献 |
| 通用配置校验与编译 | `src/engine/simulation/compile/`；完整配置校验、共同防御公式及触发程序编译；共享类型在 `simulation/model.ts` |
| Wasm协议与分发 | `src/engine/` 内客户端／工作线程及 `src/engine/wasm/tinygo_engine_v2.wasm` |
| 固定机制回归 | [用例说明](tests/mechanisms/README.md) |

管理保存、配置诊断和真实计算分别提供证据。混合战斗完整对象候选由后端可用目录核对范围、当前内容及引擎／适配器身份；历史证明条目不等于现场可选数量。对象范围、排除与录入边界见[项目说明](../文档记录/项目说明/计算范围与录入边界.md)。

技能、装备和构筑来源保留完整身份，场景输入不按名称猜值。图表和有限明细用于展示，可靠累计与运行完整性从正式输出读取，不能用被截断记录反算全场结果。

## 连接与本地开发

依赖和工具版本以 `package.json`、锁文件及已验证工具链为准。API基址依次取页面保存的地址、`VITE_API_BASE_URL`、`http://localhost:8080`；使用完整来源地址，不带 `/api`。连接地址和管理令牌会保存在浏览器本地存储，切换时旧请求与场景须失效。

在 `web/` 目录执行：

```powershell
npm ci
npm run dev
```

生产构建用 `npm run build`，预览用 `npm run preview`。空Hash和未知路径进入 `#/attributes`。接口失败先核对后端是否运行、浏览器保存的地址和鉴权配置。

## 验证与正式产物

开发中先运行受影响检查，功能收尾按模块规则执行：

```powershell
npm run lint
npm run typecheck
npm run test
npm run build
```

| 命令 | 用途与边界 |
| --- | --- |
| `npm run test:mechanisms` | 合成场景经生产适配及真实Wasm，与独立手算期望比较 |
| `npm run test:e2e:non-wasm` | 隔离的非Wasm桌面管理页验收，使用真实浏览器；显式真接口用例仍遵循各配置开关 |
| `npm run check:mechanism-coverage` | 只读核对正式对象声明所依赖的机制用例，不生成新证明 |
| `npm run check:wasm-build` | 按固定工具链及正式参数重建当前源码，与前端分发Wasm逐字节比较 |
| `npm run test:verification` | 核对证明刷新及构建检查脚本 |

引擎或适配变化后的长期回归使用固定机制用例；新对象首次准入按其真实配置另行验收，不新增只校验已录入对象资料的回归。代表计算页面还需验证真实编译／运行／释放，Node单测不能代替浏览器。

Wasm的正式参数及工具链见[引擎说明](../wasm/tinygo_engine_v2/README.md)，正式证明刷新和证据保存见[开发与独立评审流程](../文档记录/项目说明/开发与独立评审流程说明.md)。本页只保存当前入口；历史适配版本、逐轮测试数和安装流水从验收记录及Git历史追溯。
