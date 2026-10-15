import { createFormulaPhase4Input } from './formula-phase4-input.mjs';

/** 独立作者输入验证原生自动调度，不代表真实英雄配置；不读取旧固定样例。 */
export function createAutomaticSkillsInput(count = 3) {
  const input = createFormulaPhase4Input();
  const c = input.compileRequest, r = input.runRequest;
  const constant = value => ({ op: 'const', value });
  c.schemaHash = r.initialSnapshot.schemaHash = 'schema.automatic-skills.example';
  c.rulesHash = r.expectedRulesHash = r.initialSnapshot.rulesHash = 'rules.automatic-skills.example';
  c.typeCatalog.types.push({ key: 'ability/spell', domain: 'ability' },
    { key: 'event/skill_hit', domain: 'event' }, { key: 'event/ability_started', domain: 'event' },
    { key: 'state_scope/provider', domain: 'state_scope' });
  c.sharedProviders = [];
  c.combatants[0].providers = [];
  for (const actor of c.combatants) {
    actor.attributes.hp = { base: 1000000, current: 1000000, max: 1000000, resolved: 1000000 };
  }
  c.rules.skillActionBindings = [];
  r.driverPlan = { entries: [], skillActions: [], automaticSkills: { rules: [] } };
  Object.assign(r, { skillUses: [], skillHitFacts: [], attackStartFacts: [], processCommandFacts: [], outputMode: 'detailed',
    sampling: { disabled: true }, recordBudget: { maxAutomaticSkillRecords: 1000 },
    stopPolicy: { durationMs: 2200, stopOnTargetDeath: true, stopWhenNoEvents: true } });
  for (let index = 0; index < count; index++) {
    const key = `rule${index}`, providerRef = `mount_${key}`, definitionRef = `definition_${key}`;
    const initialRef = `source.provider[${providerRef}].ability[initial]`;
    const hitRef = `source.provider[${providerRef}].ability[hit]`;
    c.typeCatalog.types.push({ key: `ability/${key}`, domain: 'ability' });
    c.combatants[0].providers.push({ providerRef, definitionRef });
    c.sharedProviders.push({ providerKey: definitionRef, kind: 'character', stableId: key,
      processes: [{ processKey: 'cast', skillKey: key, costs: [],
        steps: [{ stepKey: 'delay', stepType: 'DELAY', delayMs: constant(1), occupiesAction: false }],
        cooldown: { durationMs: constant(1000), startMoment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null } }, momentOperations: [] }],
      abilities: [{ abilityKey: 'initial', kind: 'active', skillKey: key, types: ['ability/spell', `ability/${key}`],
        processControl: { processKey: 'cast', action: 'INITIAL' } },
      { abilityKey: 'hit', kind: 'active', skillKey: key, types: ['ability/spell', `ability/${key}`], operations: [{
        operation: 'resolve_skill_hit', target: 'target', skillHit: { skillKey: key, candidates: [{
          candidateKey: 'primary', effectOccurrenceKey: 'primary', effectKey: 'primary', resultKey: 'damage',
          semantic: { resultType: 'DAMAGE', target: 'TARGET', moment: 'INSTANT' }, spellShieldBlockScope: null,
          operations: [{ operation: 'damage', target: 'target', damageType: 'damage/physical', amount: constant(10), ref: 'primary_damage' }],
        }] },
      }] }] });
    c.rules.skillActionBindings.push({ bindingKey: `binding_${key}`, source: 'source', providerRef, providerDefinitionRef: definitionRef, skillKey: key,
      controls: [{ action: 'INITIAL', processKey: 'cast', abilityRef: initialRef }],
      hitBindings: [{ hitBindingKey: 'primary_hit', processKey: 'cast', moment: { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null }, hitAbilityRef: hitRef }] });
    r.driverPlan.automaticSkills.rules.push({ ruleKey: key, bindingKey: `binding_${key}`, sortOrder: index, target: 'target',
      hitBindings: [{ hitBindingKey: 'primary_hit', preset: 'TARGET_HIT' }],
      waitForCooldowns: index < count - 1 ? [`rule${index + 1}`] : [], releaseAfterRuleKey: index ? `rule${index - 1}` : null });
  }
  syncAutomaticInitialSnapshot(input);
  input.name = 'automatic_skills_explicit_chain';
  input.expectedSummarySubset = {};
  return input;
}

export function syncAutomaticInitialSnapshot(input) {
  input.runRequest.initialSnapshot.combatants = input.compileRequest.combatants.map(actor => ({ key: actor.key,
    attributes: structuredClone(actor.attributes), resources: structuredClone(actor.resources),
    providers: actor.providers.map(mount => ({ ...mount, source: actor.key, owner: actor.key, stacks: 1, expireAt: null, state: {} })),
    cooldowns: {}, shields: [], abilityState: {}, providerState: {}, vars: {},
  }));
}
