# Admin Pages AGENTS.md

## 适用范围

本文件适用于 `web/src/pages/admin/**`，包括属性、角色、装备、技能分类、伤害类型、技能、状态和游戏配置管理页。

## 默认读写边界

1. 默认可写：`web/src/pages/admin/**`。
2. 改服务契约前先读对应 `web/src/services/*Client.ts` 与 `web/src/types/api.ts`。
3. 改路由入口、菜单或 hash segment 时同步检查 `web/src/App.tsx` 与 `web/src/config/navigation.ts`。

## 关键入口

1. `attributes/AttributeManagementPage.tsx`：属性管理（`#/attributes`）。
2. `characters/CharacterManagementPage.tsx`：角色管理（`#/characters`）。
3. `equipment/EquipmentManagementPage.tsx`：装备管理（`#/equipment`）。
4. `skill-categories/SkillCategoryManagementPage.tsx`：技能分类管理（`#/skill-categories`）。
5. `damage-types/DamageTypeManagementPage.tsx`：伤害类型管理（`#/damage-types`）。
6. `skills/SkillManagementPage.tsx`：技能管理（`#/skills`，含参数、公式、效果、过程、内部状态与生命周期）。
7. `statuses/StatusManagementPage.tsx`：状态管理（`#/statuses`）。
8. `game-settings/GameSettingsPage.tsx`：游戏配置（`#/game-settings`）。

## 路由约定

1. 当前管理页使用静态 Hash：`#/attributes`、`#/characters`、`#/equipment`、`#/skill-categories`、`#/damage-types`、`#/skills`、`#/statuses`、`#/game-settings`。
2. 根地址、空 Hash 和未知旧 Hash 由 `App.tsx` 落到 `#/attributes`。
3. 不要恢复旧实体、Provider、Ability、Effect Sequence、Effect Step、combat-data 分表页或旧发布入口。

## 最小验证

1. 开发中先验证受影响表单；功能收尾按 `web/AGENTS.md` 完成完整检查，包含 `npm run build`（在 `web/` 执行）。
2. 改页面行为时，对受影响的当前管理 Hash 做浏览器 smoke。
3. 当前页面不得请求 `/combat-data/**`、`versions/current` 或旧发布接口。

## 常见陷阱

1. 不要把当前技能管理与已删除的旧 Ability/Effect Step 页面混用。
2. 每次写入只走当前业务客户端；不要引入旧 combat-data PUT。
3. 旧 hero/item/skill 双读页面已删除，不要恢复隐藏入口。
