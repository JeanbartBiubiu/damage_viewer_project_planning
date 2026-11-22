export const BASIC_ATTACK_ROUTE = 'simulation/basic-attack';
export const COMBAT_ANALYSIS_ROUTE = 'simulation/combat-analysis';
export type SimulationRouteId = typeof BASIC_ATTACK_ROUTE | typeof COMBAT_ANALYSIS_ROUTE;

export function hashForRoute(route: string): string {
  return `#/${route}`;
}

export function viewerRouteFromHash(hash: string): SimulationRouteId {
  return hash.replace(/^#\/?/, '') === BASIC_ATTACK_ROUTE ? BASIC_ATTACK_ROUTE : COMBAT_ANALYSIS_ROUTE;
}
