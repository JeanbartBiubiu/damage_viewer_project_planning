TASK_KEY: wasm-validation-m2-action-panel
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: active
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-05-06

# M2 Action 面板值对齐验证计划

关联文档：
1. `文档记录/概要设计/验证里程碑.md`
2. `文档记录/详细设计/验证计划编写说明.md`

## 1. 目标与绑定里程碑

目标里程碑：`M2 Action 面板值对齐`。

本计划只验证 action 面板投影值，不跑完整战斗、不验证命中、抗性、最终伤害或 1v1 调度。主目标是证明 Wasm `action_snapshot` 能逐字段输出技能等级、资源消耗、冷却、面板效果和公式证据，供人工基线逐项比对。

## 2. case 定义

caseId：`M2-action-panel-min-001`。

绑定对象：
1. 游戏：LoL 或当前发布 bundle 对应游戏。
2. 版本：记录 `versionCode`、`dataHash` 或等价发布快照标识；没有真实快照时不得填写通过结论。
3. 英雄：一个固定攻击方英雄。
4. 技能：一个固定主动技能。
5. 目标：一个固定敌方或训练营假人。
6. 模式：训练营或等价可观察面板环境。
7. seed：固定为页面/adapter 当前传入的 seed，默认 `7`。
8. 等级：固定英雄等级和技能等级。
9. 装备：固定装备列表；没有装备时记录为空数组。

## 3. 输入构造

Bundle 来源优先使用已发布快照：`loadPublishedBundleSnapshot(apiBaseUrl, gameId)`。页面草稿和编辑器未发布数据不进入本计划。

Wasm 输入由 Web adapter 生成：
1. `engineBundle.actions[].skillLevel` 和 `engineBundle.actions[].panelInputs` 作为 bundle 默认值。
2. `runInput.self.actionInputs[actionId].skillLevel` 与 `runInput.enemy.actionInputs[actionId].skillLevel` 作为本次验证的显式等级输入。
3. `runInput.*.actionInputs[actionId].panelInputs` 至少包含 `skillLevel` 与 `championLevel`。
4. action 若没有专用 `panelCosts/panelEffects`，允许 Wasm 从 `resourceCost/effects` 投影面板行。
5. 技能效果公式优先使用 `bindingKey` 和 `formulaBindings`；如果当前发布样本只有 `mechanicsConfig.damage.formulaText`，Web adapter 可把内联公式编译成本轮 action 专属 formula id。
6. 内联公式中的常见属性别名只在 bundle 存在目标 key 时归一，例如 `ability_power` 可归一到 `ap`；验收表仍以 Wasm 实际输出的 `formulaId/breakdown.ref` 为准。
7. 冷却时间至少拆成两个口径：静态基础冷却和非 0 技能急速参与后的展示冷却。只有静态 `cooldowns const` 输出时，不得声称已经验证技能急速公式。

页面入口：`#/wasm-validation-m2`。最少步骤是选择游戏、选择英雄/等级/技能等级/装备，运行快照，导出 M2 action snapshot。

## 4. 游戏侧基线与证据来源

基线必须来自游戏侧可追溯证据，不能由 Wasm 输出反推。推荐证据：
1. 训练营技能面板截图。
2. 英雄等级、技能等级、装备栏截图。
3. 游戏版本号或客户端版本记录。
4. 人工抄录表；OCR 只能作为辅助抽取。

当前没有真实截图、OCR 或人工基线时，验收状态只能是 `missing_evidence`，不能写 `match` 或 gate 通过。

## 5. Wasm 输出字段与对照关系

实际消费的 Wasm 输出载体：`action_snapshot`，frame kind 为 `17`。

字段对照：
1. `actors[].actions[].skillLevel` 对应技能等级。
2. `actors[].actions[].panelInputs.skillLevel` 对应输入包中的技能等级证据。
3. `actors[].actions[].cooldownMs` 对应游戏技能冷却面板。
4. `actors[].actions[].cooldownFormulaId` 与 `cooldownBreakdown` 对应冷却公式来源和计算证据。
5. `resourceCosts[].resourceId/finalAmount/formulaId/breakdown` 对应资源消耗字段。
6. `effectRows[].kind/finalAmount/formulaId/breakdown` 对应技能面板效果字段。
7. `canCast/blockedReason/readyAtMs` 只作为辅助 gate 观察，不替代面板值验收。

## 6. 验收表结构

本计划的执行输出必须转成可直接人工进游戏填写的 Markdown 表格。表格字段要能直接复制为 CSV，不在单元格内换行。

人工复核表固定列：

| 列名 | 填写方 | 说明 |
| --- | --- | --- |
| `case_id` | 开发侧 | 固定为本计划的 caseId 或其子行 id。 |
| `阶段` | 开发侧 | 固定为 `M2`。 |
| `游戏版本` | 开发侧 + 人工 | 开发侧填 bundle / data source 版本；人工复核时补客户端版本。 |
| `模式/地图/训练环境` | 人工 | 例如训练模式、召唤师峡谷、自定义训练假人等。 |
| `champion / level / 装备 / 符文或其他前置状态` | 开发侧 + 人工 | 开发侧给当前输入；人工按游戏实际环境修正。 |
| `action/skillKey` | 开发侧 | 例如 `skill_ahri_q / Q`。 |
| `skillLevel` | 开发侧 + 人工 | 开发侧填 run input；人工按游戏内技能等级确认。 |
| `字段 key` | 开发侧 | 对应 Wasm 输出或 bundle 字段。 |
| `字段中文名` | 开发侧 | 给人工可识别的字段名。 |
| `Web 展示值` | 开发侧 | 页面字段证据表或 ABI trace 里的展示值。 |
| `Wasm 输出值` | 开发侧 | `action_snapshot` 中的值。 |
| `Server/bundle 来源：versionCode、dataHash 或 snapshot id` | 开发侧 | 必须能追溯发布快照。 |
| `开发侧证据：命令、页面、截图、日志或输出摘要` | 开发侧 | 填命令、页面、artifact hash、snapshot 摘要；没有截图时显式写 `开发侧截图未产出`。 |
| `游戏内查看步骤：我进游戏时要点哪里、看哪个面板` | 开发侧 | 必须足够让人工复现。 |
| `游戏内实测值：留空，等待我填写` | 人工 | 开发侧不得代填。 |
| `允许误差/显示精度` | 开发侧 | 按游戏面板显示精度填写。 |
| `人工结论：待测/通过/失败/需复查` | 人工 | 默认 `待测`；没有游戏实测值不得改成通过。 |
| `diff 描述` | 人工 + 开发侧 | 有差异时填写差异现象。 |
| `归因状态：未归因/人工记录疑似/显示取整/数据映射/Server 数据/Web 转换/Wasm 计算` | 人工 + 开发侧 | 默认 `未归因`。 |
| `下一步 owner：human/web/wasm/server/backend-data` | 开发侧 + 人工 | 指明后续补证据或修复归属。 |

本计划的第一张人工复核表落在：`文档记录/测试记录/wasm/M2-Action面板值对齐-人工复核表-2026-05-07.md`。

每次生成或更新表格时，至少覆盖这些 M2 字段：
1. 技能基础值。
2. 技能等级影响。
3. 属性加成系数。
4. 当前属性参与后的面板展示结果。
5. 消耗资源。
6. 冷却时间。
7. `versionCode` / `dataHash` / wasm artifact 或等价快照标识。

冷却字段的验收要求：
1. `cooldown_static` 行可以要求技能急速为 0，用于隔离 bundle 静态基础冷却。
2. `cooldown_ability_haste` 行必须使用非 0 技能急速输入，并消费 `cooldownFormulaId/cooldownBreakdown` 或等价字段。
3. 如果当前 wasm/web 输出还没有非 0 技能急速冷却行，必须在表格里写 `TODO` 和 owner，不能用静态冷却行替代。

表格行的默认人工结论只能是 `待测`。开发侧命令、build、smoke、页面运行成功只说明“开发侧已产出值”，不能说明 M2 gate 通过。

内部状态枚举仍沿用验证计划 / 验收 sub agent 口径：
1. `match`
2. `diff`
3. `low_confidence`
4. `missing_evidence`

## 7. 通过标准

通过不是零 diff。通过标准是主证据字段没有未解释的阻塞级 `diff`。

规则：
1. 主证据字段不得存在未解释 `diff`。
2. 已归因、已登记、当前不阻塞的差异可以保留，但必须写进 `note`。
3. `low_confidence` 和 `missing_evidence` 不能伪装为通过。
4. 如果没有游戏侧截图或人工基线，只能判定“实现推进完成 / 验收准备就绪”，不能判定 M2 gate 通过。

## 8. 升级规则

以下情况必须升级人工复核或主 agent 排查：
1. 人工记录缺版本、缺训练环境或技能等级。
2. 游戏面板存在取整、隐藏修正或显示口径不明。
3. Web/Server 字段映射丢失等级、装备、符文、技能等级或版本。
4. 发布快照 `versionCode` 与人工基线版本不一致。
5. Web adapter 没把字段转成 Wasm 输入。
6. Wasm 公式、属性读取、资源读取或 cooldown 计算出现未解释 diff。

## 9. 验收 sub agent 输入包

验收 sub agent 必须拿到：
1. `case_meta`：英雄、等级、技能等级、装备、模式、seed、`versionCode`、`dataHash` 或等价快照标识。
2. `wasm_output`：页面导出的 `action_snapshot` JSON 或字段证据表。
3. `baseline_input`：人工基线表、OCR 结果或截图抄录。
4. `evidence_index`：截图路径、截图时间点、字段来源说明。

可自动生成：`wasm_output`、部分 `case_meta`、字段证据表。

必须人工补：游戏侧截图、截图到字段的解释、无法从发布快照推导的训练环境说明。

## 10. 交付物

1. M2 action snapshot JSON。
2. 字段证据表。
3. 人工基线证据包。
4. 单独测试记录，放在 `文档记录/测试记录/wasm/`。
5. 如果有 diff，记录 diff 排查结论和是否阻塞 M2 gate。

## 11. 非目标

1. 不验证 M3 单技能释放结算。
2. 不验证 M4 资源消耗、冷却、护盾、治疗等机制闭环。
3. 不做完整 1v1。
4. 不要求自动 OCR 或自动采集游戏客户端。
5. 不重做通用参数 DSL 或编辑器协议。
