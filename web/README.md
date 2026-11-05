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
| 账号与安全 | `src/pages/auth/AccountControls.tsx`、`src/services/authClient.ts`、`src/services/authState.ts`；冻结接口见[账号方案](../文档记录/详细设计/项目/账号注册登录与权限接入技术方案.md) |
| 访问统计 | `src/services/visitStatisticsClient.ts`、`src/components/VisitStatistics.tsx`；[统计口径、权限与安装](../db/visit_statistics/README.md) |
| 场景与生产适配 | `src/engine/simulationAdapter.ts`、`simulationActiveSkills.ts`、`processAdapter.ts` |
| 模拟来源准备 | `src/engine/simulation/sources/`；装备与自然来源分别拥有选择、身份、执行闭包和所属常驻贡献 |
| 通用配置校验与编译 | `src/engine/simulation/compile/`；完整配置校验、共同防御公式及触发程序编译；共享类型在 `simulation/model.ts` |
| Wasm协议与分发 | `src/engine/` 内客户端／工作线程及 `src/engine/wasm/tinygo_engine_v2.wasm` |
| 固定机制回归 | [用例说明](tests/mechanisms/README.md) |

管理保存、配置诊断和真实计算分别提供证据。混合战斗完整对象候选由后端可用目录核对范围、当前内容及引擎／适配器身份；历史证明条目不等于现场可选数量。对象范围、排除与录入边界见[项目说明](../文档记录/项目说明/计算范围与录入边界.md)。

技能、装备和构筑来源保留完整身份，场景输入不按名称猜值。图表和有限明细用于展示，可靠累计与运行完整性从正式输出读取，不能用被截断记录反算全场结果。

## 连接与本地开发

依赖和工具版本以 `package.json`、锁文件及已验证工具链为准。浏览器默认同源访问 `/api`；可通过构建环境中的 `VITE_API_BASE_URL` 显式指定精确来源，不在页面编辑或保存任意 API 地址。开发服务将 `/api` 代理到 `DEV_API_TARGET`，缺省为 `http://127.0.0.1:8080`。

账号采用浏览器安全凭据（Cookie），本地账号联调需要加密访问（HTTPS）。在未提交的本地环境文件中配置 `DEV_HTTPS_KEY_PATH` 与 `DEV_HTTPS_CERT_PATH`，分别指向可信本地证书的私钥与证书；二者必须同时提供。后端受控来源配置须包含实际前端来源，代理保留原来源。不要将证书私钥提交到仓库。

顶栏右上角手动进入登录或注册。所有账号均须验证器动态码；注册绑定验证器并确认保存恢复码后等待开通，未完成注册可用原用户名和密码从登录入口继续。会话通过 `/me` 静默恢复；游戏资料读取与只读场景快照始终匿名，不等待会话恢复。未登录或会话失效的受保护操作只弹出“需要登录”提示，用户自行登录后重新操作，当前页面和输入保留。账号安全支持修改密码、更换验证器、重新生成恢复码及退出全部设备。密码、绑定材料、恢复码和会话值不写入浏览器本地存储。

在 `web/` 目录执行：

```powershell
npm ci
npm run dev
```

生产构建用 `npm run build`，预览用 `npm run preview`。空Hash和未知路径进入 `#/attributes`。接口失败先核对后端、同源代理、证书及受控来源配置。

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
| `npm run test:e2e:auth` | 账号与会话浏览器接线：分步登录／注册、恢复、安全变更、失效提示与草稿保留；使用隔离接口替身，不代替真实后端验证 |
| `npm run test:e2e:visits` | 访问上报、刷新与切页计次、统计查看权限及关闭／退出后的清理；使用隔离接口替身 |
| `npm run check:mechanism-coverage` | 只读核对正式对象声明所依赖的机制用例，不生成新证明 |
| `npm run check:wasm-build` | 按固定工具链及正式参数重建当前源码，与前端分发Wasm逐字节比较 |
| `npm run test:verification` | 核对证明刷新及构建检查脚本 |

引擎或适配变化后的长期回归使用固定机制用例；新对象首次准入按其真实配置另行验收，不新增只校验已录入对象资料的回归。代表计算页面还需验证真实编译／运行／释放，Node单测不能代替浏览器。

Wasm的正式参数及工具链见[引擎说明](../wasm/tinygo_engine_v2/README.md)，正式证明刷新和证据保存见[开发与独立评审流程](../文档记录/项目说明/开发与独立评审流程说明.md)。本页只保存当前入口；历史适配版本、逐轮测试数和安装流水从验收记录及Git历史追溯。
