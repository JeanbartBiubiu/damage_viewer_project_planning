TASK_KEY: planning-validation-milestones
DOC_TYPE: 测试记录
WORKSTREAM: planning
STATUS: partial
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-06-18

# V2 Batch V 装备 Tooltip OCR 与 Seed 候选测试记录

## 范围

- 数据来源：`C:\project\ocr_data\装备数据\Screen37.png` 到 `Screen44.png`。
- OCR 工具：`C:\project\ocr_tools`，profile `configs/equipment_tooltip_2560x1440.json`。
- 本记录只处理 OCR/manual extract 到 wasm 可追踪 seed candidate，不修改 TinyGo runtime、Web、Backend。

## 产物

- OCR 证据：`文档记录/测试记录/wasm/artifacts/V2-BatchV-equipment-tooltip-ocr-extracted-20260618.json`
- Seed candidates：`最小验证/V2-BatchV-equipment-tooltip-passive-candidates.seed.json`
- OCR 原始输出：`C:\project\ocr_tools\out\equipment_tooltip_ocr_20260617.json`（ocr_tools/out 忽略，不作为 wasm 仓真源）。

## 提取结果

| 截图 | 装备 | 处理状态 | single_attacker_dps 编码 | 未模拟/阻塞 |
| --- | --- | --- | --- | --- |
| Screen37 | 纳什之牙 3115 | runtime-ready candidate | on-hit magic: `15 + 0.15 * ap` | 无 |
| Screen38 | 巫妖之祸 3100 | runtime-ready candidate | spellblade next attack: `0.75 * base ad + 0.45 * ap` split into two same-source magic operations | next-attack 50% attack speed |
| Screen39/40 | 夺萃之镰 3508 | runtime-ready damage candidate | spellblade next attack physical: `1.0 * resolved ad`; Screen40 confirms `+50/+25` dynamic tooltip | mana restore |
| Screen41 | 斯塔缇克电刃 3087 | runtime-ready candidate | energized primary target: 60 magic, charge gain 34 per basic attack | bounce targets, minion/monster 90, 4-7 scaling icon |
| Screen42 | 破舰者 3181 | runtime-ready candidate | every 5th attack: `0.84 * base ad + 0.035 * hp` physical | building damage, minion aura; ranged tooltip only |
| Screen43 | 巨型九头蛇 3748 | partial runtime-ready candidate | primary target on-hit: `0.005 * hp` physical | behind-target cleave, active Gash; ranged tooltip only |
| Screen44 | 多米尼克领主的致意 3036 | blocked/data-policy | stats only, no skillRef in candidate seed | Giant Slayer needs target bonus health input/attr policy |

## 验证

- `node -e "JSON.parse(require('fs').readFileSync(...))"`：OCR 证据 JSON 与 seed candidate JSON 均可解析。
- `C:\project\damage_web_dev\web` 执行 `npm run build`：通过，覆盖当前 Batch V 模板/录入辅助前端代码的 TypeScript 与 Vite 生产构建。
- Browser smoke（临时 Vite `127.0.0.1:5176` + 只读 mock API `127.0.0.1:18083`）：通过。证据见 `C:\project\damage_web_dev\output\playwright\batch-v-template-smoke-proof-20260618.json`。
  - Skills 新增 modal：`新增 passive` 可插入 `draft_item_on_hit_damage`，观察到 `ownerRole=attacker`、`trigger.event=on_basic_attack_hit`、`operation kind=damage`，并提示 `amount=0` 为草稿值。
  - Items 新增 modal：填写 `itemId=9999` 后，`从 DPS 模板创建 item-owned skill` 生成 `9999_on_hit_damage` 与 `9999 · 攻击方 · 普攻命中伤害` 草稿，创建按钮可用；未提交保存请求。
  - 截图保存失败：Browser CDP `Page.captureScreenshot` 超时；本轮保留 JSON proof 和 DOM 观察结果。
- 本轮未运行 `go test`，因为没有改 TinyGo runtime 代码；seed candidate 的运行时语义依据现有 `DPSPassiveOperationV2`/dispatcher 支持边界做了只读核对。
- 需要后续导入/发布闭环时，再跑 backend publish/preflight、真实后端 Admin 保存、Wasm page smoke 和发布后 bundle 检查。

## 后续动作

1. 将 runtime-ready candidates 导入后台/发布测试 bundle。
2. 对 3036 补目标额外生命值输入契约，再决定是否做 `damage_modifier` seed。
3. 对 3181/3748 如需近战值，补近战 tooltip 截图或权威数据源。
