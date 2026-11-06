# 浏览器测试配置

本目录集中维护 Playwright（浏览器测试工具）的配置；用例位于 `web/tests/e2e/`，合成数据、测试页面和工作线程夹具位于 `web/tests/fixtures/`。完整前端检查入口见[前端说明](../../README.md)。

所有命令从 `web/` 运行。先核对选中的用例，再执行对应验收：

```powershell
npx playwright test --config tests/playwright/playwright.non-wasm.config.ts --list
npm run test:e2e:non-wasm
```

| 需要验证什么 | 配置入口 |
| --- | --- |
| 管理页、账号、访问统计及模式切换 | `playwright.non-wasm.config.ts`、`playwright.auth.config.ts`、`playwright.visits.config.ts`、`playwright.workspace-modes.config.ts` |
| 单次与连续普攻、装备、自然或触发技能 | 对应 `playwright.simulation-*.config.ts` |
| 多段、引导、混合或自动过程 | `simulationComplexSkills.config.ts`、`simulationChannelWindow.config.ts`、`simulationMixedSkills.config.ts`、`simulationAutomaticSkills.config.ts` 等 |
| 公式、枚举、分类和共用规则 | 对应 `formulaPhase*.config.ts`、`skillSystemEnums.config.ts`、`classificationCostBindings.config.ts`、`calculationRules.config.ts` |
| 已运行真实服务的显式验收 | `playwright.*-live.config.ts`、`liveCombatAnalysis.config.ts`，先核对用例所需环境开关及读写授权 |

配置只负责选择用例、浏览器、服务来源和产物位置。启动命令的 `cwd`（进程工作目录）明确指向前端模块，由 `paths.ts` 集中定位；配置文件迁移不能使服务从测试目录启动。证据继续写入被忽略的 `web/output/`，不与配置混放。

新增或移动配置后核对：TypeScript配置是否收集、导入和命令是否有效、实际发现的文件及测试身份是否一致。`--list` 只证明发现结果，实际服务启动和浏览器行为仍需用对应配置验证。配置之间可能有意重叠，不将同一个用例被多份配置选中累计成独立覆盖。
