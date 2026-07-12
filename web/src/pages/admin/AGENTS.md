# Admin Pages AGENTS.md

## 适用范围

本文件适用于 `web/src/pages/admin/**`，包括 combat-data 分表编辑页、发布辅助组件和 Admin 导航。

## 默认读写边界

1. 默认可写：`web/src/pages/admin/**`。
2. 改服务契约前先读 `web/src/services/combatDataClient.ts` 与 `web/src/types/combatData.ts`。
3. 改路由入口、菜单或 hash segment 时同步检查 `web/src/App.tsx`、`web/src/config/navigation.ts` 与 `combatDataNav.ts`。

## 关键入口

1. `combatDataNav.ts`：按依赖域分组的资源导航与 `#/combat-data/<id>` hash 解析。
2. `combat-data/CombatDataPage.tsx`：单资源页壳（revision 状态 + API 基址提示 + 同组相邻链接）。
3. `combat-data/resourceRegistry.ts`：资源字段、list/put、依赖顺序。
4. `combat-data/CombatDataResourcePage.tsx`：复用的表格与写入表单（含 effect-step）。
5. `combat-data/EffectStepEditor.tsx`：effect-step 九选一 detail 编辑。
6. `usePublishFlow.ts`、`AdminPublishRail.tsx`：发布辅助链路（不读 Bundle/Catalog）。

## 路由约定

1. 每个 `COMBAT_DATA_RESOURCE_LIST` 资源对应 `#/combat-data/<resource-id>`。
2. `#/combat-data` 仅重定向到首个资源，不渲染汇总 Tabs 编辑器。
3. 双层 Tabs 的 `CombatDataWorkbenchPage` 已退役；不要再把全部表塞回单页。

## 最小验证

1. 改 Admin 代码后至少运行 `cd web; npm run build`。
2. 改页面行为时，对若干 combat-data 资源 hash（如 `entities`、`effect-steps`）与版本发布做浏览器 smoke。
3. type-relations 仅允许新模型 10 类 targetCategory，不要暴露 legacy `equipment/skill/character`。

## 常见陷阱

1. Admin 无 combat-data GET；列表走 Public GET。
2. 每次 PUT 只写一个稳定 ID 资源；不提供 DELETE/batch。
3. 区分“后端基础约束”与“当前 Wasm 能力校验”。
4. 旧 hero/item/skill 页面已删除，不要恢复隐藏入口。
5. state/list 的 404 在 games 已通时要用 `formatCombatDataError(..., 'contract-entry')`，不要只展示泛化 Resource not found。
