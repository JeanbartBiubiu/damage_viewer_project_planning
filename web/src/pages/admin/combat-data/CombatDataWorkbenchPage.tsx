/**
 * Dual-Tabs「战斗数据工作台」已退役。
 * 入口改为 `#/combat-data/<resource-id>` + {@link CombatDataPage}。
 * 保留此文件仅避免旧 import 路径瞬间断裂；请改用 CombatDataPage。
 */
export { CombatDataPage } from './CombatDataPage';
