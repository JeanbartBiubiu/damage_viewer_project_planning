# Admin Pages AGENTS.md

本文件适用于 `web/src/pages/admin/**`，包括属性、角色、装备、技能分类、伤害类型、技能、状态、修正区域、图片和游戏配置页。

## 修改边界

- 默认只写当前页面目录。改服务契约前读对应 `web/src/services/*Client.ts` 和 `web/src/types/api.ts`。
- 改路由、菜单或 Hash 时同步检查 `web/src/App.tsx` 与 `web/src/config/navigation.ts`；导航配置是当前页面集合的真源。
- 每次写入只走现行业务客户端。不得恢复旧实体、Provider、Ability、Effect Sequence、Effect Step、combat-data 分表页或旧发布入口。

## 验证

先验证受影响表单和服务交互，再按 `web/AGENTS.md` 完成前端检查。页面行为变化必须对受影响 Hash 做真实浏览器验证，并确认没有请求 `/combat-data/**`、`versions/current` 或旧发布接口。
