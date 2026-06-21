TASK_KEY: web-ui-i18n-cleanup
DOC_TYPE: 详细设计
WORKSTREAM: web
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: pending

# 前端开发方案-UI 英文字段中文化整改

更新时间：2026-06-21

## 1. 背景

当前前端大量面向用户展示的 label、表头、placeholder、按钮、Alert 文案直接复用后端字段名或英文占位文本，中文用户读起来"不说人话"。典型对比：`heroes/modal.tsx` 已用中文（新增英雄/保存/取消），但 `items/modal.tsx` 整段是英文（Create Item/Save/Cancel/item image），风格不统一。

本方案只整改面向用户展示的文案，不动后端字段名、不动接口契约、不动 dataIndex/field key 等内部标识符。

## 2. 整改范围

本轮覆盖（用户已确认）：

1. Admin 资源页全部（`web/src/pages/admin/**`）
2. 公开页全部（`OverviewPage / VersionPublishPage / ImagesPage / WasmValidation* / WorkspacePage`）
3. 通用组件里展示给用户的英文 label（`web/src/components/**`）

不在本轮范围：

- `App.tsx`、`config/navigation.ts` 的导航标签（已基本中文，仅 `V2 DPS Batch H` 一处需改）
- 代码标识符（变量名、type 名、import 名）
- `dataIndex` / `field` key 等纯内部字段名（除非被直接渲染成 title）
- `console` / `throw new Error(...)` 里纯技术报错（除非 message 会通过 Alert 直接展示给用户）

## 3. 整改原则

### 3.1 术语策略（用户已确认：纯中文化）

技术术语一律中文化，不保留英文缩写：

| 英文术语 | 中文化翻译 | 备注 |
| --- | --- | --- |
| DPS | 每秒伤害 | 表头/标签全改 |
| DoT | 持续伤害 | M4.8 标签 |
| HoT | 持续治疗 | M4.9 标签 |
| HP | 生命值 | M2/V2DPS 表头 |
| AST | 抽象语法树 | formula-profiles option |
| Tick | 周期 | M3 表头 tickFormulaId/tickInterval |
| Gate | 门槛 | M4.3 冷却门槛 / M4.15 动作门槛 |
| Bundle | 数据包 | VersionPublishPage |
| Wasm | Wasm | 保留（产品名，无合适中文） |
| TinyGo | TinyGo | 保留（产品名） |
| URI | 资源标识 | ImagesPage |
| ID | ID | 保留（"英雄 ID"格式，不写成"英雄标识"） |
| Key | Key | 保留（"乘区 Key"格式，Key 是数据契约术语） |

> 风险提示：DPS/DoT/HoT 在游戏伤害计算语境里是行业通用术语，纯中文化可能让开发者读者反而需要二次翻译。若后续受众反馈不适应，可回退为"中文（英文缩写）"格式，如"每秒伤害（DPS）"。本轮按用户选择执行纯中文化。

### 3.2 字段名 label 规范

- 业务字段直接中文：`description→描述`、`params→参数`、`priority→优先级`、`goldCost→金币成本`、`name→名称`、`title→称号`
- ID 类字段：`中文实体 + 空格 + ID`，如 `heroId→英雄 ID`、`itemId→装备 ID`、`skillId→技能 ID`、`ruleId→规则 ID`、`statusTypeId→状态类型 ID`、`actionTypeIds→动作类型 ID`、`actionMatchTypeIds→动作匹配类型 ID`、`interruptPhaseTypeIds→打断阶段类型 ID`、`ownerId→所有者 ID`、`versionId→版本 ID`、`versionCode→版本代码`
- Key 类字段：`中文实体 + 空格 + Key`，如 `bucketKey→乘区 Key`、`bindingKey→绑定 Key`、`stageKey→阶段 Key`、`targetAttrKey→目标属性 Key`、`attrKey→属性 Key`、`skillKey→技能 Key`、`rateTargetAttrKey→比率目标属性 Key`
- 复合字段：`targetCategory→目标类别`、`targetId→目标 ID`、`formulaId→公式 ID`、`formulaType→公式类型`、`formulaKind→公式种类`、`overrideParams→覆盖参数`、`resolutionDomain→分辨域`、`aggregationMode→聚合模式`、`targetAttrKey→目标属性 Key`、`editorHint→编辑器提示`、`bucketConfig→乘区配置`、`ruleKind→规则种类`、`extend→扩展`

### 3.3 Select option label 规范

option 的 `value` 不动（保持接口契约），只改 `label` 为中文：

- `resolutionDomain`：`attribute→属性`、`damage→伤害`、`global→全局`
- `aggregationMode`：`add→加法`、`multiply→乘法`、`max→最大值`、`min→最小值`
- `ruleKind`：`forbid→禁用`、`interrupt→打断`、`limit→限制`
- `formula-profiles`：`AST→抽象语法树`
- `SkillMechanicsConfigEditor`：`copyable_on_hit→可复制普攻命中`

### 3.4 placeholder 规范

- 示例值保留英文原值（如 `damage.skill.katarina.r.base`、`skill_katarina_r`、`magic_damage.percent_bonus`、`status_stun_forbid_cast`），因为这些是用户参考的数据格式
- 提示语中文化：`Input itemId→请输入装备 ID`、`Input name→请输入名称`、`Input goldCost→请输入金币成本`、`Fill itemId first to generate uri→请先填写装备 ID 以生成图片标识`

### 3.5 按钮/标题/Alert 规范

- Modal 标题：`Create Item→新增装备`、`Edit Item→编辑装备`、`View Item→查看装备`
- 按钮：`Save→保存`、`Cancel→取消`、`Close→关闭`
- Alert：`statModifiers parse failed: ...→属性修正解析失败：...`、`attribute definitions load failed: ...→属性定义加载失败：...`、`skillRefs parse failed: ...→技能引用解析失败：...`
- 成功提示混用修正：`已创建 skill ... 请点击 Save 保存 item。→已创建技能 ... 并加入技能引用草稿；请点击「保存」保存装备。`
- 空状态：`No image→未上传`
- 上传说明：`Upload will center-crop and normalize to 64x64 before saving.→上传时会先居中裁切为 64x64，再同步写入服务端和本地 IndexedDB。`

### 3.6 测试用例标签（M4ClosurePage）

保留英雄名+技能名英文（Lux/Taric/Mundo/Quinn/Vayne 是产品专有名词），箭头和说明中文化：

- `Lux W -> enemy damage→Lux W → 敌方伤害`
- `Taric Q with damaged self→Taric Q 自身受伤`
- `Mundo R ticks with damaged self→Mundo R 周期伤害自身受伤`
- `Quinn E -> Harrier Hit→Quinn E → Harrier 命中`
- `Vayne W increments -> counter read→Vayne W 计数器增加 → 计数器读取`

## 4. 分批整改清单

### 第一批：Admin 资源页（最严重）

| 文件 | 问题数 | 主要问题 |
| --- | --- | --- |
| `web/src/pages/admin/resources/items/modal.tsx` | 22+ | Modal 标题/按钮全英文、Form.Item label 全英文、placeholder 全英文、Alert 全英文、DPS Passive 面板 label 全英文、成功提示混用 Save |
| `web/src/pages/admin/adminResourceConfig.ts` | 37 label + 14 placeholder + 10 option | 4 个资源的 createFields label 全英文字段名、Select option label 全英文原值 |
| `web/src/pages/admin/resources/heroes/columns.tsx` | 1 | 表头 `heroId` |
| `web/src/pages/admin/resources/heroes/modal.tsx` | 2 | Form.Item label `heroId`、placeholder `请输入 heroId` |
| `web/src/pages/admin/resources/items/columns.tsx` | 2 | 表头 `itemId`、`goldCost` |
| `web/src/pages/admin/resources/skills/columns.tsx` | 4 | 表头 `skillId`、`ownerType`、`ownerId`、`skillKey` |
| `web/src/pages/admin/resources/attribute-definitions/columns.tsx` | 3 | 表头 `attrKey`、`valueKind`、`bounds` |
| `web/src/pages/admin/resources/attribute-definitions/modal.tsx` | 3 | Form.Item label `attrKey`、`valueKind`、`rateTargetAttrKey` |
| `web/src/pages/admin/resources/formula-profiles/constants.ts` | 1 | option label `AST` |
| `web/src/components/skill-editor/SkillMechanicsConfigEditor.tsx` | 1 | option label `copyable_on_hit` |

### 第二批：公开页 DetailGrid label

| 文件 | 问题数 | 主要问题 |
| --- | --- | --- |
| `web/src/pages/OverviewPage.tsx` | 2 | DetailGrid label `versionCode`、`versionId` |
| `web/src/pages/VersionPublishPage.tsx` | 3 | DetailGrid label `current version`、`bundle version`、`dataHash` |
| `web/src/pages/ImagesPage.tsx` | 2 | DetailGrid label `serverUri`、`localUri` |

### 第三批：Wasm 验证页表头

| 文件 | 问题数 | 主要问题 |
| --- | --- | --- |
| `web/src/pages/WasmValidationM2Page.tsx` | 8 | 表头 `actorId`、`HP`、`Shield`、`Attributes`、`Resources`、`Actor` |
| `web/src/pages/WasmValidationM3Page.tsx` | 5 label + 5 表头 | `M4.3 冷却 gate`、`M4.8 DoT`、`M4.9 HoT`、`M4.15 动作 gate`；表头 `statusId`、`statusSource`、`tickFormulaId`、`tickCritMultiplier`、`tickInterval / count` |
| `web/src/pages/WasmValidationV2DpsPage.tsx` | 15+ | 表头 `Curve`、`Status`、`Blocked Reasons`、`Total`、`DPS`、`Kill`、`Attacks`、`Damage By Type`、`Damage By Source`、`HP`、`AA`、`SK`，以及 2913-2998 行的 `skillId/sourceKind/actionId/classifier/critPolicy/critMultiplierSource/critMultiplier/severity/code/audience/itemId/itemName/skillName/message` |
| `web/src/pages/WasmValidationM4ClosurePage.tsx` | 5 | 测试用例标签英文混用 |
| `web/src/config/navigation.ts` | 1 | `V2 DPS Batch H→V2 DPS 批量英雄` |

## 5. 验证方式

按 `web/AGENTS.md` 第 7 节完成定义：

1. 改 `web/**` 代码后至少运行 `cd web; npm run build`（TypeScript 编译 + Vite 构建）
2. 改页面/交互/服务层时按影响范围做浏览器 smoke check：
   - 总览页读取当前游戏与当前版本
   - 版本发布页读取 current / bundle
   - Wasm M2/M3/V2DPS 验证页加载当前版本、Bundle 与 TinyGo V2 产物
   - Admin 资源页增删改查（重点核对 items 资源页 Modal、DPS Passive 创建面板）
   - 图片缓存页同步
3. 整改是纯展示文案，不涉及接口契约和数据流，无需后端联调

## 6. 落地方式

本方案经用户确认为"先不改，只要方案"。后续执行时按 `AGENTS.md` 第 2 节 Cursor 协同流程推进：

1. GPT 按本方案收敛每批范围，编写 Cursor prompt（明确目标、允许写入范围、非目标、验证命令、停止条件）
2. Cursor 受限执行（`composer-2.5` + `fast=false`）
3. GPT 检查 Cursor 产物、事件日志、`git diff`，亲自跑 `npm run build` 和浏览器 smoke 验收

也可由 GPT 直接改（纯展示文案、风险低、范围明确），但需用户明确许可偏离 Cursor 流程。

## 7. 风险与注意事项

1. **纯中文化的术语风险**：DPS/DoT/HoT 中文化后，开发者读者可能需要二次翻译。若受众反馈不适应，可回退为"中文（英文缩写）"格式。本轮按用户选择执行纯中文化。
2. **示例值保留**：placeholder 中的英文示例值（如 `damage.skill.katarina.r.base`）是用户参考的数据格式，不能中文化。
3. **option value 不动**：Select option 的 `value` 是接口契约，只改 `label`，避免影响提交 payload。
4. **dataIndex 不动**：表格列的 `dataIndex` 是数据绑定键，只改 `title`，避免影响数据渲染。
5. **Wasm 验证页是开发自测页**：表头改动收益相对低，可放在最后一批或视受众决定是否整改。
6. **不动 throw message**：纯技术报错（如 `statModifiers[${index}] must be object`）若不通过 Alert 直接展示给用户，本轮不改；若会展示，需同步中文化。

## 8. 入口文件核对

本方案提到的入口文件均已核对存在：

- `web/src/pages/admin/adminResourceConfig.ts`
- `web/src/pages/admin/resources/{heroes,items,skills,attribute-definitions,formula-profiles}/**`
- `web/src/pages/{OverviewPage,VersionPublishPage,ImagesPage,WasmValidationM2Page,WasmValidationM3Page,WasmValidationV2DpsPage,WasmValidationM4ClosurePage}.tsx`
- `web/src/config/navigation.ts`
- `web/src/components/skill-editor/SkillMechanicsConfigEditor.tsx`
