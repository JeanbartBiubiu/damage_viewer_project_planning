TASK_KEY: server-wasm-db-gap
DOC_TYPE: 详细设计
WORKSTREAM: server
STATUS: active
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-11

# Wasm Legacy ADC Bootstrap Adapter 详细设计

关联：[Wasm Canonical Catalog 后端详细设计](WasmCanonicalCatalog后端详细设计.md)。本切片把既有发布 Bundle 的 6 个 ADC 和 3 个训练假人转换为第一份可发布的 `WasmCatalogSourceV1` 草稿；它不把旧 DPS 机制冒充为通用 Wasm 机制。

## 1. 范围与非目标

固定英雄：`hero_vayne`、`hero_teemo`、`hero_varus`、`hero_kaisa`、`hero_twitch`、`hero_kogmaw`。

固定假人：`target_dummy_squishy`、`target_dummy_fighter`、`target_dummy_tank`。

输入只能是已发布的 `published_bundle_snapshots`，由调用方显式提交 `sourceVersionCode`。不读取 `__workspace__`，因此相同 snapshot 会得到同样的 Catalog source。转换成功只写编辑态 `wasm_catalog_sources`，不自动发布、不切换 current version。

本切片不做以下事情：

1. 不转换 legacy `mechanicsConfig.dpsPassiveEffects`、`dpsScenarioStates`、`skillMounts` 为 generic provider/ability/listener。
2. 不导入装备、公式、状态、type relation 的全量旧语义。
3. 不覆盖已有 Catalog source；已有 source 必须使用现有 `PUT` 明确编辑。

`unmappedLegacySkillIds` 的取值是 selected snapshot 中同时满足 `ownerType="hero"`、`ownerId` 属于固定 6 ADC 的 `skills[].skillId`：去重后按字典序升序输出。它不包含默认普攻或 item-owned skill。不同 legacy snapshot 的数量可以不同：Batch-B fixture 是 11 条，当前开发库的 current snapshot 是 13 条；实现和断言不得把任一数量硬编码为跨版本事实。它们必须出现在 bootstrap 响应，而不是被静默丢弃或写进 `sharedProviders`。

## 2. Admin 契约

新增：

```text
POST /api/admin/games/{gameId}/wasm-catalog-source:bootstrap-legacy-adc
```

请求：

```json
{ "sourceVersionCode": "v2_batch_b_hero_passives_002" }
```

规则：

1. `sourceVersionCode` 必填且只能引用该 game 已发布的 legacy Bundle snapshot；没有 snapshot 返回 `404.NOT_FOUND`。
2. 只允许 `gameId=lol`；其余 game 返回 `422.SEMANTIC_ERROR`，避免把 LoL 固定 ID 误用于其他游戏。
3. snapshot 必须包含全部 6 ADC 与 3 假人；缺任一实体返回 `422.SEMANTIC_ERROR`，不写入 source。
4. 若已有 source，返回 `409.CONFLICT`，不做覆盖。
5. 成功调用已有 source 全量校验和“仅插入”写入；并发第二次调用必须同样返回 `409.CONFLICT`。
6. bootstrap 禁止调用 `publishVersion`、禁止切换 current version、禁止写入 `published_wasm_catalog_snapshots`，也禁止驱逐 `wasmCatalog` 或其他 Public read cache。
7. 成功后记录 Admin edit log，响应 200。

响应：

```ts
type LegacyAdcBootstrapResponse = {
  source: WasmCatalogSourceResponse
  importReport: {
    sourceVersionCode: string
    importedHeroIds: string[]
    importedDummyIds: string[]
    templateKeys: string[]
    unmappedLegacySkillIds: string[]
  }
}
```

`importReport` 仅是本次导入审计信息，不能混入 `WasmCatalogSourceV1`，也不参与 hash。

## 3. 映射规则

Adapter 是纯函数边界：输入 `legacyBundle + sourceVersionCode`，输出 `source + importReport`；数据库读写、鉴权和 Admin 日志由外层 service/controller 负责。

| Legacy 字段 | Canonical 输出 | 规则 |
| --- | --- | --- |
| `heroes[].heroId` | `templateKey` | ADC 为 `champion:<去掉 hero_ 前缀的 id>`；假人为 `training_dummy:<去掉 target_dummy_ 前缀的 id>` |
| `heroes[].name` | `displayName` | 原样复制 |
| `heroes[].baseStats` 数字字段 | `attributes[key]` | 每个槽写 `{base,current,max,resolved}`，四个值均为 base 数值 |
| `baseStats.mana` / `baseStats.energy` | `resources.mana` / `resources.energy` | 写 `{current: base, max: base}`；这两个键不再同时出现在 attributes，负数或非有限值拒绝转换 |
| ADC / 假人身份 | `typeCatalog` + `template.types/tags` | 见下方固定字面量；无 relation |
| legacy skill | `importReport.unmappedLegacySkillIds` | 不写 providers，不伪造 generic 行为 |

所有 templates 的 `providers=[]`、`sharedProviders=[]`、`formulas=[]`；顶层四个 `rules` 数组必须为空，`settings={}`。`typeCatalog.types` 固定为、且按此顺序输出：

```json
[
  { "key": "role/marksman", "domain": "role" },
  { "key": "role/training_dummy", "domain": "role" }
]
```

不写 `group`，`relations=[]`。每个 ADC template 固定 `types=["role/marksman"]`、`tags=["legacy-bootstrap","legacy-adc"]`；每个假人 template 固定 `types=["role/training_dummy"]`、`tags=["legacy-bootstrap","training-dummy"]`。template 输出顺序固定为本节列出的 6 ADC、再列出的 3 假人顺序；同一 source snapshot 的 `rulesHash` 因而稳定。这样 source 能通过 P0 validator，并准确表示当前只迁移了实体基础数值层。

## 4. 实现边界

允许写入：

1. `WasmLegacyAdcBootstrapAdapter`：纯 JSON 映射、固定实体集、缺失/重复/非数值检查与 import report。
2. `GameDataService` / `PostgresWriteStore`：读取指定 published Bundle、validate source、原子 insert-if-absent。
3. `WasmCatalogSourcesMapper` 及 XML：新增 `insertSourceIfAbsent`，用 `ON CONFLICT (game_id) DO NOTHING` 保证不覆盖。
4. `WasmCatalogSourceAdminController`：新增 POST 路由和 edit log。
5. 后端单测、接口定义与本详细设计。

不可修改：旧 Bundle DTO、legacy 表数据、legacy `/bundle`、发布 API 语义、Wasm runtime、Web materializer。

## 5. 验证

至少覆盖：

1. 给定 fixture 中 6 ADC + 3 假人，生成 9 个 template，属性和 mana/energy 映射正确。
2. fixture 所定义的精确 legacy skill ID 集合按字典序出现在 report；source 不含 legacy `skillMounts`、`mechanicsConfig` 或 provider 伪转换，`sharedProviders/formulas/template.providers` 均为空，且 `mana` 只位于 resources。
3. 缺一个英雄、非数字 base stat、snapshot 不存在、非 LoL game、已有 source 和并发/重复插入均失败且不改 source。
4. `mvn test`、`mvn package -DskipTests`、`git diff --check`。
5. 受控开发库：POST 生成草稿后 GET source 返回 9 templates；同一 `sourceVersionCode` 的 public Catalog 仍为 404，`published_wasm_catalog_snapshots` 没有新增行。发布由用户或后续显式版本发布动作触发。
