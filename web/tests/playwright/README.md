# 浏览器测试配置

本目录集中维护 Playwright（浏览器测试工具）的配置；用例位于 `web/tests/e2e/`，合成数据、测试页面和工作线程夹具位于 `web/tests/fixtures/`。完整前端检查入口见[前端说明](../../README.md)。

所有命令从 `web/` 运行。先核对选中的用例，再执行对应验收：

```powershell
npx playwright test --config tests/playwright/playwright.non-wasm.config.ts --list
npm run test:e2e:non-wasm
```

| 需要验证什么 | 配置入口 |
| --- | --- |
| 私有管理页、玩家账号、匿名访问上报及私有工作模式切换 | `playwright.non-wasm.config.ts`、`playwright.auth.config.ts`、`playwright.visits.config.ts`、`playwright.workspace-modes.config.ts` |
| 公共查看与私有维护两个最终构建产物 | `playwright.deployment-modes.config.ts`；先完成公共及私有构建 |
| 公共查看版角色、等级与装备选择 | `playwright.viewer-selection.config.ts`；私有工作模式与草稿保护继续由 `playwright.workspace-modes.config.ts` 验证 |
| 单次与连续普攻、装备、自然或触发技能 | 对应 `playwright.simulation-*.config.ts` |
| 多段、引导、混合或自动过程 | `simulationComplexSkills.config.ts`、`simulationChannelWindow.config.ts`、`simulationMixedSkills.config.ts`、`simulationAutomaticSkills.config.ts` 等 |
| 公式、枚举、分类和共用规则 | 对应 `formulaPhase*.config.ts`、`skillSystemEnums.config.ts`、`classificationCostBindings.config.ts`、`calculationRules.config.ts` |
| 已运行真实服务的显式验收 | `playwright.*-live.config.ts`、`liveCombatAnalysis.config.ts`，先核对用例所需环境开关及读写授权 |

配置只负责选择用例、浏览器、服务来源和产物位置。启动命令的 `cwd`（进程工作目录）明确指向前端模块，由 `paths.ts` 集中定位；配置文件迁移不能使服务从测试目录启动。证据继续写入被忽略的 `web/output/`，不与配置混放。

新增或移动配置后核对：TypeScript配置是否收集、导入和命令是否有效、实际发现的文件及测试身份是否一致。`--list` 只证明发现结果，实际服务启动和浏览器行为仍需用对应配置验证。配置之间可能有意重叠，不将同一个用例被多份配置选中累计成独立覆盖。

非 Wasm 管理页使用 `dist-maintenance/`，账号和访问上报使用公共 `dist/`。双模式专项分别启动两个预览入口。隔离替身的回环预览明确禁用本机开发证书配置，不改变产品和真实账号联调的 HTTPS 要求。

真实计算浏览器用例通过 `tests/fixtures/computeAuthorization.ts` 为合成测试主体取得第 2 版签名计算票据。签发材料只在测试进程中读取 `DAMAGE_TEST_GRANT_PRIVATE_KEY_PATH`，缺省使用仓库现有私有配置 `config/auth/grant-private.pk8`；先核对其公钥与正式分发引擎一致，缺失或不匹配直接失败，不关闭验签。材料和签名票据不写源码或终端；涉及取票的用例不采集网络跟踪档案。接口替身只验证浏览器和真实引擎交接，真实玩家资格与维护事务仍由后端验收。
