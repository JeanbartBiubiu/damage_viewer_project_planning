import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { CompileRequest, DoneResult, EngineError } from '../../src/types/genericEngine';
import { fixedValue, parameterValue } from '../../src/types/numericValue';
import type { AuthoredTriggerProgram } from '../../src/engine/triggerAdapter';
import type { AuthoredHitProgram } from '../../src/engine/hitAdapter';
import type { SkillEffect } from '../../src/types/skillEffect';

const WASM_PATH = resolve('src/engine/wasm/tinygo_engine_v2.wasm');
const WASM_SHA256 = '1434E7D212D8CA0F8A6139C70B47CD098A774D2EC0A78BC424617B0CA9637F61';
const WASM_BYTES = 888566;

function slot(value: number, max = value) {
  return { base: value, current: value, max, resolved: value };
}

const vampRules = [{
  vampType: 'OMNIVAMP' as const, sourceAttributeKey: 'omnivamp_percent', basisOutputKind: 'POST_DEFENSE_DAMAGE' as const,
  defaultEfficiency: 1, deliveryKinds: ['SKILL' as const, 'BASIC_ATTACK' as const], originKinds: ['DIRECT' as const],
  skillCategoryKeys: ['common']
}];

function processStart() {
  return { momentType: 'PROCESS_START' as const, stepKey: null, failureReason: null };
}
function processComplete() {
  return { momentType: 'PROCESS_COMPLETE' as const, stepKey: null, failureReason: null };
}
function stepExec(stepKey: string) {
  return { momentType: 'STEP_EXECUTION' as const, stepKey, failureReason: null };
}

function cooldownReady() {
  return {
    conditionKey: 'icd_ready', conditionType: 'INTERNAL_STATE_CHECK' as const, sortOrder: 20,
    detail: { stateKey: 'icd', valueKind: 'REMAINING_MS' as const, optionKey: null, expectedBoolean: null, comparator: 'EQ' as const, comparisonValue: fixedValue(0) }
  };
}

function syntheticWindow(): AuthoredTriggerProgram {
  const skillKey = 'synth_window';
  return {
    gameId: 'lol', skillKey, skillLevel: 1, characterLevel: 1,
    identity: { source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' } },
    statuses: [], modifierZones: [], skillCategoryKeys: ['common'], vampRules,
    internalStates: [
      {
        gameId: 'lol', skillKey, stateKey: 'hits', name: 'hits', scope: 'SKILL', description: 'synthetic', sortOrder: 10,
        stateType: 'COUNTER', detail: { initialValue: fixedValue(0), maxValue: fixedValue(99) }, createdAt: '', updatedAt: ''
      },
      {
        gameId: 'lol', skillKey, stateKey: 'icd', name: 'icd', scope: 'SKILL', description: 'synthetic', sortOrder: 20,
        stateType: 'INTERNAL_COOLDOWN', detail: { durationValue: fixedValue(6000) }, createdAt: '', updatedAt: ''
      }
    ],
    processes: [
      {
        gameId: 'lol', skillKey, processKey: 'window', name: 'window', activationType: 'PASSIVE', description: 'synthetic',
        sortOrder: 10, cooldown: null,
        steps: [{ stepKey: 'wait', name: 'wait', description: null, sortOrder: 10, stepType: 'DELAY', detail: { delayValue: fixedValue(2000) } }],
        effectBindings: [],
        stateOperations: [
          { operationKey: 'bump', name: 'bump', stateKey: 'hits', moment: processStart(), sortOrder: 10, operation: 'INCREASE', value: fixedValue(1), optionKey: null },
          { operationKey: 'reset', name: 'reset', stateKey: 'hits', moment: processComplete(), sortOrder: 20, operation: 'SET', value: fixedValue(0), optionKey: null }
        ],
        createdAt: '', updatedAt: ''
      },
      {
        gameId: 'lol', skillKey, processKey: 'reward', name: 'reward', activationType: 'PASSIVE', description: 'synthetic',
        sortOrder: 20, cooldown: null,
        steps: [{ stepKey: 'now', name: 'now', description: null, sortOrder: 10, stepType: 'IMMEDIATE', detail: {} }],
        effectBindings: [{ bindingKey: 'do_bonus', effectKey: 'bonus', moment: processStart(), sortOrder: 10 }],
        stateOperations: [
          { operationKey: 'clear', name: 'clear', stateKey: 'hits', moment: processStart(), sortOrder: 20, operation: 'SET', value: fixedValue(0), optionKey: null },
          { operationKey: 'start_icd', name: 'start_icd', stateKey: 'icd', moment: processStart(), sortOrder: 30, operation: 'START', value: null, optionKey: null }
        ],
        createdAt: '', updatedAt: ''
      }
    ],
    effects: [{
      gameId: 'lol', skillKey, effectKey: 'bonus', name: 'bonus', description: 'synthetic', sortOrder: 10, lifecycle: null,
      results: [{
        resultKey: 'hit', name: 'hit', resultType: 'DAMAGE', target: 'TARGET', description: null, sortOrder: 10,
        spellShieldBlockScope: null, lifecycleBehavior: null,
        valueRule: { value: fixedValue(40), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
        detail: {
          damageTypeKey: 'physical', deliveryKind: 'SKILL', originKind: 'DIRECT',
          critical: { mode: 'DISALLOWED', multiplierValue: null }, vampQualification: 'RESOLVED', vampOverrides: []
        }
      }],
      createdAt: '', updatedAt: ''
    }],
    rules: [
      {
        ruleKey: 'first_hit', name: 'first', description: 'synthetic', sortOrder: 10,
        eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: null } },
        conditionGroups: [{
          groupKey: 'first', name: 'first', sortOrder: 10,
          conditions: [{
            conditionKey: 'idle', conditionType: 'INTERNAL_STATE_CHECK', sortOrder: 10,
            detail: { stateKey: 'hits', valueKind: 'VALUE', optionKey: null, expectedBoolean: null, comparator: 'EQ', comparisonValue: fixedValue(0) }
          }, cooldownReady()]
        }],
        actions: [{
          actionKey: 'go_window', name: 'window', actionType: 'START_PROCESS', sortOrder: 10,
          targetContext: 'CURRENT_TARGET', detail: { processKey: 'window' }, runtimeInputBindings: [], resultModifiers: []
        }],
        perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: { groupKey: 'proc', scope: 'SKILL' }
      },
      {
        ruleKey: 'second_hit', name: 'second', description: 'synthetic', sortOrder: 20,
        eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: null } },
        conditionGroups: [{
          groupKey: 'ready', name: 'ready', sortOrder: 10,
          conditions: [{
            conditionKey: 'stacked', conditionType: 'INTERNAL_STATE_CHECK', sortOrder: 10,
            detail: { stateKey: 'hits', valueKind: 'VALUE', optionKey: null, expectedBoolean: null, comparator: 'GTE', comparisonValue: fixedValue(1) }
          }, cooldownReady()]
        }],
        actions: [{
          actionKey: 'go_reward', name: 'reward', actionType: 'START_PROCESS', sortOrder: 10,
          targetContext: 'CURRENT_TARGET', detail: { processKey: 'reward' }, runtimeInputBindings: [], resultModifiers: []
        }],
        perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: { groupKey: 'proc', scope: 'SKILL' }
      }
    ]
  };
}

function syntheticSpellblade(): AuthoredTriggerProgram {
  const skillKey = 'synth_spellblade';
  const authored: AuthoredTriggerProgram = {
    gameId: 'lol', skillKey, skillLevel: 1, characterLevel: 1,
    identity: { source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' } },
    statuses: [], modifierZones: [], skillCategoryKeys: ['common'], vampRules,
    internalStates: [
      {
        gameId: 'lol', skillKey, stateKey: 'ready', name: 'ready', scope: 'SKILL', description: 'synthetic', sortOrder: 10,
        stateType: 'FLAG', detail: { initialEnabled: false }, createdAt: '', updatedAt: ''
      },
      {
        gameId: 'lol', skillKey, stateKey: 'icd', name: 'icd', scope: 'SKILL', description: 'synthetic', sortOrder: 20,
        stateType: 'INTERNAL_COOLDOWN', detail: { durationValue: fixedValue(1500) }, createdAt: '', updatedAt: ''
      }
    ],
    processes: [{
      gameId: 'lol', skillKey, processKey: 'spellblade', name: 'spellblade', activationType: 'ACTIVE', description: 'synthetic',
      sortOrder: 10, cooldown: null,
      steps: [{
        stepKey: 'aa', name: 'aa', description: null, sortOrder: 10, stepType: 'EMPOWERED_BASIC_ATTACK',
        detail: { windowValue: fixedValue(1500), consumeMoment: 'ATTACK_HIT' }
      }],
      effectBindings: [{ bindingKey: 'do_bonus', effectKey: 'bonus', moment: stepExec('aa'), sortOrder: 10 }],
      stateOperations: [
        { operationKey: 'arm', name: 'arm', stateKey: 'ready', moment: processStart(), sortOrder: 10, operation: 'ENABLE', value: null, optionKey: null },
        { operationKey: 'disarm', name: 'disarm', stateKey: 'ready', moment: stepExec('aa'), sortOrder: 20, operation: 'DISABLE', value: null, optionKey: null },
        { operationKey: 'start_icd', name: 'start_icd', stateKey: 'icd', moment: stepExec('aa'), sortOrder: 30, operation: 'START', value: null, optionKey: null },
        { operationKey: 'timeout', name: 'timeout', stateKey: 'ready', moment: { momentType: 'STEP_TIMEOUT', stepKey: 'aa', failureReason: null }, sortOrder: 40, operation: 'DISABLE', value: null, optionKey: null }
      ],
      createdAt: '', updatedAt: ''
    }],
    effects: [{
      gameId: 'lol', skillKey, effectKey: 'bonus', name: 'bonus', description: 'synthetic', sortOrder: 10, lifecycle: null,
      results: [
        {
          resultKey: 'hit', name: 'hit', resultType: 'DAMAGE', target: 'TARGET', description: null, sortOrder: 10,
          spellShieldBlockScope: null, lifecycleBehavior: null,
          valueRule: { value: fixedValue(40), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
          detail: {
            damageTypeKey: 'physical', deliveryKind: 'BASIC_ATTACK', originKind: 'DIRECT',
            critical: { mode: 'DISALLOWED', multiplierValue: null }, vampQualification: 'RESOLVED', vampOverrides: []
          }
        },
        {
          resultKey: 'mana', name: 'mana', resultType: 'RESOURCE_CHANGE', target: 'SOURCE', description: null, sortOrder: 20,
          spellShieldBlockScope: null, lifecycleBehavior: null,
          valueRule: { value: parameterValue('stolen'), fixedMultiplier: 0.5, fixedMinValue: 0, fixedMaxValue: null },
          detail: { attributeKey: 'mana', operation: 'RESTORE' }
        }
      ],
      createdAt: '', updatedAt: ''
    }],
    rules: [
      {
        ruleKey: 'arm', name: 'arm', description: 'synthetic', sortOrder: 10,
        eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: skillKey, useKind: 'ACTIVE', castPhase: 'INITIAL' } },
        conditionGroups: [{
          groupKey: 'idle', name: 'idle', sortOrder: 10,
          conditions: [{
            conditionKey: 'ready', conditionType: 'INTERNAL_STATE_CHECK', sortOrder: 10,
            detail: { stateKey: 'ready', valueKind: 'ENABLED', optionKey: null, expectedBoolean: false, comparator: null, comparisonValue: null }
          }, cooldownReady()]
        }],
        actions: [{
          actionKey: 'start', name: 'start', actionType: 'START_PROCESS', sortOrder: 10,
          targetContext: 'CURRENT_TARGET', detail: { processKey: 'spellblade' }, runtimeInputBindings: [], resultModifiers: []
        }],
        perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null
      },
      {
        ruleKey: 'consume', name: 'consume', description: 'synthetic', sortOrder: 20,
        eventSource: { eventType: 'BASIC_ATTACK_HIT', detail: {} },
        conditionGroups: [{
          groupKey: 'armed', name: 'armed', sortOrder: 10,
          conditions: [{
            conditionKey: 'ready', conditionType: 'INTERNAL_STATE_CHECK', sortOrder: 10,
            detail: { stateKey: 'ready', valueKind: 'ENABLED', optionKey: null, expectedBoolean: true, comparator: null, comparisonValue: null }
          }, cooldownReady()]
        }],
        actions: [{
          actionKey: 'do_bonus', name: 'bonus', actionType: 'EXECUTE_EFFECT', sortOrder: 10,
          targetContext: 'CURRENT_TARGET', detail: { effectKey: 'bonus' },
          runtimeInputBindings: [{
            bindingKey: 'from_hit', parameterKey: 'stolen', sourceType: 'PRIOR_ACTION_RESULT',
            detail: { sourceActionKey: 'do_bonus', sourceResultKey: 'hit', outputKind: 'POST_DEFENSE_DAMAGE' }
          }],
          resultModifiers: []
        }],
        perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: { groupKey: 'spellblade', scope: 'SKILL' }
      }
    ]
  };
  // The authoring API only permits earlier EXECUTE_EFFECT actions as output sources.
  const bonus = authored.effects[0]!;
  const refund = { ...bonus, effectKey: 'refund', name: 'refund', results: [bonus.results[1]!] };
  bonus.results = [bonus.results[0]!];
  authored.effects = [bonus, refund];
  authored.parameters = [{ gameId: 'lol', skillKey, parameterKey: 'stolen', name: '前序伤害', valueType: 'DECIMAL', valueMode: 'RUNTIME_INPUT', fixedValue: null, levelValues: null, description: null, sortOrder: 0, createdAt: '', updatedAt: '' }];
  const consume = authored.rules[1]!;
  const damage = consume.actions[0]!;
  consume.actions = [{ ...damage, runtimeInputBindings: [] }, { ...damage, actionKey: 'do_refund', name: 'refund', sortOrder: 20, detail: { effectKey: 'refund' } }];
  authored.processes[0]!.effectBindings.push({ bindingKey: 'do_refund', effectKey: 'refund', moment: stepExec('aa'), sortOrder: 20 });
  for (const op of authored.processes[0]!.stateOperations) if (op.moment.momentType === 'STEP_EXECUTION') op.sortOrder += 10;
  return authored;
}

function shieldWindow(effect?: SkillEffect): AuthoredTriggerProgram {
  const authored = syntheticWindow();
  const shield: SkillEffect = effect ?? {
    gameId: 'lol', skillKey: authored.skillKey, effectKey: 'shield', name: '护盾', description: 'synthetic', sortOrder: 10,
    lifecycle: { durationValue: fixedValue(2000), maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1), instanceScope: 'SOURCE', reapplicationStackMode: 'KEEP', reapplicationDurationMode: 'REFRESH_ALL', expiryMode: 'ALL_AT_ONCE', periodicIntervalValue: null, firstPeriodicExecution: null },
    results: [{ resultKey: 'shield', name: '护盾', resultType: 'NORMAL_SHIELD', target: 'SOURCE', description: null, sortOrder: 10, spellShieldBlockScope: null,
      lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED', reapplicationValueMode: 'REPLACE', periodicExecutionMode: null },
      valueRule: { value: fixedValue(150), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
      detail: { absorbedDamageTypeKey: null, decayMode: 'NONE' }
    }], createdAt: '', updatedAt: ''
  };
  authored.skillKey = shield.skillKey;
  authored.effects = [shield];
  for (const row of [...authored.processes, ...authored.internalStates]) row.skillKey = shield.skillKey;
  authored.processes[1]!.effectBindings[0]!.effectKey = shield.effectKey;
  return authored;
}

function dummyHit(): AuthoredHitProgram {
  return {
    gameId: 'lol', skillKey: 'author_q', skillLevel: 1, characterLevel: 1,
    identity: { source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' } },
    statuses: [], modifierZones: [], skillCategoryKeys: ['common'], vampRules,
    effects: [{
      gameId: 'lol', skillKey: 'author_q', effectKey: 'dummy', name: 'dummy', description: null, sortOrder: 10, lifecycle: null,
      results: [{
        resultKey: 'touch', name: 'touch', resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE', description: null, sortOrder: 10,
        spellShieldBlockScope: null, lifecycleBehavior: null,
        valueRule: { value: fixedValue(0), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
        detail: { attributeKey: 'attack_damage', operation: 'INCREASE', modifierZoneKey: null }
      }],
      createdAt: '', updatedAt: ''
    }],
    rules: [{
      ruleKey: 'touch', name: 'touch', description: null, sortOrder: 10,
      eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'author_q' } },
      conditionGroups: [],
      actions: [{
        actionKey: 'do_dummy', name: 'dummy', actionType: 'EXECUTE_EFFECT', sortOrder: 10,
        targetContext: 'CURRENT_TARGET', detail: { effectKey: 'dummy' }, runtimeInputBindings: [], resultModifiers: []
      }],
      perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null
    }]
  };
}

function baseRequest(): CompileRequest {
  return {
    schemaVersion: 'generic-p0', schemaHash: 'schema.p6.browser', rulesHash: 'before-p6',
    typeCatalog: { types: [{ key: 'damage/physical', domain: 'damage' }], relations: [] }, rules: {},
    combatants: [
      {
        key: 'source',
        attributes: {
          hp: slot(1000, 2000), attack_damage: slot(100, 200), armor: slot(0), omnivamp_percent: slot(0.2, 1)
        },
        resources: { mana: { current: 0, max: 200 } },
        providers: [{ providerRef: 'champion', definitionRef: 'champion' }]
      },
      {
        key: 'target',
        attributes: {
          hp: slot(1000, 2000), attack_damage: slot(100, 200), armor: slot(0), omnivamp_percent: slot(0, 1)
        },
        resources: {},
        providers: []
      }
    ],
    sharedProviders: [{
      providerKey: 'champion', stableId: 'champion', kind: 'champion',
      abilities: [
        { abilityKey: 'skill_hit', kind: 'active', operations: [] },
        { abilityKey: 'cast', kind: 'active', operations: [] }
      ]
    }]
  };
}

type WorkerResult = {
  adapted?: { combo?: string; oncePerUse?: unknown; consumeEvent?: string; outputRef?: string };
  adapterError?: string;
  compileOk?: boolean;
  compileErrors?: EngineError[];
  done?: DoneResult;
  secondDone?: DoneResult;
  runError?: string;
  released?: boolean;
};

type RestoreLedgerRow = {
  owner: string; providerRef: string; groupKey: string; scope: 'provider' | 'provider_target';
  useSource: string; useSkillKey: string; useKey: string; target?: string | null;
};

async function runP6(page: Page, payload: {
  mode: 'window' | 'spellblade' | 'spellblade-start' | 'reject-first-contact' | 'reject-eclipse';
  uses?: Array<{ useKey: string; skillKey: string }>;
  hits?: Array<{ entryKey: string; at: number; useKey: string }>;
  durationMs?: number;
  startCost?: number;
  startOnly?: boolean;
  program?: AuthoredTriggerProgram;
  incoming?: Array<{ at: number; amount: number }>;
  restore?: { state: Record<string, number>; expireAt: Record<string, number>; ledger: RestoreLedgerRow[] };
  secondRun?: boolean;
}): Promise<WorkerResult> {
  await page.route('**/p6-browser-harness', (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>第6项运行验证</title>'
  }));
  await page.goto('/p6-browser-harness');
  return page.evaluate(async (data) => {
    const {
      adaptTriggerProgram, withTriggerProgram, basicAttackStartAbility, basicAttackHitAbility,
      attackStartFact, provenTriggerUse, useTriggerLedgerEntry, triggerProviderStateSnapshot
    } = await import(/* @vite-ignore */ '/src/engine/triggerAdapter.ts');
    const { adaptHitProgram, withHitProgram, provenSkillUseFact, skillHitFact } = await import(/* @vite-ignore */ '/src/engine/hitAdapter.ts');
    const { GenericEngineClient } = await import(/* @vite-ignore */ '/src/engine/genericEngineClient.ts');
    const authoredWindow = data.mode === 'window' && data.program ? data.program : data.window;
    const authoredBlade = data.mode !== 'window' && data.program ? data.program : data.blade;
    const dummy = data.dummy;
    const input = data.input;
    try {
      if (data.mode === 'reject-first-contact') {
        const broken = structuredClone(authoredWindow);
        broken.rules[0]!.conditionGroups = [{
          groupKey: 'first', name: 'first', sortOrder: 10,
          conditions: [{
            conditionKey: 'first', conditionType: 'EVENT_VALUE_COMPARE', sortOrder: 10,
            detail: { eventValueKey: 'SKILL_HIT_FIRST_CONTACT', comparator: 'EQ', comparisonValue: { kind: 'FIXED', value: 1 } }
          }]
        }];
        try { adaptTriggerProgram(broken); return { adapterError: 'missing' }; } catch (error) {
          return { adapterError: String(error) };
        }
      }
      if (data.mode === 'reject-eclipse') {
        const broken = structuredClone(authoredWindow);
        broken.skillKey = 'item_eclipse';
        for (const process of broken.processes) process.skillKey = 'item_eclipse';
        for (const state of broken.internalStates) state.skillKey = 'item_eclipse';
        for (const effect of broken.effects) effect.skillKey = 'item_eclipse';
        broken.processes[0]!.steps[0]!.detail = { delayValue: { kind: 'FORMULA', formulaKey: 'unverified_window' } };
        try { adaptTriggerProgram(broken); return { adapterError: 'missing' }; } catch (error) {
          return { adapterError: String(error) };
        }
      }
      if (data.mode === 'spellblade-start') {
        authoredBlade.processes[0]!.steps[0]!.detail.consumeMoment = 'ATTACK_START';
        authoredBlade.rules[1]!.eventSource = { eventType: 'BASIC_ATTACK_START', detail: {} };
      }
      const authored = data.mode === 'window' ? authoredWindow : authoredBlade;
      const owner = authored.owner ?? 'source';
      const counterpart = owner === 'source' ? 'target' : 'source';
      const adapted = adaptTriggerProgram(authored);
      const hitAdapted = data.mode === 'window' ? adaptHitProgram(dummy) : null;
      let request = structuredClone(input);
      if (owner === 'target') for (const actor of request.combatants) actor.key = actor.key === 'source' ? 'target' : 'source';
      if (data.mode === 'window') {
        request = withHitProgram(request, { hitProviderKey: 'champion', hitAbilityKey: 'skill_hit', authored: dummy }, { rulesHash: 'with-p6-hit' });
      } else {
        const champion = request.sharedProviders![0]!;
        champion.abilities = [
          { abilityKey: 'cast', kind: 'active', operations: [] },
          basicAttackStartAbility({
            abilityKey: 'aa_start', skillKey: 'aa_basic',
            ...(data.startCost != null ? { cost: { resourceKey: 'mana', amount: { op: 'const', value: data.startCost } } } : {})
          }),
          basicAttackHitAbility({ abilityKey: 'aa_hit', skillKey: 'aa_basic' })
        ];
        request.typeCatalog.types.push({ key: 'event/basic_attack_start', domain: 'event' }, { key: 'event/basic_attack_hit', domain: 'event' }, { key: 'ability/basic_attack', domain: 'ability' });
      }
      request = withTriggerProgram(request, {
        triggerProviderKey: `item:${authored.skillKey}`, authored,
        initialCastAbilityKey: data.mode === 'window' ? undefined : 'cast'
      }, { rulesHash: 'with-p6' });
      const defender = request.combatants.find(actor => actor.key === counterpart)!;
      if (data.incoming?.length) {
        defender.providers.push({ providerRef: 'incoming', definitionRef: 'incoming' });
        request.sharedProviders!.push({ providerKey: 'incoming', kind: 'champion', stableId: 'incoming', abilities: data.incoming.map((hit, index) => ({
          abilityKey: `hit_${index}`, kind: 'active', operations: [{ operation: 'damage', target: 'target', damageType: 'damage/physical', amount: { op: 'const', value: hit.amount } }]
        })) });
      }
      const client = new GenericEngineClient();
      try {
        const compiled = await client.compile(request);
        if (!compiled.ok) {
          return {
            adapted: { combo: adapted.combo, oncePerUse: adapted.oncePerUse, consumeEvent: adapted.consumeEvent, outputRef: adapted.provider.abilities?.[1]?.listenerSpec?.operations?.[0]?.outputRef },
            compileOk: false, compileErrors: compiled.errors
          };
        }
        const uses = (data.uses ?? []).map((row) => provenSkillUseFact({ useKey: row.useKey, source: owner, skillKey: row.skillKey }));
        const hits = data.mode === 'window' ? (data.hits ?? []).map((row) => skillHitFact(row.entryKey, row.useKey)) : data.startOnly ? [] : [skillHitFact('hit', 'aa1')];
        const entries = data.mode === 'window'
          ? (data.hits ?? []).map((row) => ({
              entryKey: row.entryKey, abilityRef: `${owner}.provider[champion].ability[skill_hit]`,
              source: owner, target: counterpart, firstAtMs: row.at
            }))
          : [
              { entryKey: 'cast', abilityRef: `${owner}.provider[champion].ability[cast]`, source: owner, target: counterpart, firstAtMs: 0 },
              { entryKey: 'start', abilityRef: `${owner}.provider[champion].ability[aa_start]`, source: owner, target: counterpart, firstAtMs: 10 },
              ...(data.startOnly ? [] : [{ entryKey: 'hit', abilityRef: `${owner}.provider[champion].ability[aa_hit]`, source: owner, target: counterpart, firstAtMs: 20 }])
            ];
        entries.push(...(data.incoming ?? []).map((hit, index) => ({ entryKey: `incoming_${index}`, abilityRef: `${counterpart}.provider[incoming].ability[hit_${index}]`, source: counterpart, target: owner, firstAtMs: hit.at })));
        const triggerRef = `item:${authored.skillKey}`;
        const snapshotCombatants = request.combatants.map((actor) => ({
          key: actor.key, attributes: structuredClone(actor.attributes), resources: structuredClone(actor.resources),
          cooldowns: {}, shields: [], abilityState: {}, vars: {}, effectiveStatuses: [],
          providers: actor.providers.map((provider) => ({
            providerRef: provider.providerRef, definitionRef: provider.definitionRef,
            source: actor.key, owner: actor.key, stacks: 1, expireAt: null as number | null, state: {}
          })),
          providerState: actor.key === owner ? {
            [triggerRef]: data.restore
              ? triggerProviderStateSnapshot({ state: data.restore.state, expireAt: data.restore.expireAt })
              : { state: {}, expireAt: {} }
          } : {}
        }));
        const runBody = {
          sessionId: compiled.sessionId, expectedRulesHash: 'with-p6', schemaVersion: request.schemaVersion,
          schemaHash: request.schemaHash, rulesHash: 'with-p6',
          initialSnapshot: {
            schemaHash: request.schemaHash, rulesHash: 'with-p6', timeMs: 0,
            combatants: snapshotCombatants,
            useTriggerLedger: (data.restore?.ledger ?? []).map((row) => useTriggerLedgerEntry(row))
          },
          driverPlan: { entries, conditionRecheckIntervalMs: 100 },
          stopPolicy: { durationMs: data.durationMs ?? 3000, stopOnTargetDeath: false, stopWhenNoEvents: false },
          sampling: { sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 100 },
          skillUses: uses.length ? uses : [provenTriggerUse({ useKey: 'aa1', source: owner, skillKey: 'aa_basic' })],
          skillHitFacts: hits,
          attackStartFacts: data.mode === 'window' ? undefined : [attackStartFact('start', 'aa1')]
        };
        const done = await client.run(runBody);
        const secondDone = data.secondRun
          ? await client.run({
              ...runBody,
              initialSnapshot: {
                ...runBody.initialSnapshot,
                combatants: request.combatants.map((actor) => ({
                  key: actor.key, attributes: structuredClone(actor.attributes), resources: structuredClone(actor.resources),
                  cooldowns: {}, shields: [], abilityState: {}, vars: {}, effectiveStatuses: [],
                  providers: actor.providers.map((provider) => ({
                    providerRef: provider.providerRef, definitionRef: provider.definitionRef,
                    source: actor.key, owner: actor.key, stacks: 1, expireAt: null as number | null, state: {}
                  })),
                  providerState: actor.key === owner ? { [triggerRef]: { state: {}, expireAt: {} } } : {}
                })),
                useTriggerLedger: []
              }
            })
          : undefined;
        const released = await client.release(compiled.sessionId, 'with-p6');
        return {
          adapted: {
            combo: adapted.combo, oncePerUse: adapted.oncePerUse, consumeEvent: adapted.consumeEvent,
            outputRef: adapted.provider.abilities?.at(-1)?.listenerSpec?.operations?.[0]?.outputRef
          },
          compileOk: true, done, secondDone, released: released.released, hitAdapted: hitAdapted?.resolveKind
        };
      } catch (error) {
        return {
          adapted: { combo: adapted.combo, oncePerUse: adapted.oncePerUse, consumeEvent: adapted.consumeEvent },
          compileOk: true, runError: String(error)
        };
      } finally {
        client.terminate();
      }
    } catch (error) {
      return { adapterError: String(error) };
    }
  }, { ...payload, window: syntheticWindow(), blade: syntheticSpellblade(), dummy: dummyHit(), input: baseRequest() });
}

function providerState(done: DoneResult, providerRef: string): Record<string, unknown> {
  const source = done.finalSnapshot.combatants.find((row) => row.key === 'source')!;
  return (source.providerState[providerRef] ?? {}) as Record<string, unknown>;
}

async function assertNativeResult(result: WorkerResult, testInfo: import('@playwright/test').TestInfo): Promise<void> {
  if (!result.compileOk || result.runError || !result.done) {
    await testInfo.attach('p6-native-failure', { contentType: 'application/json', body: Buffer.from(JSON.stringify(result, null, 2)) });
  }
  expect(result.compileOk, JSON.stringify(result.compileErrors)).toBe(true);
  expect(result.runError).toBeUndefined();
  expect(result.done).toBeDefined();
  expect(result.released).toBe(true);
}

test('最终Wasm产物身份', () => {
  const bytes = readFileSync(WASM_PATH);
  expect(bytes.length).toBe(WASM_BYTES);
  expect(createHash('sha256').update(bytes).digest('hex').toUpperCase()).toBe(WASM_SHA256);
});

test('合成配置拒绝首次接触与未核定星蚀窗口，不补默认', async ({ page }) => {
  const first = await runP6(page, { mode: 'reject-first-contact' });
  expect(first.adapterError).toMatch(/首次接触/);
  const eclipse = await runP6(page, { mode: 'reject-eclipse' });
  expect(eclipse.adapterError).toMatch(/公式缺失|不能猜测|窗口/);
});

test('实际 Worker：合成计数窗口同 use 多段只计一次，下一真实 use 触发奖励', async ({ page }, testInfo) => {
  const result = await runP6(page, {
    mode: 'window',
    uses: [
      { useKey: 'u1', skillKey: 'author_q' },
      { useKey: 'u2', skillKey: 'author_q' }
    ],
    hits: [
      { entryKey: 'h1', at: 0, useKey: 'u1' },
      { entryKey: 'h2', at: 50, useKey: 'u1' },
      { entryKey: 'h3', at: 100, useKey: 'u2' }
    ],
    secondRun: true
  });
  expect(result.adapterError).toBeUndefined();
  expect(result.adapted?.combo).toBe('count_window');
  expect(result.adapted?.oncePerUse).toEqual({ groupKey: 'proc', scope: 'provider' });
  await assertNativeResult(result, testInfo);
  const bag = providerState(result.done!, 'item:synth_window');
  const state = (bag.state ?? {}) as Record<string, number>;
  expect(state.hits).toBe(0);
  expect(state.icd).toBe(1);
  expect(result.done!.finalSnapshot.useTriggerLedger?.length).toBe(2);
  expect(result.secondDone!.finalSnapshot.useTriggerLedger?.length).toBe(2);
  expect(result.released).toBe(true);
});

test('实际 Worker：固定窗口不续期，恰好到期后重开', async ({ page }, testInfo) => {
  const result = await runP6(page, {
    mode: 'window',
    durationMs: 2500,
    uses: [
      { useKey: 'u1', skillKey: 'author_q' },
      { useKey: 'u2', skillKey: 'author_q' }
    ],
    hits: [
      { entryKey: 'h1', at: 0, useKey: 'u1' },
      { entryKey: 'h2', at: 2000, useKey: 'u2' }
    ]
  });
  expect(result.adapterError).toBeUndefined();
  expect(result.adapted?.combo).toBe('count_window');
  await assertNativeResult(result, testInfo);
  const bag = providerState(result.done!, 'item:synth_window');
  const state = (bag.state ?? {}) as Record<string, number>;
  expect(state.hits).toBe(1);
  expect(state.icd).toBe(0);
});

test('实际 Worker：快照恢复期限与历史 use 额度，新命中走下一真实 use', async ({ page }, testInfo) => {
  const result = await runP6(page, {
    mode: 'window',
    uses: [
      { useKey: 'hist1', skillKey: 'author_q' },
      { useKey: 'u2', skillKey: 'author_q' }
    ],
    hits: [
      { entryKey: 'h1', at: 0, useKey: 'hist1' },
      { entryKey: 'h2', at: 100, useKey: 'u2' }
    ],
    restore: {
      state: { hits: 1 }, expireAt: { hits: 2000 },
      ledger: [{
        owner: 'source', providerRef: 'item:synth_window', groupKey: 'proc', scope: 'provider',
        useSource: 'source', useSkillKey: 'author_q', useKey: 'hist1'
      }]
    }
  });
  expect(result.adapterError).toBeUndefined();
  await assertNativeResult(result, testInfo);
  const bag = providerState(result.done!, 'item:synth_window');
  const state = (bag.state ?? {}) as Record<string, number>;
  expect(state.hits).toBe(0);
  expect(state.icd).toBe(1);
  expect(result.done!.finalSnapshot.useTriggerLedger?.some((row) => row.useKey === 'hist1')).toBe(true);
  expect(result.done!.finalSnapshot.useTriggerLedger?.some((row) => row.useKey === 'u2')).toBe(true);
});

test('实际 Worker：合成待击消费开始与命中分开，伤害回蓝后清 ready 并开冷却', async ({ page }, testInfo) => {
  const result = await runP6(page, { mode: 'spellblade', durationMs: 100 });
  expect(result.adapterError).toBeUndefined();
  expect(result.adapted?.combo).toBe('empowered');
  expect(result.adapted?.consumeEvent).toBe('event/basic_attack_hit');
  expect(result.adapted?.outputRef).toBe('do_bonus_hit');
  await assertNativeResult(result, testInfo);
  const bag = providerState(result.done!, 'item:synth_spellblade');
  const state = (bag.state ?? {}) as Record<string, number>;
  expect(state.ready).toBe(0);
  expect(state.icd).toBe(1);
  const source = result.done!.finalSnapshot.combatants.find((row) => row.key === 'source')!;
  expect(source.resources.mana.current).toBe(20);
  expect(result.done!.evidence.items.some((item) => item.kind === 'emitted_event' && item.ref === 'event/basic_attack_start')).toBe(true);
  expect(result.done!.evidence.items.some((item) => item.kind === 'emitted_event' && item.ref === 'event/basic_attack_hit')).toBe(true);
  expect(result.done!.evidence.items.some((item) => item.kind === 'emitted_event' && item.ref === 'event/skill_hit')).toBe(false);
});

test('实际 Worker：开始消费门禁失败不消费 ready', async ({ page }, testInfo) => {
  const result = await runP6(page, { mode: 'spellblade-start', startCost: 50, startOnly: true, durationMs: 100 });
  expect(result.adapterError).toBeUndefined();
  expect(result.adapted?.consumeEvent).toBe('event/basic_attack_start');
  await assertNativeResult(result, testInfo);
  const bag = providerState(result.done!, 'item:synth_spellblade');
  const state = (bag.state ?? {}) as Record<string, number>;
  expect(state.ready).toBe(1);
  expect(state.icd).toBe(0);
});

test('实际 Worker：内部冷却中不会重新开窗或重复奖励', async ({ page }, testInfo) => {
  const result = await runP6(page, { mode: 'window', durationMs: 400,
    uses: ['u1', 'u2', 'u3', 'u4'].map(useKey => ({ useKey, skillKey: 'author_q' })),
    hits: [0, 100, 200, 300].map((at, index) => ({ entryKey: `h${index}`, at, useKey: `u${index + 1}` }))
  });
  await assertNativeResult(result, testInfo);
  expect(result.done!.finalSnapshot.useTriggerLedger).toHaveLength(2);
  expect(result.done!.finalSnapshot.combatants.find(actor => actor.key === 'target')!.attributes.hp.current).toBe(960);
  expect(providerState(result.done!, 'item:synth_window').state).toMatchObject({ hits: 0, icd: 1 });
});

test('实际 Worker：同一攻击开始已消费、尚未命中时命中消费仍待命', async ({ page }, testInfo) => {
  const start = await runP6(page, { mode: 'spellblade-start', durationMs: 15, startOnly: true });
  await assertNativeResult(start, testInfo);
  expect(start.done!.finalSnapshot.combatants.find(actor => actor.key === 'source')!.resources.mana.current).toBe(20);
  expect(providerState(start.done!, 'item:synth_spellblade').state).toMatchObject({ ready: 0, icd: 1 });
  expect(start.done!.evidence.items.some(item => item.kind === 'damage' && item.timeMs === 10)).toBe(true);
  const hit = await runP6(page, { mode: 'spellblade', durationMs: 15, startOnly: true });
  await assertNativeResult(hit, testInfo);
  expect(hit.done!.finalSnapshot.combatants.find(actor => actor.key === 'source')!.resources.mana.current).toBe(0);
  expect(providerState(hit.done!, 'item:synth_spellblade').state).toMatchObject({ ready: 1, icd: 0 });
});

test('实际 Worker：反向拥有者的回蓝、命中与同次使用账本归属一致', async ({ page }, testInfo) => {
  const program = syntheticSpellblade(); program.owner = 'target';
  const result = await runP6(page, { mode: 'spellblade', program, durationMs: 100 });
  await assertNativeResult(result, testInfo);
  const owner = result.done!.finalSnapshot.combatants.find(actor => actor.key === 'target')!;
  expect(owner.resources.mana.current).toBe(20);
  expect(result.done!.finalSnapshot.combatants.find(actor => actor.key === 'source')!.attributes.hp.current).toBe(960);
  expect(result.done!.finalSnapshot.useTriggerLedger).toEqual([expect.objectContaining({ owner: 'target', useSource: 'target', useKey: 'aa1', target: null })]);
});

test('实际 Worker：目标范围状态使用声明的非零初值，按原命中目标记录额度', async ({ page }, testInfo) => {
  const program = syntheticWindow();
  const counter = program.internalStates[0]!;
  if (counter.stateType !== 'COUNTER') throw new Error('fixture');
  counter.scope = 'TARGET'; counter.detail.initialValue = fixedValue(5);
  for (const process of program.processes) for (const op of process.stateOperations) if (op.stateKey === 'hits' && op.operation === 'SET') op.value = fixedValue(5);
  for (const [index, rule] of program.rules.entries()) {
    rule.oncePerUse!.scope = 'TARGET';
    const condition = rule.conditionGroups[0]!.conditions[0]!;
    if (condition.conditionType !== 'INTERNAL_STATE_CHECK' || condition.detail.valueKind !== 'VALUE') throw new Error('fixture');
    condition.detail.comparisonValue = fixedValue(index === 0 ? 5 : 6);
  }
  const result = await runP6(page, { mode: 'window', program, durationMs: 300,
    uses: [{ useKey: 'u1', skillKey: 'author_q' }, { useKey: 'u2', skillKey: 'author_q' }],
    hits: [{ entryKey: 'h1', at: 0, useKey: 'u1' }, { entryKey: 'h2', at: 100, useKey: 'u2' }]
  });
  await assertNativeResult(result, testInfo);
  expect(providerState(result.done!, 'item:synth_window').targetState).toMatchObject({ target: 'target', values: { hits: 5 } });
  expect(result.done!.finalSnapshot.useTriggerLedger).toHaveLength(2);
  expect(result.done!.finalSnapshot.useTriggerLedger!.every(row => row.scope === 'provider_target' && row.target === 'target')).toBe(true);
  expect(result.done!.finalSnapshot.combatants.find(actor => actor.key === 'target')!.attributes.hp.current).toBe(960);
});

test('实际 Worker：限时护盾在第二次独立使用生效，到期边界不再吸收', async ({ page }, testInfo) => {
  const program = shieldWindow();
  const payload = { mode: 'window' as const, program,
    uses: [{ useKey: 'u1', skillKey: 'author_q' }, { useKey: 'u2', skillKey: 'author_q' }],
    hits: [{ entryKey: 'h1', at: 0, useKey: 'u1' }, { entryKey: 'h2', at: 100, useKey: 'u2' }]
  };
  const active = await runP6(page, { ...payload, durationMs: 300, incoming: [{ at: 200, amount: 40 }] });
  await assertNativeResult(active, testInfo);
  const source = active.done!.finalSnapshot.combatants.find(actor => actor.key === 'source')!;
  expect(source.attributes.hp.current).toBe(1000);
  expect(source.shields).toEqual([expect.objectContaining({ remaining: 110, expireAt: 2100 })]);
  const expired = await runP6(page, { ...payload, durationMs: 2200, incoming: [{ at: 200, amount: 40 }, { at: 2100, amount: 40 }] });
  await assertNativeResult(expired, testInfo);
  const after = expired.done!.finalSnapshot.combatants.find(actor => actor.key === 'source')!;
  expect(after.attributes.hp.current).toBe(960);
  expect(after.shields).toEqual([]);
});

test('原库星蚀普通护盾组成→GET→Worker，保留原公式与期限且不升格完整触发资格', async ({ page, request }, testInfo) => {
  test.skip(process.env.P6_LIVE_API !== '1', '显式启用后只读本地实际服务');
  const api = 'http://127.0.0.1:8080/api/admin/games/lol/skills/item_6692_passive';
  const headers = { Authorization: `Bearer ${process.env.DAMAGE_ADMIN_TOKEN || 'test'}` };
  const read = async (path: string) => {
    const response = await request.get(api + path, { headers }); expect(response.status(), path).toBe(200); return response.json();
  };
  const [effect, parameters, formulas] = await Promise.all([read('/effects/shield_melee'), read('/parameters'), read('/formulas')]);
  const program = shieldWindow(effect); program.parameters = parameters; program.formulas = formulas;
  const result = await runP6(page, { mode: 'window', program, durationMs: 300,
    uses: [{ useKey: 'u1', skillKey: 'author_q' }, { useKey: 'u2', skillKey: 'author_q' }],
    hits: [{ entryKey: 'h1', at: 0, useKey: 'u1' }, { entryKey: 'h2', at: 100, useKey: 'u2' }],
    incoming: [{ at: 200, amount: 40 }]
  });
  await assertNativeResult(result, testInfo);
  const source = result.done!.finalSnapshot.combatants.find(actor => actor.key === 'source')!;
  expect(source.attributes.hp.current).toBe(1000);
  expect(source.shields).toEqual([expect.objectContaining({ remaining: 110, expireAt: 2100 })]);
  expect(await read('/effects/shield_melee')).toEqual(effect);
  await testInfo.attach('原护盾组成与明确触发输入', { contentType: 'application/json', body: Buffer.from(JSON.stringify({ effect, parameters, formulas, done: result.done,
    boundary: '原库护盾、期限与数值直接参与运行；计数过程和两个合格使用为专项明确输入，不代表原装备多段与持续伤害资格已核定，不证明受到护盾修正。'
  }, null, 2)) });
});
