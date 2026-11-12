/** 部署模式由构建装配决定，网页地址和玩家设置不能改变它。 */
export const DEPLOYMENT_MODE = typeof __DAMAGE_DEPLOYMENT_MODE__ === 'undefined' ? 'viewer' : __DAMAGE_DEPLOYMENT_MODE__;

export function viewerRouteFromHash(hash: string): 'simulation/basic-attack' | 'simulation/combat-analysis' {
  return hash.replace(/^#\/?/, '') === 'simulation/basic-attack' ? 'simulation/basic-attack' : 'simulation/combat-analysis';
}
