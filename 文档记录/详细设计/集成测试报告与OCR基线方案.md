TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-05-12

# 集成测试报告与 OCR 基线方案

关联文档：

1. `文档记录/概要设计/验证里程碑.md`
2. `文档记录/详细设计/验证计划编写说明.md`
3. `文档记录/详细设计/最小验证/数据/技能配置说明.md`
4. `文档记录/测试记录/M1-M3人工验收数据清单.md`

## 1. 目标与定位

本文定义 Web -> Wasm 集成测试报告的输出形态、expected baseline 管理、离线 OCR 证据接入和 diff 归因规则。它服务 M1、M1.1、M2 以及后续 M3/M4 的最小验证闭环。

核心定位：

1. 报告由集成测试 runner 产出，不依赖用户在页面上临时填写验证表。
2. 用户在页面上的配置操作默认视为业务输入；测试失败时优先怀疑测试期望、配置数据、发布快照和字段映射，再排查 Wasm 引擎。
3. OCR 只用于早期建立或修正 expected baseline，降低从游戏截图抄数的成本。
4. OCR 不进入普通用户功能路径，不作为 Web、Server 或 Wasm 的线上依赖。

## 2. 总体流程

1. 人或脚本先通过页面/后台/fixture 准备一组可运行配置，例如英雄、等级、装备、技能等级和模式开关。
2. 集成测试 runner 加载同一份发布 bundle 或 fixture 输入。
3. 测试通过 Web adapter 构造 Wasm 输入，并调用现有 TinyGo V2 bridge 得到实际输出。
4. 测试读取 expected baseline，逐字段比较实际输出。
5. 测试输出 Markdown/JSON 报告，记录配置输入、发布快照、Wasm 输出、expected baseline、diff 和归因建议。
6. 如果需要建立或刷新 expected baseline，离线运行 OCR 工具处理游戏截图，再由人工确认后写入 baseline fixture。

## 3. case 来源

集成测试 gate 使用固化 case fixture，而不是每次无约束随机生成。

case 来源分两类：

1. `golden`：已经人工确认过 expected baseline，可作为集成测试通过标准。
2. `candidate`：本地探索或随机抽样得到的新 case，只能生成候选报告；确认 baseline 后才能升级为 `golden`。

本地随机抽样仍然允许，但必须遵守：

1. 随机结果写入候选报告。
2. 人工确认游戏侧 baseline。
3. 固化为 case fixture。
4. 下一轮才进入集成测试 gate。

默认 case 数量：

| 阶段 | gate 默认 case 数 | 说明 |
| --- | ---: | --- |
| M1 | 3 | HUD 可见字段 |
| M1.1 | 2 | 每个 case 至少带 1 件改变目标高级属性的装备 |
| M2 | 2 | 每个 case 最多验证 1 个技能 |
| M3 | 1 | 单技能 1v 假人 |
| M4.x | 1 | 每个机制 1 个 case，加固定回归 case |

## 4. baseline 管理

expected baseline 是集成测试的比较对象，不是运行时用户输入。

baseline 行结构建议：

```ts
type ExpectedField = {
  fieldKey: string;
  fieldLabel: string;
  expectedValue: number | string;
  tolerance: number | 'exact';
  source: 'manual_game' | 'ocr_confirmed' | 'derived_fixture';
  evidenceRef?: string;
  note?: string;
};
```

case fixture 结构建议：

```ts
type ValidationCaseFixture = {
  caseId: string;
  stage: 'M1' | 'M1.1' | 'M2' | 'M3' | `M4.${number}`;
  status: 'golden' | 'candidate';
  gameId: string;
  gameVersion?: string;
  bundleVersion?: string;
  heroId: string;
  heroName?: string;
  level: number;
  equipmentIds: string[];
  skillId?: string;
  skillLevel?: number;
  mode?: string;
  inputSnapshotRef?: string;
  expected: ExpectedField[];
};
```

baseline 规则：

1. `golden` case 的 expected baseline 必须人工确认。
2. OCR 可作为 `ocr_confirmed` 来源，但不能绕过人工确认。
3. 游戏版本、发布快照或配置模型变化后，相关 baseline 必须标记为待复核。
4. expected baseline 不应直接从当前 Wasm 输出反写，避免把实现错误固化成期望。

### 4.1 人工 baseline 采集数据结构

人工采集记录用于把游戏侧证据升级为 expected baseline。它不是普通用户输入，也不是 Wasm 输出的复制。

```ts
type ManualBaselineCapture = {
  captureId: string;
  caseId: string;
  stage: 'M1' | 'M1.1' | 'M2' | 'M3' | `M4.${number}`;
  gameClientVersion: string;
  gameMode: string;
  capturedAt: string;
  reviewer: string;
  versionCode?: string;
  dataHash?: string;
  wasmSha256?: string;
  evidenceRefs: EvidenceRef[];
  fields: ManualBaselineField[];
};

type EvidenceRef = {
  evidenceRef: string;
  type: 'screenshot' | 'video' | 'ocr_json' | 'manual_note' | 'page_export_json';
  sourcePath?: string;
  capturedAt?: string;
  relatedFields: string[];
  note?: string;
};

type ManualBaselineField = {
  fieldKey: string;
  fieldLabel: string;
  wasmPath?: string;
  wasmValue?: number | string | boolean | null;
  baselineValue: number | string | boolean | null;
  source: 'manual_game' | 'ocr_confirmed' | 'derived_fixture';
  tolerance: number | 'exact';
  unit?: string;
  roundingRule?: string;
  evidenceRef?: string;
  confidence: 'high' | 'low';
  status: 'match' | 'diff' | 'missing_evidence' | 'low_confidence' | 'todo';
  reviewer?: string;
  reviewedAt?: string;
  note?: string;
};
```

采集规则：

1. `baselineValue` 为空时，不得把字段状态写成 `match` 或 `pass`。
2. `source=ocr_confirmed` 必须同时存在 OCR 原始输出和人工确认记录。
3. `source=derived_fixture` 只能表示开发侧自测、公式回扣或不可见字段，不得替代游戏侧证据。
4. case 升级 `golden` 前，必须绑定游戏客户端版本、发布快照标识和 wasm artifact 标识。

## 5. 集成测试报告结构

报告根对象建议：

```ts
type IntegrationValidationReport = {
  reportId: string;
  generatedAt: string;
  command: string;
  gameId: string;
  bundleVersion?: string;
  bundleHash?: string;
  wasmBuild?: string;
  summary: {
    totalCases: number;
    passedCases: number;
    failedCases: number;
    blockedCases: number;
  };
  cases: IntegrationValidationCaseResult[];
};
```

case 结果结构：

```ts
type IntegrationValidationCaseResult = {
  caseId: string;
  stage: string;
  fixtureStatus: 'golden' | 'candidate';
  configSnapshot: {
    heroId: string;
    level: number;
    equipmentIds: string[];
    skillId?: string;
    skillLevel?: number;
  };
  inputHash?: string;
  actualOutputRef?: string;
  rows: IntegrationValidationRow[];
  status: 'pass' | 'fail' | 'blocked';
  likelyRootCause?: 'baseline_stale' | 'config_error' | 'mapping_error' | 'bundle_error' | 'wasm_error' | 'unknown';
};
```

字段结果结构：

```ts
type IntegrationValidationRow = {
  fieldKey: string;
  fieldLabel: string;
  expectedValue: number | string | null;
  actualValue: number | string | null;
  tolerance: number | 'exact';
  status: 'match' | 'diff' | 'missing_expected' | 'missing_actual' | 'blocked';
  evidenceRef?: string;
  note?: string;
};
```

## 6. M1 / M1.1 / M2 字段边界

M1 必填字段：

1. 英雄等级。
2. 生命、主资源。
3. 攻击力、法术强度、护甲、魔抗。
4. 攻击速度、技能急速、暴击率、移动速度。

金币只作为截图或配置上下文记录；如果当前 Wasm/adapter 没有对应输出，不参与 actor 属性 diff。

M1.1 字段：

1. 穿甲、法穿、吸血、韧性、暴击伤害等高级属性。
2. 每个 case 必须带能改变目标字段的装备。
3. OCR 未覆盖高级属性面板前，只能通过人工确认后的 baseline 进入 `golden`。

M2 字段：

1. 技能基础值。
2. 属性加成展示值。
3. 消耗。
4. 冷却。
5. 技能等级影响。

### 6.1 M3 字段边界

M3 验证单技能 1v 假人结算。它可以回扣 M1 actor 初始化和 M2 action 面板值，但主证据来自施法后的 `done.actionResults[]`。

M3 必填人工字段：

| baseline 字段 | Wasm 路径 | 游戏侧证据 | 说明 |
| --- | --- | --- | --- |
| `action.accepted` | `done.actionResults[0].accepted` | 技能成功释放、命中或进入冷却的截图/人工确认 | 不能只凭 Wasm `true` 通过。 |
| `target.hp.before` | `done.actionResults[0].effects[0].targetHpBefore` | 施法前目标 HP 截图/OCR | 最终伤害差值基准。 |
| `target.hp.after` | `done.actionResults[0].effects[0].targetHpAfter` | 命中后目标 HP 截图/OCR | 最终伤害差值基准。 |
| `effect.finalDamage` | `done.actionResults[0].effects[0].finalDamage` | `target.hp.before - target.hp.after` | 不从 Wasm 输出反写 baseline。 |
| `resource.mana.before` | `done.actionResults[0].resourceDeltas[].before` | 施法前攻击方资源截图/OCR | 资源类型按 case 记录。 |
| `resource.mana.after` | `done.actionResults[0].resourceDeltas[].after` | 施法后攻击方资源截图/OCR | 资源类型按 case 记录。 |
| `resource.mana.delta` | `done.actionResults[0].resourceDeltas[].delta` | 前后资源差 | 可回扣 M2 消耗。 |
| `cooldown.cooldownMs` | `done.actionResults[0].cooldownAfter.cooldownMs` | 技能冷却显示或配置复核 | 游戏秒级显示需要换算 ms。 |
| `cooldown.readyAtMs` | `done.actionResults[0].cooldownAfter.readyAtMs` | 技能冷却显示或配置复核 | 单次 0ms 施法时可等同冷却结束时间。 |

M3 开发侧自测字段：

| 字段 | Wasm 路径 | 处理方式 |
| --- | --- | --- |
| `effect.rawAmount` | `done.actionResults[0].effects[0].rawAmount` | 游戏侧通常不可见，只能作为 M2/公式回扣或自测证据。 |
| `done.stopReason` | `done.stopReason` | 页面导出 JSON 记录即可，不要求游戏截图。 |
| `formulaId` | `done.actionResults[0].effects[0].formulaId` | 页面导出 JSON 记录即可，不要求游戏截图。 |

## 7. OCR 证据接入

OCR 工具保持离线：

1. 本地运行 OCR 工具处理游戏截图，输出 JSON/JSONL。
2. 人工检查 OCR 结果。
3. 只有人工确认后的 OCR 值才能写入 expected baseline，并标记 `source: 'ocr_confirmed'`。
4. 集成测试 runner 不直接调用 Python，也不依赖 `C:\project\ocr_tools` 路径。

M1 当前 ROI 映射：

| baseline 字段 | OCR ROI |
| --- | --- |
| `hero_level` | `hud.hero_level` |
| `health` | `hud.health` |
| `primary_resource` | `hud.mana` |
| `attack_damage` | `hud.attack_damage` |
| `ability_power` | `hud.ability_power` |
| `armor` | `hud.armor` |
| `magic_resist` | `hud.magic_resist` |
| `attack_speed` | `hud.attack_speed` |
| `ability_haste` | `hud.ability_haste` |
| `crit_chance` | `hud.crit_chance` |
| `move_speed` | `hud.move_speed` |
| `gold` | `hud.gold`，可选上下文 |

### 7.1 OCR 输出与人工确认表结构

OCR 输出只负责把截图中的候选数值结构化，不能直接裁决 expected baseline。

```ts
type OcrCandidateField = {
  caseId: string;
  fieldKey: string;
  evidenceRef: string;
  roiKey?: string;
  ocrRawValue: string;
  ocrParsedValue?: number | string;
  ocrConfidence?: number;
  manualValue?: number | string;
  reviewer?: string;
  reviewedAt?: string;
  reviewStatus: 'pending' | 'confirmed' | 'rejected' | 'low_confidence';
  note?: string;
};
```

人工确认规则：

1. `reviewStatus=confirmed` 后，才允许把该字段写入 expected baseline。
2. `manualValue` 与 `ocrParsedValue` 不一致时，以人工确认值为准，并在 `note` 记录原因。
3. `ocrConfidence` 低、ROI 截错、截图被遮挡或字段不可见时，字段保持 `low_confidence` 或 `missing_evidence`。
4. OCR JSON、截图和人工确认记录必须通过同一个 `evidenceRef` 串起来，方便复盘。

## 8. diff 归因规则

集成测试失败不默认等于 Wasm 引擎错误。排查顺序：

1. `baseline_stale`：expected baseline 是否来自旧游戏版本、旧 bundle 或旧配置。
2. `config_error`：用户配置或 fixture 是否漏了等级、装备、符文、技能等级、模式开关。
3. `mapping_error`：Web/Server 字段是否映射错、单位错或取整口径错。
4. `bundle_error`：发布快照是否过期，bundle adapter 是否丢字段。
5. `wasm_error`：确认输入和 expected 都正确后，再排查 Wasm 公式、属性读取、资源读取或 runtime 顺序。

报告必须同时输出：

1. 哪些字段 `match`。
2. 哪些字段 `diff`。
3. 哪些字段缺 expected 或 actual。
4. 初步归因建议。
5. 保留 case 输入和 actual 输出引用，方便复跑。

## 9. 输出格式

Markdown 报告用于人工阅读和测试记录归档。至少包含：

1. 测试命令、时间、bundleHash、wasmBuild。
2. case 总览表。
3. 每个 case 的配置快照。
4. 字段级 expected vs actual 表。
5. diff 摘要和初步归因。
6. 结论：`pass`、`fail` 或 `blocked`。

JSON 报告用于后续自动汇总，结构保持第 5 节的 `IntegrationValidationReport`。

建议输出目录由实现阶段再定，但应避免写入源码目录；优先考虑 `web/test-results/validation/` 或等价 ignored 目录。

## 10. 前端与测试实现边界

推荐写入范围：

1. `web/src/engine/tinygoV2Bridge.ts`：复用现有 TinyGo V2 bridge，不新建 loader。
2. `web/src/engine/tinygoV2BundleAdapter.ts`：只在缺少测试输入投影时最小补充。
3. `web/src/validation-report/`：新增报告类型、fixture 读取、diff、Markdown/JSON 输出工具。
4. `web/scripts/` 或后续测试目录：新增集成测试 runner。

当前 `web/package.json` 还没有 test 脚本。实现阶段需要先选择最小测试运行方式，再补脚本，例如 `npm run test:validation`。

实现约束：

1. 不把本机 OCR 工具路径硬编码进前端业务源码。
2. 不让集成测试直接依赖 OCR 运行成功；OCR 只更新 baseline fixture。
3. 不把 candidate case 当作 gate 通过标准。
4. 不把测试报告做成普通用户功能。

## 11. 验证命令

只改文档无需构建。实现代码后，至少执行：

```powershell
cd C:\project\damage_web_dev\web
npm run build
npm run test:validation
```

`test:validation` 的通过标准：

1. 能加载至少 1 个 `golden` case。
2. 能跑 Web adapter -> Wasm。
3. 能生成 Markdown 和 JSON 报告。
4. `golden` case 的主字段无未解释 diff。

## 12. 非目标

1. 不实现自动进入游戏、自动截图或自动采集训练营数据。
2. 不要求 OCR 覆盖高级属性面板、技能 tooltip 和所有资源条后才推进 M1。
3. 不把报告系统扩展成完整测试管理平台。
4. 不覆盖全量英雄、装备、符文和技能。
5. 不让普通用户在页面上维护测试报告。
