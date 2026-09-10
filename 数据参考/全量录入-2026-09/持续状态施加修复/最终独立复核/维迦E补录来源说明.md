# 维迦 E 补录来源与处理说明

## 冻结候选与取消记录

历史候选位于：

- `C:\project\damage_web_dev\数据参考\全量录入-2026-09\交叉试录\Cursor\英雄机制第四批\未保存候选\录入候选.json:7439-7692`
- `C:\project\damage_web_dev\数据参考\全量录入-2026-09\交叉试录\Cursor\英雄机制第四批\未保存候选\维迦E页面试录.json`
- 取消说明：`C:\project\damage_web_dev\数据参考\全量录入-2026-09\交叉试录\Cursor\英雄机制第四批\维迦E页面未保存.json`

候选技能为 `veigar_e`、中文名“扭曲空间”、最大等级 5，角色根为 `Characters/Veigar/CharacterRecords/Root`，技能对象为 `Characters/Veigar/Spells/VeigarEventHorizonAbility/VeigarEventHorizon`。取消记录确认当时没有保存效果和规则，效果、规则 GET 均为 404。

## 原始固定版本来源

- 客户端原文：`C:\project\damage_viewer_project_planning\数据参考\全量录入-2026-09\技能公共参数实录\客户端原文\Veigar.json.gz`，固定客户端 16.17，解压内容 SHA-256 `2dbb6f22563ef94b230e24af998836e95d883bb7fd6d39e4f5cc273ad371af78`，压缩文件 SHA-256 `0bc627d047d3df570c00af13e5f2ff4b09ae7f5ab032672176d54efddd2165dc`；源对象路径为 `Characters/Veigar/Spells/VeigarEventHorizonAbility/VeigarEventHorizon`。
- 官方中文：`C:\project\damage_viewer_project_planning\数据参考\全量录入-2026-09\英雄\原始资料\zh_CN\champion\Veigar.json`，固定 16.17.1，SHA-256 `592296562a5b3760026265f64745ab952766be3bab7c3d01172e6d8ac1d1a0de`；对象为 `data.Veigar.spells[2]`。
- 候选中保存的来源与哈希汇总：`C:\project\damage_web_dev\数据参考\全量录入-2026-09\交叉试录\Cursor\英雄机制第四批\来源冻结\来源与哈希汇总.json`。
- 当前根绑定和字段展开：`C:\project\damage_web_dev\数据参考\全量录入-2026-09\交叉试录\Cursor\英雄机制第四批\根绑定与数值证据.json`、`来源冻结\主技能数值展开.json`。

## 六个参数及消费者

| 参数 | 精确候选值 | 原始来源 | 当前候选消费者 |
| --- | --- | --- | --- |
| `cooldown_ms` | 等级 1..5：`20000/18500/17000/15500/14000` | 官方 `cooldown`；客户端 `mSpell.cooldownTime` 索引 1..5；单位秒转毫秒 | `cast.cooldown.durationValue` |
| `mana_cost` | 等级 1..5：`70/75/80/85/90` | 官方 `cost`；客户端 `mSpell.manaValues.values` 索引 0..4 | `mana_cost` 效果的 `RESOURCE_CHANGE` 消耗值 |
| `cast_time_ms` | 固定 `250` | 客户端 `mSpell.spellCastTime = 0.25` 秒；`mCastTime` 为 null，不能使用 null 覆盖明确的 `spellCastTime` | `cast_time` 延迟步骤 |
| `stun_duration_ms` | 等级 1..5：`1500/1750/2000/2250/2500` | 客户端 `DataValues[name=StunDuration]` 原值 `1.5/1.75/2/2.25/2.5` 秒；官方 E tooltip 的 `stunduration` | 父效果 `event_horizon_stun.lifecycle.durationValue` |
| `cage_delay_ms` | 固定 `500` | 客户端 `DataValues[name=CageDelay]` 原值各级 `0.5` 秒 | 历史候选只列参数，当前候选没有合法消费者，不自动接到施法或命中 |
| `cage_duration_ms` | 固定 `3000` | 官方 E tooltip“牢笼持续3秒”；客户端 `Spell_VeigarEventHorizon_Tooltip` 同文 | 历史候选只列参数，当前候选没有合法消费者，不自动接到父状态寿命 |

前四个消费者在历史候选中有明确结构；`cage_delay_ms` 和 `cage_duration_ms` 只有数值来源，没有当前管理组成的消费者。候选清单保留它们作为待接字段，但不声称已接入运行时牢笼生成或持续搜索。

## 应补录的效果与规则

### 父效果 `event_horizon_stun`

历史候选的父生命周期完整取值为：

```json
{
  "durationValue": { "kind": "PARAMETER", "parameterKey": "stun_duration_ms" },
  "maxStacksValue": { "kind": "FIXED", "value": 1 },
  "applicationStacksValue": { "kind": "FIXED", "value": 1 },
  "instanceScope": "SOURCE_TARGET",
  "reapplicationStackMode": "KEEP",
  "reapplicationDurationMode": "REFRESH_ALL",
  "expiryMode": "ALL_AT_ONCE",
  "periodicIntervalValue": null,
  "firstPeriodicExecution": null
}
```

效果名称“碰到牢笼边缘眩晕”、排序 20；结果 `stun` 为 `STATUS_OPERATION`、`target = TARGET`、明细 `statusKey = vertigo`、`operation = APPLY`，结果生命周期为 `PERSISTENT`，`valueReadMode`、`stackValueMode`、`reapplicationValueMode`、`periodicExecutionMode` 均为 null。当前共享契约要求该结果的法术护盾粒度填 `RESULT` 或 null；历史候选中的 `EFFECT` 是旧阻塞值，不能原样补录。

### 触发规则 `actual_cage_contact`

历史候选的结构是 `eventType = SKILL_HIT`、`detail.sourceSkillKey = veigar_e`，动作 `EXECUTE_EFFECT` 指向 `event_horizon_stun`，`targetContext = CURRENT_TARGET`，`perTargetCooldown = null`，`maxTriggersPerProcess = null`，没有条件组和运行时输入绑定。该结构来源为上述未保存候选文件；“真实牢笼边缘接触”事件是否由运行时产生、是否需要更窄的阶段字段，候选和当前固定源均未证明，仍需待配，不能把普通技能命中或施法结束自动接线成该规则。

当前状态标识 `vertigo` 的管理目录证据见 `C:\project\damage_web_dev\.agents\artifacts\persistent-status-live-20260910\重启后只读快照.json` 的 `/statuses` GET；该快照只证明名称、启用状态和标识，不证明眩晕的行动限制执行语义。

## 补录边界

补录只包含上述参数依赖、父效果和待核触发规则的候选形状；不新增公式，不把 `cage_delay_ms` 或 `cage_duration_ms` 接到未知运行时消费者，不以状态名删除代替来源实例结束，也不把空间路径、多对象搜索或战斗执行写成已完成。
