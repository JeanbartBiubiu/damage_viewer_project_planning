import type { SimulationMechanicStateInput } from '../../types/simulationSnapshot';
import { mechanicStateIdentity, type SimulationMechanicRequirement } from '../../engine/simulationPrimaryAttack';

export type SimulationMechanicDrafts = Record<string, number | undefined>;

export function mechanicDraftValue(requirement: SimulationMechanicRequirement, drafts: SimulationMechanicDrafts) {
  const identity = mechanicStateIdentity(requirement);
  return Object.prototype.hasOwnProperty.call(drafts, identity) ? drafts[identity] : requirement.initialValue;
}

export function mechanicDraftIssues(requirements: SimulationMechanicRequirement[], drafts: SimulationMechanicDrafts) {
  return requirements.flatMap(requirement => {
    const value = mechanicDraftValue(requirement, drafts);
    return value === undefined || !Number.isSafeInteger(value) || value < 0 || value > requirement.maxValue
      ? [`${requirement.skillName}／${requirement.name}：必须明确填写0～${requirement.maxValue}的整数；清空不恢复声明初值。`] : [];
  });
}

export function mechanicInputsFromDrafts(requirements: SimulationMechanicRequirement[], drafts: SimulationMechanicDrafts): SimulationMechanicStateInput[] {
  const issues = mechanicDraftIssues(requirements, drafts);
  if (issues.length) throw new Error(issues.join('；'));
  return requirements.filter(requirement => Object.prototype.hasOwnProperty.call(drafts, mechanicStateIdentity(requirement)))
    .map(({ side, origin, skillKey, stateKey }) => ({ side, origin, skillKey, stateKey, value: drafts[mechanicStateIdentity({ side, origin, skillKey, stateKey })]! }));
}
