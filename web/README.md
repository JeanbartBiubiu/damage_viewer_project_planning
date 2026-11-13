# Damage Viewer Web

前端从同一代码库构建公共查看版和私有维护版。公共查看版默认进入混合战斗分析，保留场景输入、只读配置解释、计算和问题反馈；私有维护版保留数据管理与计算复核。两个产物调用同一个后端，公共产物不包含编辑页面或维护保存流程。工作边界见[模块规则](AGENTS.md)，身份与提交约束见[共享维护契约](../contracts/maintenance/README.md)。

理解用户路径、概念关系与计算全貌，先读[项目知识手册](../文档记录/项目说明/项目知识手册/README.md)。本文维护前端实现和操作入口。

## 页面与源码入口

| 范围 | 入口 |
| --- | --- |
| 构建装配、应用与路由 | `src/App.tsx`、`src/ViewerApp.tsx`、`src/MaintenanceApp.tsx`、`src/config/deployment.ts`；私有导航为 `src/config/navigation.ts` |
| 11类管理页面 | `src/pages/admin/`；属性、角色、装备、构筑、技能分类、伤害类型、乘区、技能、状态、游戏配置及图片 |
| 技能统一编辑 | `src/pages/admin/skills/SkillConfigurationWorkspace.tsx`；完整基线、六模块草稿及共同保存 |
| 普攻模拟 | `#/simulation/basic-attack`；单次／连续普攻及固定时刻技能计划 |
| 混合战斗分析 | `#/simulation/combat-analysis`；自动连招、背景普攻、曲线及使用／结算联动 |
| 请求与错误 | `src/services/apiClient.ts`，各业务服务位于 `src/services/` |
| 账号与安全 | `src/pages/auth/AccountControls.tsx`、`src/services/authClient.ts`、`src/services/authState.ts`；冻结接口见[账号方案](../文档记录/详细设计/项目/账号注册登录与权限接入技术方案.md) |
| 匿名访问上报 | `src/services/visitStatisticsClient.ts`；统计查询属于私有运维，玩家前端不提供入口 |
| 私有维护会话及候选 | `src/services/maintenanceClient.ts`、`maintenanceState.ts`、`src/pages/maintenance/MaintenanceControls.tsx` |
| 问题报告 | `src/components/ProblemReport.tsx`、`src/services/problemReport.ts`；下载脱敏场景与结果，用户补充图片视频 |
| 场景与生产适配 | `src/engine/simulationAdapter.ts`、`simulationActiveSkills.ts`、`processAdapter.ts` |
| 模拟来源准备 | `src/engine/simulation/sources/`；装备与自然来源分别拥有选择、身份、执行闭包和所属常驻贡献 |
| 通用配置校验与编译 | `src/engine/simulation/compile/`；完整配置校验、共同防御公式及触发程序编译；共享类型在 `simulation/model.ts` |
| Wasm协议与分发 | `src/engine/` 内客户端／工作线程及 `src/engine/wasm/tinygo_engine_v2.wasm` |
| 固定机制回归 | [用例说明](tests/mechanisms/README.md) |

管理保存、配置诊断和真实计算分别提供证据。混合战斗完整对象候选由后端可用目录核对范围、当前内容及引擎／适配器身份；历史证明条目不等于现场可选数量。对象范围、排除与录入边界见[项目说明](../文档记录/项目说明/计算范围与录入边界.md)。

技能、装备和构筑来源保留完整身份，场景输入不按名称猜值。图表和有限明细用于展示，可靠累计与运行完整性从正式输出读取，不能用被截断记录反算全场结果。

无数值的自身单层法术护盾可由真实来源初始化规则建立，并由实际被挡的盾实例监听阻挡事件、显式消费。来源初始化与既有命中路径共用 `spellShieldAdapter.ts`，不按装备名称自动施盾。该接线不代替装备的冷却重获规则；同一目标同时存在多个活动法盾时，沿用原生拒绝，不自行选择优先级。

## 连接与本地开发

依赖和工具版本以 `package.json`、锁文件及已验证工具链为准。浏览器默认同源访问 `/api`；可通过构建环境中的 `VITE_API_BASE_URL` 显式指定精确来源，不在页面编辑或保存任意 API 地址。开发服务将 `/api` 代理到 `DEV_API_TARGET`，缺省为 `http://127.0.0.1:8080`；只有私有维护模式代理 `/internal/maintenance`。公共端的 API 客户端也拒绝游戏配置写入，但最终权限边界由 Nginx 和后端实际路由守卫执行。

账号采用浏览器安全凭据（Cookie），本地账号联调需要加密访问（HTTPS）。在未提交的本地环境文件中配置 `DEV_HTTPS_KEY_PATH` 与 `DEV_HTTPS_CERT_PATH`，分别指向可信本地证书的私钥与证书；二者必须同时提供。后端受控来源配置须包含实际前端来源，代理保留原来源。不要将证书私钥提交到仓库。

顶栏右上角手动进入登录或注册。所有账号均须验证器动态码；注册绑定验证器并确认保存恢复码后等待开通，未完成注册可用原用户名和密码从登录入口继续。会话通过 `/me` 静默恢复；游戏资料读取与只读场景快照始终匿名，不等待会话恢复。未登录或会话失效的受保护操作只弹出“需要登录”提示，用户自行登录后重新操作，当前页面和输入保留。账号安全支持修改密码、更换验证器、重新生成恢复码及退出全部设备。密码、绑定材料、恢复码和会话值不写入浏览器本地存储。

在 `web/` 目录执行：

```powershell
npm ci
npm run dev
```

公共构建用 `npm run build`，输出 `dist/`；预览用 `npm run preview`。公共端空 Hash、旧编辑地址和未知路径进入 `#/simulation/combat-analysis`，只有普攻与混合战斗两个计算入口；本场等级、装备、连招等仍能调整。

私有开发用 `npm run dev:maintenance`，构建用 `npm run build:maintenance`，输出 `dist-maintenance/`。预览使用 `npm run preview -- --mode maintenance --outDir dist-maintenance`，只在受控网络提供。模式在构建时装配，网址参数或浏览器设置不能切换公共产物。两个构建均检查产物中编辑与维护能力的隔离。

维护页面不提供玩家登录入口。宿主按共享契约建立独立维护会话后，页面刷新 `/internal/maintenance/me`；长期维护凭据不进入页面或浏览器存储。默认只编辑候选，点击保存会记录原始请求并保留草稿，可下载 `damage-maintenance-request-v1` 文件，冻结请求正文保持原字节；独立验证后选择已登记的维护批次，正式请求附批次编号，由后端核对冻结内容、基线、有效验证回执及维护窗口。页面不自动创建或打开发布批次，也不在会话失效后重放写入。

计算客户端按构建选择玩家或维护取票入口，维护会话到期、退出或主体变化时清理票据和工作线程。玩家计算资格不因查看版部署改变。反馈仓库使用构建变量 `VITE_FEEDBACK_REPOSITORY`，仅接受 `https://github.com/所有者/仓库`；发布及资料身份可通过 `VITE_RELEASE_ID`、`VITE_GAME_DATA_VERSION` 提供，缺失显示未知。完整场景、运行档案和媒体不放入问题链接查询串；用户下载脱敏复现材料后作为附件提交。

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
| `npm run test:e2e:deployment-modes` | 两种最终产物的入口隔离、公共计算输入与反馈、私有候选及批次请求接线 |
| `npm run test:e2e:auth` | 账号与会话浏览器接线：分步登录／注册、恢复、安全变更、失效提示与草稿保留；使用隔离接口替身，不代替真实后端验证 |
| `npm run test:e2e:visits` | 匿名访问上报、刷新与切页计次、玩家没有统计查询入口及上报不携带凭据；使用隔离接口替身 |
| `npm run check:mechanism-coverage` | 只读核对正式对象声明所依赖的机制用例，不生成新证明 |
| `npm run check:wasm-build` | 按固定工具链及正式参数重建当前源码，与前端分发Wasm逐字节比较 |
| `npm run test:verification` | 核对证明刷新及构建检查脚本 |

浏览器配置集中在[测试配置目录](tests/playwright/README.md)，分别选择管理、账号、访问统计、计算场景、专项机制与真实接口用例。测试数据和工作线程夹具留在 `tests/fixtures/`，浏览器用例留在 `tests/e2e/`。配置文件位置不改变服务的工作目录或 `output/` 证据目录；阶段名称较旧不代表验证对象已删除。`testMatch`、服务来源、注入产物及环境开关都可能不同，删除前应核对真实选择及覆盖。`live`配置使用已运行的真实服务，按用例要求核对授权、数据和鉴权条件。

管理页回归先构建私有产物，账号与匿名上报回归使用公共产物；双模式专项需要两个产物均已构建。管理页接口替身通过真实维护控件选择隔离测试批次，验证浏览器接线，不代替后端对签名回执、基线和事务的验证。

只核对某个配置会选择哪些测试时，在本目录执行以下发现命令；它不运行浏览器用例，也不证明真实接口可用：

```powershell
npx playwright test --config tests/playwright/playwright.p4.config.ts --list
```

引擎或适配变化后的长期回归使用固定机制用例；新对象首次准入按其真实配置另行验收，不新增只校验已录入对象资料的回归。代表计算页面还需验证真实编译／运行／释放，Node单测不能代替浏览器。

Wasm的正式参数及工具链见[引擎说明](../wasm/tinygo_engine_v2/README.md)，正式证明刷新和证据保存见[开发与独立评审流程](../文档记录/项目说明/开发与独立评审流程说明.md)。本页只保存当前入口；历史适配版本、逐轮测试数和安装流水从Git历史追溯。
