TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-06-05

# V2 Batch M Wasm 属性读取语义与三相基础 AD 修正计划

关联概要：[验证里程碑V2.md](../../概要设计/验证里程碑V2.md)

关联总方案：[V2-单攻击方DPS协议与开发计划.md](./V2-单攻击方DPS协议与开发计划.md)

前置机制：[V2-BatchL-单攻击方DPS咒刃下一次普攻状态计划.md](./V2-BatchL-单攻击方DPS咒刃下一次普攻状态计划.md)

## 1. 本文档边界

本文档是后续跨 worktree 开发会话的执行真源，不是测试记录。当前会话只维护本文和任务治理映射；不得在本文档编写会话里新增 runtime、backend、web、seed 或 DB 数据改动。

Batch M 的顺序固定为：先补齐 `single_attacker_dps` 的属性读取语义，再处理三相之力咒刃公式。不能为了三相的 `2 * base AD` 直接把 `base_ad` 当成长期机制特例。

本批只解决“公式读取哪个属性视图”的问题，不扩展主动技能轮转、不改变 Batch L 的 next-attack state 语义。

## 2. 当前事实

1. 通用 TinyGo V2 runtime 已有属性 `base/current/max/resolved` 模型。
2. 通用 formula 层已支持 `attrRead`，默认读取 `resolved`，也可以读取 `base/current/max`。
3. `single_attacker_dps` 专用路径当前没有沿用上述读取语义；`DPSPassiveOperationV2.attackerAttr` 只按 flat key 从 `state.attrs` 读取数值。
4. DPS runtime 的 `baseAttrs` 是“装备、常驻 modifier、叠层 modifier 重算起点”，不是 LoL 语义里的 champion base AD。
5. 当前 Web DPS adapter 构造攻击方快照时，`attackerSnapshot.attributes` 已经是英雄等级属性加符文/调整后的 flat map；装备属性在 `equipmentStats` 中单独传给 Wasm，再由 Wasm 合并到同一个 `ad`。
6. 当前 live bundle 中英雄字段没有 `base_ad`；Vayne 示例是 `baseStats.ad=60`、`statsByLevel.ad=[...]`，装备 `3078` 又提供 `ad +36`。
7. 当前 Batch L seed 把三相咒刃写成 `attackerAttr: "ad", attackerAttrRatio: 2.0`，因此运行时会读到英雄等级 AD 加装备 AD，而不是 base AD。
8. Batch L 计划中已经写明：如果真实咒刃公式要求 `base_ad`，而当前 web/wasm 投影只稳定提供 `ad`，必须补齐属性投影和测试，不能用总 AD 近似。

## 3. 目标

Batch M 分成五个连续 gate：

| Gate | 目标 | 可单独通过 |
| --- | --- | --- |
| `M-contract-pass` | 固定 DPS 属性读取 contract，明确 `base/current/max/resolved` 与总值口径 | 是 |
| `M-wasm-pass` | Wasm DPS passive damage 支持按 `attackerAttrRead` 读取属性视图，默认兼容旧数据 | 是 |
| `M-web-pass` | Web adapter 在 `resolvedSnapshot` 中投影可审计的属性视图，不只传 flat `attributes` | 否，依赖 `M-contract-pass` |
| `M-trinity-data-pass` | 三相之力咒刃从总 AD 修正为基础 AD 读取，并经 seed/import/publish 保留 | 否，依赖 `M-wasm-pass` 和 `M-web-pass` |
| `M-live-pass` | 页面 published bundle 跑通三相曲线，导出 JSON 能证明基础 AD 没被装备 AD 污染 | 否，依赖前三项 |

如果属性读取语义闭环但三相 seed 或 live page 失败，只能报告 `M-wasm-pass` / `M-web-pass`，不能宣称 Batch M 完成。

## 4. 非目标

1. 不实现主动技能轮转、施法调度、action queue editor 或完整 rotation DSL。
2. 不改变 Batch L 的 `next_basic_attack_after_state` 触发和消费规则。
3. 不把 `base_ad` 写死成 Wasm 内建特例。
4. 不要求一次支持所有 target 属性读取；本批先覆盖当前 DPS 被动 damage 的 `attackerAttr`。
5. 不实现 `bonus_ad` 完整机制，除非作为小范围派生读值并有明确测试；本批最低完成 `base` 和 `resolved`。
6. 不把 Web 或 backend 作为 DPS 伤害结算来源；读取语义和伤害结果仍必须来自 Wasm。
7. 不直接手改 live DB 作为最终交付；live DB 可以用于只读核对或通过既有 import/publish 流程发布。

## 5. Contract 设计

### 5.1 读取视图

DPS 属性读取视图沿用通用 runtime 的命名：

| JSON 值 | 含义 | 备注 |
| --- | --- | --- |
| `resolved` | 当前事件时刻的结算总值 | 默认值；兼容现有 `attackerAttr` 行为 |
| `base` | 英雄等级后的自然基础属性，不含装备、符文、scenario、叠层和 runtime modifier | 三相咒刃应使用该视图 |
| `current` | 属性 current 槽位 | DPS scalar 属性可暂时等同 `resolved`，但输入有明确 current 时应读取 current |
| `max` | 属性 max 槽位 | 主要为 HP/资源类属性预留 |

页面文案可以显示“总值”，但 Wasm JSON 优先使用 `resolved`；如需接受 `total`，只能作为 `resolved` 的兼容 alias，并必须在输出证据中归一为 `resolved`。

### 5.2 Operation 字段

为 `DPSPassiveOperationV2` 增加字段：

```json
{
  "kind": "damage",
  "source": "trinity_force_spellblade",
  "damageType": "physical",
  "attackerAttr": "ad",
  "attackerAttrRead": "base",
  "attackerAttrRatio": 2.0
}
```

规则：

1. `attackerAttrRead` 为空时等价于 `resolved`，保持旧 seed 和旧 bundle 行为。
2. `attackerAttrRead=resolved` 继续从当前 runtime `state.attrs[attr]` 读取，必须包含装备、符文、scenario modifier、叠层 modifier 等当前总值。
3. `attackerAttrRead=base` 必须从独立属性视图读取；不得从 `state.baseAttrs` 推断，因为 `baseAttrs` 当前不是 LoL base 属性。
4. 如果 operation 明确请求 `base/current/max`，但输入没有对应视图或值非法，curve 必须 `blocked`，不能回退到 `resolved`。
5. `effectBreakdown` 必须记录实际读取视图，例如 `attackerAttr=ad`、`attackerAttrRead=base`、`attrValue=60`。

### 5.3 DPS 输入快照字段

为 `DPSActorSnapshotV2` 增加可选属性视图字段，保留现有 flat `attributes`：

```json
{
  "attributes": {
    "ad": 96
  },
  "attributeViews": {
    "ad": {
      "base": 60,
      "current": 96,
      "max": 96,
      "resolved": 96
    }
  }
}
```

兼容规则：

1. `attributes` 仍是当前 resolved flat map，是现有 attack speed、damage、armor penetration 等逻辑的默认来源。
2. `attributeViews` 缺失时，旧输入仍可运行，但只能安全读取 `resolved`。
3. `attributeViews[attr].base` 缺失时，任何显式 `attackerAttrRead=base` 的 operation 必须 blocked。
4. Wasm 合并 `equipmentStats` 时，只能更新 `attributes` / resolved 总值，不能污染 `attributeViews[attr].base`。
5. Wasm 应在输出 `resolvedSnapshot.attackerSnapshot.attributeViews` 中保留最终可审计视图，便于 Playwright 导出复核。

## 6. Web 投影规则

Web adapter 负责把 published bundle 投影成 Wasm 可读的属性视图：

1. `base` 来源：`resolveHeroStatsAtLevel(hero, level)` 的自然英雄等级属性，不含 `runeStatAdjustments`、装备、scenario modifier。
2. `resolved` 初始来源：自然英雄等级属性加 `runeStatAdjustments`，装备继续通过 `equipmentStats` 单独传入，让 Wasm 统一合并并输出最终 resolved。
3. `current`：首期 scalar 属性可等于初始 resolved；如果后续有明确 current/max 语义，按 published bundle 或 run input 的 current 值填充。
4. `max`：首期 scalar 属性可等于初始 resolved；HP 等属性按已有 `maxHp` 或 attr max 口径填充。
5. 对 `ad` 的三相场景，导出 JSON 必须能看到 `attributeViews.ad.base` 等于英雄等级自然 AD，且不受 `3078` 的 `ad +36` 影响。

Web 不得根据三相公式自行扣除装备 AD，也不得在页面层重算咒刃伤害。

## 7. Wasm Runtime 规则

### 7.1 读取 helper

新增 DPS 内部读取 helper，统一处理 passive damage 的攻击者属性读取：

1. 输入：`op.AttackerAttr`、`op.AttackerAttrRead`、当前 `state.attrs`、当前 `state.attacker.AttributeViews`。
2. 默认 `attackerAttrRead=resolved`。
3. `resolved` 从 `state.attrs` 读取，保持动态 modifier 后的当前总值。
4. `base/current/max` 从 `attributeViews` 读取。
5. 值缺失、NaN、Inf 或 unsupported read kind 时，调用 `state.block(...)` 并停止当前 curve。

### 7.2 动态 modifier

1. `refreshActiveStatModifiers` 继续只更新 `state.attrs`。
2. stack、scenario、always-on modifier 不得修改 `attributeViews[attr].base`。
3. 如果后续需要 `current/max` 参与动态变化，必须另开 gate，把 DPS flat map 迁移到通用 attribute.Store 或明确更新规则；本批不做隐式迁移。

### 7.3 输出证据

每次使用 `attackerAttrRatio` 结算时，`effectBreakdown` 至少包含：

1. `attackerAttr`
2. `attackerAttrRead`
3. `attrValue`
4. `attackerAttrRatio`
5. `contribution`

现有 `damageTimeline` 和 `damageBySource` 保持最终伤害证据；`effectBreakdown` 用于解释读值口径。

## 8. 三相修正规则

三相之力咒刃真实公式按基础 AD 读取，Batch M 修正后 seed 应使用：

```json
{
  "kind": "damage",
  "source": "trinity_force_spellblade",
  "damageType": "physical",
  "attackerAttr": "ad",
  "attackerAttrRead": "base",
  "attackerAttrRatio": 2.0
}
```

处理顺序：

1. 先完成 `M-wasm-pass` 和 `M-web-pass`。
2. 再更新 Batch L/Bath M 对应 seed 和 audit，说明从 `ad resolved` 修正为 `ad base`。
3. 通过 backend dry-run/import/publish 发布新 versionCode，建议命名为 `v2_batch_m_attr_read_trinity_base_ad_001`。
4. live page 选择 `3078 / Trinity Force` 和 `item_3078_spellblade_ready` 后，导出 JSON 必须证明：
   - `equipmentStats.ad = 36`
   - `attributeViews.ad.base` 不包含 36
   - operation 为 `attackerAttr=ad, attackerAttrRead=base`
   - 咒刃 contribution 等于 `2 * attributeViews.ad.base`

禁止直接把 live DB 的三相 `attackerAttr` 改成 `base_ad` 后宣称完成；除非同时有完整 `base_ad` 属性投影、测试和发布证据，并明确它只是兼容投影而非 Wasm 长期语义。

## 9. 写入范围

后续开发会话允许写入：

| Worktree | 允许写入 |
| --- | --- |
| `C:\project\damage_wasm_dev` | `wasm/tinygo_engine_v2/internal/model/types.go`、`wasm/tinygo_engine_v2/internal/runtime/dps_driver.go`、`wasm/tinygo_engine_v2/internal/runtime/dps_driver_test.go`、必要的测试记录 |
| `C:\project\damage_web_dev` | `web/src/engine/tinygoV2DpsAdapter.ts`、`web/src/pages/WasmValidationV2DpsPage.tsx`、同步后的 `web/src/engine/wasm/tinygo_engine_v2.wasm` |
| `C:\project\damage_backend_dev` | `最小验证/V2-Batch-M-*.seed.json`、`最小验证/V2-Batch-M-*.audit.json`、必要的 import/publish 测试 |
| `C:\project\damage_viewer_project_planning` | 本计划、测试记录、任务治理映射 |

禁止写入：

1. 与 V2 DPS 无关的 admin 页面。
2. 完整 1v1 rotation 或主动技能调度入口。
3. 本机 datasource 凭据、密钥或临时服务日志。
4. `.codegraph/*.db*`、Playwright 临时截图以外的生成噪声。

## 10. 执行顺序

1. GPT/Codex 检查四个 worktree 的 `git status --short -uall`，确认已有脏改归属。
2. GPT/Codex 读取最近层 `AGENTS.md`、README 和本计划，收敛 Cursor prompt。
3. Cursor 先只实现 Wasm contract 和 tests，不改 web/backend/seed。
4. GPT/Codex review Cursor diff，运行 Wasm targeted tests、全量 Go tests 和 bench。
5. Cursor 或 GPT/Codex 按流程实现 Web attributeViews 投影和页面导出证据，不在页面层算伤害。
6. GPT/Codex build web，并用 Playwright 复核导出 JSON 中的 attributeViews。
7. 通过后再更新 backend seed/audit，把三相 operation 改为 `attackerAttrRead=base`。
8. backend dry-run/import/publish，通过 current bundle 验证新字段保留。
9. 同步 Wasm artifact 到 web，跑完整页面用户流。
10. 写测试记录，明确 `M-contract-pass`、`M-wasm-pass`、`M-web-pass`、`M-trinity-data-pass`、`M-live-pass` 状态。

## 11. 验证命令

### Wasm

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./internal/runtime -run "AttrRead|AttackerAttr|Spellblade|SingleAttackerDPS|Canonical" -count=1
go test ./...
go run ./cmd/bench
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
node .\scripts\smoke-node.mjs
```

必须新增或覆盖的测试：

1. `TestSingleAttackerDPSAttackerAttrReadDefaultsToResolved`
2. `TestSingleAttackerDPSAttackerAttrReadBaseIgnoresEquipmentStats`
3. `TestSingleAttackerDPSAttackerAttrReadBaseIgnoresRuntimeStatModifiers`
4. `TestSingleAttackerDPSAttackerAttrReadBaseBlocksWhenMissingView`
5. `TestSingleAttackerDPSAttackerAttrReadResolvedKeepsStackModifiers`
6. `TestSingleAttackerDPSTrinitySpellbladeUsesBaseAD`

### Web

```powershell
cd C:\project\damage_web_dev\web
npm run build
```

Playwright 至少验证：

1. `#/wasm-validation-v2-dps` 可运行 published bundle。
2. 选择 `3078 / Trinity Force` 和咒刃 ready scenario state。
3. 导出 JSON 包含 `attributeViews.ad.base`、`attributes.ad`、`equipmentStats.ad`。
4. 三相咒刃伤害 contribution 等于 `2 * attributeViews.ad.base`，而不是 `2 * attributes.ad`。
5. Batch H/K stacking-passive 和 phantom-hit 页面不回退。

### Backend

```powershell
cd C:\project\damage_backend_dev\server\data_manage
mvn test
mvn -q -DskipTests test-compile org.codehaus.mojo:exec-maven-plugin:3.5.0:java "-Dexec.classpathScope=test" "-Dexec.mainClass=xyz.game.datamanage.tools.KatarinaMvpImportMain" "-Dexec.args=--dryRun --seedFile=C:\project\damage_backend_dev\最小验证\V2-Batch-M-attr-read-trinity-base-ad.seed.json --versionCode=v2_batch_m_attr_read_trinity_base_ad_001 --gameId=lol"
```

发布后至少核对：

1. current version 为本批 versionCode。
2. bundle 中三相 skill 的 operation 保留 `attackerAttrRead=base`。
3. `3078` 的 `statModifiers` 仍保留 `ad +36`。
4. bundle 中没有把 `base_ad` 当成唯一公式真源的临时污染。

## 12. Cursor Prompt 模板

后续进入编码会话时，GPT/Codex 应先按实际代码状态修订本模板，再启动 Cursor。

```text
目标：实现 V2 single_attacker_dps 的属性读取视图语义。DPS passive damage 的 attackerAttrRatio 继续支持旧的 attackerAttr 行为，但新增 attackerAttrRead，默认 resolved，可显式读取 base/current/max。先只做 Wasm contract 和 runtime tests，不改 web/backend/seed。

允许写入范围：
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go

非目标：
- 不实现主动技能轮转、action queue editor、完整 1v1 rotation。
- 不改 web adapter、backend seed、published bundle 或 wasm artifact。
- 不把 base_ad 写成 Wasm 硬编码特例。
- 不改变 Batch L next_basic_attack_after_state 触发/消费语义。

实现要求：
- 为 DPS actor snapshot 增加可选 attributeViews，兼容旧输入。
- 为 DPS passive operation 增加 attackerAttrRead，默认 resolved。
- resolved 读取当前 state.attrs，继续包含装备和动态 modifier。
- base/current/max 从 attributeViews 读取；显式请求但缺失时 blocked。
- equipmentStats 合并不得污染 attributeViews.*.base。
- effectBreakdown 记录 attackerAttr、attackerAttrRead、attrValue、ratio、contribution。

验证命令：
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./internal/runtime -run "AttrRead|AttackerAttr|Spellblade|SingleAttackerDPS|Canonical" -count=1
go test ./...
go run ./cmd/bench

停止条件：
- 如果需要迁移整个 DPS driver 到通用 attribute.Store 才能表达语义，先停止并报告最小替代方案。
- 如果 attributeViews 会破坏现有 input/output DTO 兼容，先停止并给出兼容策略。
- 如果发现 current/max 语义无法在本批安全实现，先保留字段但只让 base/resolved 过测试，并明确 blocked 风险。
```

## 13. 完成标准

Batch M 完成必须同时满足：

1. Wasm runtime 支持 `attackerAttrRead`，旧数据默认 `resolved` 不回退。
2. Web 导出能证明 `base` 与 `resolved` 分离。
3. 三相 seed/published bundle 使用 `attackerAttrRead=base`，不是 `base_ad` 临时 key。
4. 三相页面结果证明装备 `ad +36` 没进入咒刃 `2 * base AD` contribution。
5. Batch H/K/L 相关页面和 tests 不回退。
6. backend/web/wasm 验证矩阵和 Playwright 全流程通过。
7. 测试记录写明 live DB target、current version、wasm hash、导出 JSON 证据和剩余人工确认项。

## 14. 残余风险

1. `current/max` 对 DPS scalar 属性的真实含义尚未完全落地，本批可先把它作为输入视图保留，重点验收 `base/resolved`。
2. 如果 Web 当前符文/属性调整混入 attackerSnapshot 太早，必须重构投影顺序，否则 `base` 会被 runeStatAdjustments 污染。
3. 如果 future 机制需要 `bonus_ad`，应在本 contract 之后新增派生读取语义，不能让三相修正顺手实现半套 bonus。
4. 后端目前大多透传 `mechanicsConfig`，能保留新字段不代表语义正确；语义正确性必须由 Wasm tests 和 live page 导出证明。
5. 如果 live page 仍加载 stale wasm 或 stale current bundle，可能误判三相结果；必须做 hash/current version/freshness 证明。
