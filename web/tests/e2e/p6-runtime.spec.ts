import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import type { CompileRequest, DoneResult, EngineError } from '../../src/types/genericEngine';
import { fixedValue, formulaValue, parameterValue } from '../../src/types/numericValue';
import type { AuthoredTriggerProgram } from '../../src/engine/triggerAdapter';
import type { AuthoredHitProgram } from '../../src/engine/hitAdapter';
import type { SkillEffect } from '../../src/types/skillEffect';
import type { Skill } from '../../src/types/skill';
import type { SkillParameter } from '../../src/types/skillParameter';
import type { SkillFormula } from '../../src/types/skillFormula';
import type { SkillInternalState } from '../../src/types/skillInternalState';
import type { SkillProcess } from '../../src/types/skillProcess';
import type { SkillTriggerRuleDetail } from '../../src/types/skillTriggerRule';
import type { GameVampRulesResponse } from '../../src/types/gameVamp';
import type { StatusListResponse } from '../../src/types/status';
import type { ModifierZoneListResponse } from '../../src/types/modifierZone';
import { parseGameVampRules } from '../../src/services/gameVampClient';

const WASM_PATH = resolve('src/engine/wasm/tinygo_engine_v2.wasm');
const WASM_SHA256 = '25844991E66D5E189CEE0B168869DE07C265C5C3CC3336C7B1A9C793AC0D736D';
const WASM_BYTES = 983981;

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
          damageTypeKey: 'physics', deliveryKind: 'SKILL', originKind: 'DIRECT',
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
            damageTypeKey: 'physics', deliveryKind: 'BASIC_ATTACK', originKind: 'DIRECT',
            critical: { mode: 'DISALLOWED', multiplierValue: null }, vampQualification: 'RESOLVED', vampOverrides: []
          }
        },
        {
          resultKey: 'mana', name: 'mana', resultType: 'RESOURCE_CHANGE', target: 'SOURCE', description: null, sortOrder: 20,
          spellShieldBlockScope: null, lifecycleBehavior: null,
          valueRule: { value: formulaValue('total_mana_refund'), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
          detail: { attributeKey: 'mana', operation: 'RESTORE' }
        }
      ],
      createdAt: '', updatedAt: ''
    }],
    rules: [
      {
        ruleKey: 'arm', name: 'arm', description: 'synthetic', sortOrder: 10,
        eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: null, useKind: 'ACTIVE', castPhase: 'INITIAL' } },
        conditionGroups: [{
          groupKey: 'idle', name: 'idle', sortOrder: 10,
          conditions: [cooldownReady()]
        }],
        actions: [{
          actionKey: 'start', name: 'start', actionType: 'START_PROCESS', sortOrder: 10,
          targetContext: 'CURRENT_TARGET', detail: { processKey: 'spellblade' }, runtimeInputBindings: [], resultModifiers: []
        }],
        perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null
      }
    ]
  };
  const bonus = authored.effects[0]!;
  const refund = { ...bonus, effectKey: 'refund', name: 'refund', results: [bonus.results[1]!] };
  bonus.results = [bonus.results[0]!];
  authored.effects = [bonus, refund];
  authored.parameters = [{ gameId: 'lol', skillKey, parameterKey: 'mana_refund_damage_multiplier', name: '回蓝倍率', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.5, levelValues: null, description: null, sortOrder: 0, createdAt: '', updatedAt: '' }];
  authored.formulas = [{
    gameId: 'lol', skillKey, formulaKey: 'total_mana_refund', name: '回蓝', description: null, sortOrder: 0, createdAt: '', updatedAt: '',
    expression: { nodeType: 'OPERATION', operation: 'MULTIPLY', operands: [
      { nodeType: 'PARAMETER', parameterKey: 'mana_refund_damage_multiplier' },
      { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'attack_damage', attributeValueKind: 'TOTAL' }
    ] }
  }];
  authored.processes[0]!.effectBindings.push({ bindingKey: 'do_refund', effectKey: 'refund', moment: stepExec('aa'), sortOrder: 20 });
  for (const op of authored.processes[0]!.stateOperations) if (op.moment.momentType === 'STEP_EXECUTION') op.sortOrder += 10;
  return authored;
}

function dualEventWindow(): AuthoredTriggerProgram {
  const authored = syntheticWindow();
  const extra = authored.rules.map((rule, index) => ({
    ...structuredClone(rule),
    ruleKey: index === 0 ? 'aa_first' : 'aa_reward',
    sortOrder: 30 + index * 10,
    eventSource: { eventType: 'BASIC_ATTACK_HIT' as const, detail: {} }
  }));
  authored.rules = [...authored.rules, ...extra];
  return authored;
}

function refreshSpellblade(windowMs = 10000): AuthoredTriggerProgram {
  const authored = syntheticSpellblade();
  const step = authored.processes[0]!.steps[0]!;
  if (step.stepType !== 'EMPOWERED_BASIC_ATTACK') throw new Error('fixture');
  step.detail.windowValue = fixedValue(windowMs);
  return authored;
}

function formulaManaProgram(input: {
  skillKey: string;
  parameters: AuthoredTriggerProgram['parameters'];
  formulas: AuthoredTriggerProgram['formulas'];
  effect: SkillEffect;
}): AuthoredTriggerProgram {
  const authored = refreshSpellblade(10000);
  authored.skillKey = input.skillKey;
  for (const row of [...authored.processes, ...authored.internalStates]) row.skillKey = input.skillKey;
  const step = authored.processes[0]!.steps[0]!;
  if (step.stepType !== 'EMPOWERED_BASIC_ATTACK') throw new Error('fixture');
  step.detail.windowValue = parameterValue('spellblade_window_ms');
  authored.internalStates = authored.internalStates.map((state) => (
    state.stateType === 'INTERNAL_COOLDOWN'
      ? { ...state, skillKey: input.skillKey, detail: { durationValue: parameterValue('spellblade_cooldown_ms') } }
      : { ...state, skillKey: input.skillKey }
  ));
  authored.parameters = input.parameters;
  authored.formulas = input.formulas;
  authored.effects = [{ ...input.effect, skillKey: input.skillKey }];
  authored.vampRules = [];
  authored.skillCategoryKeys = [];
  authored.processes[0]!.effectBindings = [{ bindingKey: 'do_refund', effectKey: input.effect.effectKey, moment: stepExec('aa'), sortOrder: 10 }];
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
        { abilityKey: 'cast', kind: 'active', skillKey: 'champion_q', operations: [] }
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
  resumedDone?: DoneResult;
  consumedRestoredDone?: DoneResult;
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
  aaHits?: Array<{ entryKey: string; at: number; useKey: string }>;
  durationMs?: number;
  startCost?: number;
  startOnly?: boolean;
  startAt?: number;
  hitAt?: number;
  omitAttackUse?: boolean;
  program?: AuthoredTriggerProgram;
  input?: CompileRequest;
  incoming?: Array<{ at: number; amount: number }>;
  restore?: { state: Record<string, number>; expireAt: Record<string, number>; ledger: RestoreLedgerRow[] };
  secondRun?: boolean;
  initialCastAbilities?: Array<{ providerRef: string; abilityKey: string }>;
  casts?: Array<{ entryKey: string; abilityKey: string; at: number; skillKey: string; providerRef?: string; target?: 'source' | 'target' }>;
  additionalChampionMount?: string;
  rebindAbilities?: Array<{ providerRef: string; abilityKey: string }>;
  resumeEmpowered?: { startAt: number; hitAt: number; durationMs: number; restoreDurationMs: number; reopenAt: number };
  extraChampionAbilities?: Array<{ abilityKey: string; kind: string; skillKey?: string; types?: string[]; operations?: unknown[] }>;
  aaBodyDamage?: number;
  targetArmor?: number;
  targetShield?: { at: number; amount: number };
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
      }
      const authored = data.mode === 'window' ? authoredWindow : authoredBlade;
      const owner = authored.owner ?? 'source';
      const counterpart = owner === 'source' ? 'target' : 'source';
      const adapted = adaptTriggerProgram(authored);
      const hitAdapted = data.mode === 'window' ? adaptHitProgram(dummy) : null;
      let request = structuredClone(input);
      if (owner === 'target') for (const actor of request.combatants) actor.key = actor.key === 'source' ? 'target' : 'source';
      if (data.targetArmor != null) {
        const foe = request.combatants.find(actor => actor.key === counterpart)!;
        foe.attributes.armor = { base: data.targetArmor, current: data.targetArmor, max: data.targetArmor, resolved: data.targetArmor };
      }
      if (data.mode === 'window') {
        request = withHitProgram(request, { hitProviderKey: 'champion', hitAbilityKey: 'skill_hit', authored: dummy }, { rulesHash: 'with-p6-hit' });
        if (data.aaHits?.length) {
          const champion = request.sharedProviders![0]!;
          champion.abilities = [
            ...(champion.abilities ?? []),
            basicAttackStartAbility({ abilityKey: 'aa_start', skillKey: 'aa_basic' }),
            basicAttackHitAbility({ abilityKey: 'aa_hit', skillKey: 'aa_basic' })
          ];
          request.typeCatalog.types.push({ key: 'event/basic_attack_start', domain: 'event' }, { key: 'event/basic_attack_hit', domain: 'event' }, { key: 'ability/basic_attack', domain: 'ability' });
        }
      } else {
        const casts = data.casts ?? [{ entryKey: 'cast', abilityKey: 'cast', at: 0, skillKey: 'champion_q' }];
        const castAbilities = [...new Map(casts.map((row) => [row.abilityKey, {
          abilityKey: row.abilityKey, kind: 'active' as const, skillKey: row.skillKey, operations: [] as const
        }])).values()];
        const aaHit = basicAttackHitAbility({ abilityKey: 'aa_hit', skillKey: 'aa_basic' });
        const champion = request.sharedProviders![0]!;
        champion.abilities = [
          ...castAbilities,
          ...(data.extraChampionAbilities ?? []).filter((row) => !castAbilities.some((ability) => ability.abilityKey === row.abilityKey)) as typeof castAbilities,
          basicAttackStartAbility({
            abilityKey: 'aa_start', skillKey: 'aa_basic',
            ...(data.startCost != null ? { cost: { resourceKey: 'mana', amount: { op: 'const', value: data.startCost } } } : {})
          }),
          aaHit,
          ...(data.aaBodyDamage != null ? [{
            abilityKey: 'aa_body', kind: 'active' as const,
            operations: [{
              operation: 'damage', target: 'target', damageType: 'damage/physical',
              amount: { op: 'const', value: data.aaBodyDamage }, critEligible: false
            }]
          }] : [])
        ];
        request.typeCatalog.types.push({ key: 'event/basic_attack_start', domain: 'event' }, { key: 'event/basic_attack_hit', domain: 'event' }, { key: 'ability/basic_attack', domain: 'ability' });
      }
      if (data.additionalChampionMount) {
        request.combatants.find(actor => actor.key === owner)!.providers.push({
          providerRef: data.additionalChampionMount, definitionRef: 'champion'
        });
      }
      request = withTriggerProgram(request, {
        triggerProviderKey: `item:${authored.skillKey}`, authored,
        ...(data.mode === 'window' ? {} : {
          initialCastAbilities: data.initialCastAbilities ?? [{ providerRef: 'champion', abilityKey: (data.casts ?? [{ abilityKey: 'cast' }])[0]!.abilityKey }]
        })
      }, { rulesHash: 'with-p6' });
      if (data.rebindAbilities) {
        request = withTriggerProgram(request, {
          triggerProviderKey: `item:${authored.skillKey}`, authored,
          initialCastAbilities: data.rebindAbilities
        }, { rulesHash: 'with-p6-rebound' });
      }
      const defender = request.combatants.find(actor => actor.key === counterpart)!;
      if (data.incoming?.length) {
        defender.providers.push({ providerRef: 'incoming', definitionRef: 'incoming' });
        request.sharedProviders!.push({ providerKey: 'incoming', kind: 'champion', stableId: 'incoming', abilities: data.incoming.map((hit, index) => ({
          abilityKey: `hit_${index}`, kind: 'active', operations: [{ operation: 'damage', target: 'target', damageType: 'damage/physical', amount: { op: 'const', value: hit.amount } }]
        })) });
      }
      if (data.targetShield) {
        defender.providers.push({ providerRef: 'pre_shield', definitionRef: 'pre_shield' });
        request.sharedProviders!.push({
          providerKey: 'pre_shield', kind: 'champion', stableId: 'pre_shield',
          abilities: [{
            abilityKey: 'apply_shield', kind: 'active',
            operations: [{
              operation: 'shield', target: 'self', shieldRef: 'synth_aa_block',
              shieldDurationMs: { op: 'const', value: 8000 }, amount: { op: 'const', value: data.targetShield.amount }
            }]
          }]
        });
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
        const casts = data.mode === 'window' ? [] : (data.casts ?? [{ entryKey: 'cast', abilityKey: 'cast', at: 0, skillKey: 'champion_q' }]);
        const uses = [
          ...casts.map((row) => provenTriggerUse({ useKey: row.entryKey, source: owner, skillKey: row.skillKey })),
          ...(data.uses ?? []).map((row) => provenSkillUseFact({ useKey: row.useKey, source: owner, skillKey: row.skillKey }))
        ];
        if (!data.omitAttackUse && (data.mode !== 'window' || data.aaHits?.length)) {
          uses.push(provenTriggerUse({ useKey: 'aa1', source: owner, skillKey: 'aa_basic' }));
          for (const useKey of new Set((data.aaHits ?? []).map(row => row.useKey))) {
            if (useKey !== 'aa1') uses.push(provenTriggerUse({ useKey, source: owner, skillKey: 'aa_basic' }));
          }
        }
        const bladeHits = data.startOnly ? [] : (data.aaHits ?? [{ entryKey: 'hit', at: data.hitAt ?? 20, useKey: 'aa1' }]);
        const hits = data.mode === 'window'
          ? [
              ...(data.hits ?? []).map((row) => skillHitFact(row.entryKey, row.useKey)),
              ...(data.aaHits ?? []).map((row) => skillHitFact(row.entryKey, row.useKey))
            ]
          : bladeHits.map(row => skillHitFact(row.entryKey, row.useKey));
        const startAt = data.startAt ?? 10;
        const hitAt = data.hitAt ?? 20;
        const entries = data.mode === 'window'
          ? [
              ...(data.hits ?? []).map((row) => ({
                entryKey: row.entryKey, abilityRef: `${owner}.provider[champion].ability[skill_hit]`,
                source: owner, target: counterpart, firstAtMs: row.at
              })),
              ...(data.aaHits ?? []).map((row) => ({
                entryKey: row.entryKey, abilityRef: `${owner}.provider[champion].ability[aa_hit]`,
                source: owner, target: counterpart, firstAtMs: row.at
              }))
            ]
          : [
              ...casts.map((row) => ({
                entryKey: row.entryKey, abilityRef: `${owner}.provider[${row.providerRef ?? 'champion'}].ability[${row.abilityKey}]`,
                source: owner, target: row.target ?? counterpart, firstAtMs: row.at
              })),
              { entryKey: 'start', abilityRef: `${owner}.provider[champion].ability[aa_start]`, source: owner, target: counterpart, firstAtMs: startAt },
              ...(data.aaBodyDamage != null && !data.startOnly ? [{ entryKey: 'aa_body', abilityRef: `${owner}.provider[champion].ability[aa_body]`, source: owner, target: counterpart, firstAtMs: hitAt }] : []),
              ...bladeHits.map(row => ({ entryKey: row.entryKey, abilityRef: `${owner}.provider[champion].ability[aa_hit]`, source: owner, target: counterpart, firstAtMs: row.at }))
            ];
        entries.push(...(data.incoming ?? []).map((hit, index) => ({ entryKey: `incoming_${index}`, abilityRef: `${counterpart}.provider[incoming].ability[hit_${index}]`, source: counterpart, target: owner, firstAtMs: hit.at })));
        if (data.targetShield) {
          entries.push({
            entryKey: 'pre_shield', abilityRef: `${counterpart}.provider[pre_shield].ability[apply_shield]`,
            source: counterpart, target: owner, firstAtMs: data.targetShield.at
          });
        }
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
          sessionId: compiled.sessionId, expectedRulesHash: request.rulesHash, schemaVersion: request.schemaVersion,
          schemaHash: request.schemaHash, rulesHash: request.rulesHash,
          initialSnapshot: {
            schemaHash: request.schemaHash, rulesHash: request.rulesHash, timeMs: 0,
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
        let resumedDone: DoneResult | undefined;
        let consumedRestoredDone: DoneResult | undefined;
        if (data.resumeEmpowered) {
          const resume = data.resumeEmpowered;
          resumedDone = await client.run({
            ...runBody, initialSnapshot: done.finalSnapshot,
            driverPlan: { entries: [
              { entryKey: 'resume_start', abilityRef: `${owner}.provider[champion].ability[aa_start]`, source: owner, target: counterpart, firstAtMs: resume.startAt },
              { entryKey: 'resume_hit', abilityRef: `${owner}.provider[champion].ability[aa_hit]`, source: owner, target: counterpart, firstAtMs: resume.hitAt }
            ] },
            stopPolicy: { ...runBody.stopPolicy, durationMs: resume.durationMs },
            skillUses: [provenTriggerUse({ useKey: 'resume_aa', source: owner, skillKey: 'aa_basic' })],
            skillHitFacts: [skillHitFact('resume_hit', 'resume_aa')],
            attackStartFacts: [attackStartFact('resume_start', 'resume_aa')]
          });
          consumedRestoredDone = await client.run({
            ...runBody, initialSnapshot: resumedDone.finalSnapshot,
            driverPlan: { entries: [
              { entryKey: 'restore_cast', abilityRef: `${owner}.provider[champion].ability[${casts[0]!.abilityKey}]`, source: owner, target: owner, firstAtMs: resume.reopenAt },
              { entryKey: 'old_hit', abilityRef: `${owner}.provider[champion].ability[aa_hit]`, source: owner, target: counterpart, firstAtMs: resume.reopenAt + 1 }
            ] },
            stopPolicy: { ...runBody.stopPolicy, durationMs: resume.restoreDurationMs },
            skillUses: [
              provenTriggerUse({ useKey: 'restore_cast', source: owner, skillKey: casts[0]!.skillKey }),
              provenTriggerUse({ useKey: 'resume_aa', source: owner, skillKey: 'aa_basic' })
            ],
            skillHitFacts: [skillHitFact('old_hit', 'resume_aa')], attackStartFacts: []
          });
        }
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
        const released = await client.release(compiled.sessionId, request.rulesHash);
        return {
          adapted: {
            combo: adapted.combo, oncePerUse: adapted.oncePerUse, consumeEvent: adapted.consumeEvent,
            outputRef: adapted.provider.abilities?.at(-1)?.listenerSpec?.operations?.[0]?.outputRef
          },
          compileOk: true, done, secondDone, resumedDone, consumedRestoredDone, released: released.released, hitAdapted: hitAdapted?.resolveKind
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
  }, { ...payload, window: syntheticWindow(), blade: syntheticSpellblade(), dummy: dummyHit(), input: payload.input ?? baseRequest() });
}

function providerState(done: DoneResult, providerRef: string): Record<string, unknown> {
  const source = done.finalSnapshot.combatants.find((row) => row.key === 'source')!;
  return (source.providerState[providerRef] ?? {}) as Record<string, unknown>;
}

async function assertNativeResult(result: WorkerResult, testInfo: import('@playwright/test').TestInfo): Promise<void> {
  if (!result.compileOk || result.runError || !result.done) {
    await testInfo.attach('p6-native-failure', { contentType: 'application/json', body: Buffer.from(JSON.stringify(result, null, 2)) });
  }
  expect(result.adapterError).toBeUndefined();
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
  expect(result.adapted?.outputRef).toBeUndefined();
  await assertNativeResult(result, testInfo);
  const bag = providerState(result.done!, 'item:synth_spellblade');
  const state = (bag.state ?? {}) as Record<string, number>;
  expect(state.ready).toBe(0);
  expect(state.icd).toBe(1);
  const source = result.done!.finalSnapshot.combatants.find((row) => row.key === 'source')!;
  expect(source.resources.mana.current).toBe(50);
  expect(result.done!.evidence.items.some((item) => item.kind === 'emitted_event' && item.ref === 'event/basic_attack_start')).toBe(true);
  expect(result.done!.evidence.items.some((item) => item.kind === 'emitted_event' && item.ref === 'event/basic_attack_hit')).toBe(true);
  expect(result.done!.evidence.items.some((item) => item.kind === 'emitted_event' && item.ref === 'event/skill_hit')).toBe(false);
});

test('实际 Worker：普攻开始门禁失败不消费 ready', async ({ page }, testInfo) => {
  const result = await runP6(page, { mode: 'spellblade', startCost: 50, startOnly: true, durationMs: 100 });
  expect(result.adapterError).toBeUndefined();
  expect(result.adapted?.consumeEvent).toBe('event/basic_attack_hit');
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

test('实际 Worker：ATTACK_START 按字段拒绝，普通攻击发起不得提前伤害或回蓝', async ({ page }, testInfo) => {
  const start = await runP6(page, { mode: 'spellblade-start', durationMs: 15, startOnly: true });
  expect(start.adapterError).toContain('processes.spellblade.steps.aa.detail.consumeMoment');
  expect(start.compileOk).toBeUndefined();
  const hit = await runP6(page, { mode: 'spellblade', durationMs: 15, startOnly: true });
  await assertNativeResult(hit, testInfo);
  expect(hit.done!.finalSnapshot.combatants.find(actor => actor.key === 'source')!.resources.mana.current).toBe(0);
  expect(hit.done!.finalSnapshot.combatants.find(actor => actor.key === 'target')!.attributes.hp.current).toBe(1000);
  expect(hit.done!.evidence.items.some(item => item.kind === 'damage')).toBe(false);
  expect(providerState(hit.done!, 'item:synth_spellblade').state).toMatchObject({ ready: 1, icd: 0 });
});

test('实际 Worker：反向拥有者的回蓝、命中与同次使用账本归属一致', async ({ page }, testInfo) => {
  const program = syntheticSpellblade(); program.owner = 'target';
  const result = await runP6(page, { mode: 'spellblade', program, durationMs: 100 });
  await assertNativeResult(result, testInfo);
  const owner = result.done!.finalSnapshot.combatants.find(actor => actor.key === 'target')!;
  expect(owner.resources.mana.current).toBe(50);
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
  const [effect, parameters, formulaRows] = await Promise.all([read('/effects/shield_melee'), read('/parameters'), read('/formulas')]);
  const formulas = await Promise.all(formulaRows.map((row: { formulaKey: string }) => read(`/formulas/${row.formulaKey}`)));
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

const twoSkills = {
  initialCastAbilities: [
    { providerRef: 'champion', abilityKey: 'q' },
    { providerRef: 'champion', abilityKey: 'w' }
  ],
  extraChampionAbilities: [{ abilityKey: 'e', kind: 'active', skillKey: 'champion_e', operations: [] }]
};

test('实际 Worker：技能与普攻四种命中组合，同 use 多段与跳伤只计一次', async ({ page }, testInfo) => {
  const program = dualEventWindow();
  const skillThenAa = await runP6(page, {
    mode: 'window', program,
    uses: [{ useKey: 'u1', skillKey: 'author_q' }],
    hits: [{ entryKey: 'h1', at: 0, useKey: 'u1' }],
    aaHits: [{ entryKey: 'aa1', at: 100, useKey: 'aa1' }]
  });
  await assertNativeResult(skillThenAa, testInfo);
  expect(providerState(skillThenAa.done!, 'item:synth_window').state).toMatchObject({ hits: 0, icd: 1 });
  expect(skillThenAa.done!.finalSnapshot.combatants.find(actor => actor.key === 'target')!.attributes.hp.current).toBe(960);

  const aaThenSkill = await runP6(page, {
    mode: 'window', program,
    uses: [{ useKey: 'u1', skillKey: 'author_q' }],
    aaHits: [{ entryKey: 'aa1', at: 0, useKey: 'aa1' }],
    hits: [{ entryKey: 'h1', at: 100, useKey: 'u1' }]
  });
  await assertNativeResult(aaThenSkill, testInfo);
  expect(providerState(aaThenSkill.done!, 'item:synth_window').state).toMatchObject({ hits: 0, icd: 1 });

  const multiThenAa = await runP6(page, {
    mode: 'window', program,
    uses: [{ useKey: 'u1', skillKey: 'author_q' }],
    hits: [
      { entryKey: 'h1', at: 0, useKey: 'u1' },
      { entryKey: 'h2', at: 40, useKey: 'u1' }
    ],
    aaHits: [{ entryKey: 'aa1', at: 100, useKey: 'aa1' }]
  });
  await assertNativeResult(multiThenAa, testInfo);
  expect(providerState(multiThenAa.done!, 'item:synth_window').state).toMatchObject({ hits: 0, icd: 1 });
  expect(multiThenAa.done!.finalSnapshot.useTriggerLedger?.filter(row => row.useKey === 'u1')).toHaveLength(1);

  const sameUseOnly = await runP6(page, {
    mode: 'window', program, durationMs: 300,
    uses: [{ useKey: 'dot1', skillKey: 'author_q' }],
    hits: [
      { entryKey: 'h1', at: 0, useKey: 'dot1' },
      { entryKey: 'h2', at: 50, useKey: 'dot1' }
    ]
  });
  await assertNativeResult(sameUseOnly, testInfo);
  expect(providerState(sameUseOnly.done!, 'item:synth_window').state).toMatchObject({ hits: 1, icd: 0 });
});

test('实际 Worker：单组启动在9000刷新，旧期限无效且19000到期', async ({ page }, testInfo) => {
  const armed = await runP6(page, {
    mode: 'spellblade', program: refreshSpellblade(10000), durationMs: 10000, startOnly: true,
    ...twoSkills,
    casts: [
      { entryKey: 'cast_q', abilityKey: 'q', at: 0, skillKey: 'champion_q' },
      { entryKey: 'cast_w', abilityKey: 'w', at: 9000, skillKey: 'champion_w' }
    ]
  });
  await assertNativeResult(armed, testInfo);
  const armedBag = providerState(armed.done!, 'item:synth_spellblade');
  expect(armedBag.state).toMatchObject({ ready: 1, icd: 0 });
  expect(armedBag.expireAt).toMatchObject({ ready: 19000 });

  const consumed = await runP6(page, {
    mode: 'spellblade', program: refreshSpellblade(10000), durationMs: 12000,
    startAt: 11000, hitAt: 11000,
    ...twoSkills,
    casts: [
      { entryKey: 'cast_q', abilityKey: 'q', at: 0, skillKey: 'champion_q' },
      { entryKey: 'cast_w', abilityKey: 'w', at: 9000, skillKey: 'champion_w' }
    ]
  });
  await assertNativeResult(consumed, testInfo);
  expect(providerState(consumed.done!, 'item:synth_spellblade')).toMatchObject({ state: { ready: 0, icd: 1 }, expireAt: { icd: 12500 } });
  expect(consumed.done!.finalSnapshot.combatants.find(actor => actor.key === 'source')!.resources.mana.current).toBe(50);
  expect(consumed.done!.finalSnapshot.combatants.find(actor => actor.key === 'target')!.attributes.hp.current).toBe(960);
  expect(consumed.done!.evidence.items.filter(item => item.kind === 'damage')).toHaveLength(1);

  const timeout = await runP6(page, {
    mode: 'spellblade', program: refreshSpellblade(10000), durationMs: 19000, startOnly: true,
    ...twoSkills,
    casts: [
      { entryKey: 'cast_q', abilityKey: 'q', at: 0, skillKey: 'champion_q' },
      { entryKey: 'cast_w', abilityKey: 'w', at: 9000, skillKey: 'champion_w' }
    ]
  });
  await assertNativeResult(timeout, testInfo);
  expect(providerState(timeout.done!, 'item:synth_spellblade').state).toMatchObject({ ready: 0, icd: 0 });
});

test('实际 Worker：未绑定主动施法不刷新，真实 use 与 owner 保持', async ({ page }, testInfo) => {
  const result = await runP6(page, {
    mode: 'spellblade', program: refreshSpellblade(10000), durationMs: 10500, startOnly: true,
    initialCastAbilities: [{ providerRef: 'champion', abilityKey: 'q' }],
    extraChampionAbilities: [{ abilityKey: 'e', kind: 'active', skillKey: 'champion_e', operations: [] }],
    casts: [
      { entryKey: 'cast_q', abilityKey: 'q', at: 0, skillKey: 'champion_q' },
      { entryKey: 'cast_e', abilityKey: 'e', at: 9000, skillKey: 'champion_e' }
    ]
  });
  await assertNativeResult(result, testInfo);
  expect(providerState(result.done!, 'item:synth_spellblade').state).toMatchObject({ ready: 0, icd: 0 });
  expect(result.done!.finalSnapshot.useTriggerLedger ?? []).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ useSkillKey: 'item_passive' })])
  );
  const qUse = result.done!.evidence.items.some(item => item.kind === 'emitted_event' && item.ref === 'event/ability_started');
  expect(qUse).toBe(true);
});

test('实际 Worker：待命恢复可消费，消费后恢复重开仍拒绝旧命中', async ({ page }, testInfo) => {
  const result = await runP6(page, {
    mode: 'spellblade', program: refreshSpellblade(10000), durationMs: 10500, startOnly: true,
    ...twoSkills,
    casts: [
      { entryKey: 'q0', abilityKey: 'q', at: 0, skillKey: 'champion_q' },
      { entryKey: 'w9', abilityKey: 'w', at: 9000, skillKey: 'champion_w' }
    ],
    resumeEmpowered: { startAt: 10900, hitAt: 11000, durationMs: 1000, restoreDurationMs: 2000, reopenAt: 12500 }
  });
  await assertNativeResult(result, testInfo);
  expect(providerState(result.done!, 'item:synth_spellblade')).toMatchObject({ state: { ready: 1, icd: 0 }, expireAt: { ready: 19000 } });
  expect(result.resumedDone).toBeDefined();
  const consumed = providerState(result.resumedDone!, 'item:synth_spellblade');
  expect(consumed).toMatchObject({ state: { ready: 0, icd: 1 }, expireAt: { icd: 12500 } });
  expect((consumed.expireAt as Record<string, number>).ready ?? 0).toBe(0);
  expect(result.consumedRestoredDone).toBeDefined();
  expect(providerState(result.consumedRestoredDone!, 'item:synth_spellblade')).toMatchObject({ state: { ready: 1, icd: 0 }, expireAt: { ready: 22500 } });
  expect(result.consumedRestoredDone!.finalSnapshot.combatants.find(actor => actor.key === 'source')!.resources.mana.current).toBe(50);
  expect(result.consumedRestoredDone!.finalSnapshot.combatants.find(actor => actor.key === 'target')!.attributes.hp.current).toBe(960);
  expect(result.consumedRestoredDone!.evidence.items.filter(item => item.kind === 'damage')).toHaveLength(0);
  expect(result.consumedRestoredDone!.finalSnapshot.useTriggerLedger).toEqual([
    expect.objectContaining({ owner: 'source', providerRef: 'item:synth_spellblade', groupKey: 'spellblade', useKey: 'resume_aa' })
  ]);
});

test('实际 Worker：实际普攻目标决定结算，同次重复及重开后的旧事件不能再消费', async ({ page }, testInfo) => {
  const result = await runP6(page, {
    mode: 'spellblade', program: refreshSpellblade(), durationMs: 13000, startAt: 10900,
    casts: [
      { entryKey: 'cast0', abilityKey: 'cast', at: 0, skillKey: 'champion_q', target: 'source' },
      { entryKey: 'cast9', abilityKey: 'cast', at: 9000, skillKey: 'champion_q', target: 'source' },
      { entryKey: 'reopen', abilityKey: 'cast', at: 12500, skillKey: 'champion_q', target: 'source' }
    ],
    aaHits: [
      { entryKey: 'hit', at: 11000, useKey: 'aa1' },
      { entryKey: 'same_time_repeat', at: 11000, useKey: 'aa1' },
      { entryKey: 'repeat', at: 11001, useKey: 'aa1' },
      { entryKey: 'old_after_reopen', at: 12501, useKey: 'aa1' }
    ]
  });
  await assertNativeResult(result, testInfo);
  expect(result.done!.finalSnapshot.combatants.find(actor => actor.key === 'source')!.resources.mana.current).toBe(50);
  expect(result.done!.finalSnapshot.combatants.find(actor => actor.key === 'target')!.attributes.hp.current).toBe(960);
  expect(result.done!.evidence.items.filter(item => item.kind === 'damage')).toHaveLength(1);
  expect(providerState(result.done!, 'item:synth_spellblade')).toMatchObject({ state: { ready: 1, icd: 0 }, expireAt: { ready: 22500 } });
  expect(result.done!.finalSnapshot.useTriggerLedger).toEqual([
    expect.objectContaining({ owner: 'source', providerRef: 'item:synth_spellblade', groupKey: 'spellblade', scope: 'provider', useKey: 'aa1' })
  ]);
});

test('实际 Worker：刷新期限同刻的普攻已过期，缺真实使用事实拒绝运行', async ({ page }, testInfo) => {
  const expired = await runP6(page, {
    mode: 'spellblade', program: refreshSpellblade(), durationMs: 19000, startAt: 18900, hitAt: 19000,
    casts: [
      { entryKey: 'cast0', abilityKey: 'cast', at: 0, skillKey: 'champion_q' },
      { entryKey: 'cast9', abilityKey: 'cast', at: 9000, skillKey: 'champion_q' }
    ]
  });
  await assertNativeResult(expired, testInfo);
  expect(expired.done!.finalSnapshot.combatants.find(actor => actor.key === 'source')!.resources.mana.current).toBe(0);
  expect(expired.done!.finalSnapshot.combatants.find(actor => actor.key === 'target')!.attributes.hp.current).toBe(1000);
  expect(providerState(expired.done!, 'item:synth_spellblade').state).toMatchObject({ ready: 0, icd: 0 });
  const missing = await runP6(page, { mode: 'spellblade', durationMs: 100, omitAttackUse: true });
  expect(missing.compileOk).toBe(true);
  expect(missing.runError).toMatch(/useRef|使用|skillUses/);
  expect(missing.done).toBeUndefined();
});

test('实际 Worker：同定义另一个挂载未绑定时不能刷新窗口', async ({ page }, testInfo) => {
  const result = await runP6(page, {
    mode: 'spellblade', program: refreshSpellblade(10000), durationMs: 10500, startOnly: true,
    additionalChampionMount: 'champion_alt',
    initialCastAbilities: [{ providerRef: 'champion', abilityKey: 'q' }],
    casts: [
      { entryKey: 'q0', abilityKey: 'q', at: 0, skillKey: 'champion_q' },
      { entryKey: 'other_q9', providerRef: 'champion_alt', abilityKey: 'q', at: 9000, skillKey: 'champion_q' }
    ]
  });
  await assertNativeResult(result, testInfo);
  expect(providerState(result.done!, 'item:synth_spellblade').state).toMatchObject({ ready: 0, icd: 0 });
});

test('实际 Worker：重新绑定W后，旧Q入口不能刷新窗口', async ({ page }, testInfo) => {
  const result = await runP6(page, {
    mode: 'spellblade', program: refreshSpellblade(10000), durationMs: 10500, startOnly: true,
    initialCastAbilities: [{ providerRef: 'champion', abilityKey: 'q' }],
    rebindAbilities: [{ providerRef: 'champion', abilityKey: 'w' }],
    casts: [
      { entryKey: 'w0', abilityKey: 'w', at: 0, skillKey: 'champion_w' },
      { entryKey: 'q9', abilityKey: 'q', at: 9000, skillKey: 'champion_q' }
    ]
  });
  await assertNativeResult(result, testInfo);
  expect(providerState(result.done!, 'item:synth_spellblade').state).toMatchObject({ ready: 0, icd: 0 });
});

test('原库夺萃回蓝组成→GET→Worker，护甲与护盾扣血不同但回蓝相同', async ({ page, request }, testInfo) => {
  test.skip(process.env.P6_LIVE_API !== '1', '显式启用后只读本地实际服务');
  const api = 'http://127.0.0.1:8080/api/admin/games/lol/skills/item_3508_passive';
  const headers = { Authorization: `Bearer ${process.env.DAMAGE_ADMIN_TOKEN || 'test'}` };
  const read = async (path: string) => {
    const response = await request.get(api + path, { headers }); expect(response.status(), path).toBe(200); return response.json();
  };
  const [parameters, formulaRows, effect] = await Promise.all([
    read('/parameters'), read('/formulas'), read('/effects/total_mana_refund')
  ]);
  const formula = await read('/formulas/total_mana_refund');
  expect(parameters.find((row: { parameterKey: string }) => row.parameterKey === 'spellblade_window_ms')?.fixedValue).toBe(10000);
  expect(parameters.find((row: { parameterKey: string }) => row.parameterKey === 'mana_refund_damage_multiplier')?.fixedValue).toBe(0.5);
  expect(formula.expression).toEqual({
    nodeType: 'OPERATION', operation: 'MULTIPLY',
    operands: [
      { nodeType: 'PARAMETER', parameterKey: 'mana_refund_damage_multiplier' },
      { attributeKey: 'attack_damage', attributeOwner: 'SOURCE', attributeValueKind: 'TOTAL', nodeType: 'ATTRIBUTE' }
    ]
  });
  const program = formulaManaProgram({
    skillKey: 'item_3508_passive', parameters, formulas: [formula], effect
  });
  const runLive = (extra: Parameters<typeof runP6>[1]) => runP6(page, {
    mode: 'spellblade', program, durationMs: 100, aaBodyDamage: 100,
    initialCastAbilities: [{ providerRef: 'champion', abilityKey: 'cast' }],
    ...extra
  });
  const plain = await runLive({});
  await assertNativeResult(plain, testInfo);
  const armored = await runLive({ targetArmor: 100 });
  await assertNativeResult(armored, testInfo);
  const shielded = await runLive({ targetShield: { at: 0, amount: 40 } });
  await assertNativeResult(shielded, testInfo);
  const hp = (result: WorkerResult) => result.done!.finalSnapshot.combatants.find(actor => actor.key === 'target')!.attributes.hp.current;
  const mana = (result: WorkerResult) => result.done!.finalSnapshot.combatants.find(actor => actor.key === 'source')!.resources.mana.current;
  expect(hp(plain)).toBe(900);
  expect(hp(armored)).toBe(950);
  expect(hp(shielded)).toBe(940);
  expect(hp(plain)).not.toBe(hp(armored));
  expect(hp(plain)).not.toBe(hp(shielded));
  expect(mana(plain)).toBe(50);
  expect(mana(armored)).toBe(50);
  expect(mana(shielded)).toBe(50);
  expect(providerState(plain.done!, 'item:item_3508_passive').state).toMatchObject({ ready: 0, icd: 1 });
  expect(formulaRows.some((row: { formulaKey: string }) => row.formulaKey === 'spellblade_damage')).toBe(true);
  await testInfo.attach('原回蓝组成与核定过程专项', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
    parameters, formula, effect, plainHp: hp(plain), armoredHp: hp(armored), shieldedHp: hp(shielded), mana: mana(plain),
    boundary: '这是原回蓝组成加合成过程专项，不是原完整装备已完成。主体伤害为显式合成原生普攻输入；本专项没有读取或运行原 spellblade_damage，也没有读取或运行星蚀伤害，不评价它们当前的吸血资格或完整运行状态。'
  }, null, 2)) });
});

const liveSpellbladeScenarios = [
  { skillKey: 'item_3508_passive', name: '夺萃', parameterCount: 5, effectCount: 2, formulaCount: 2, rawDamage: 145, manaRestored: 90 },
  { skillKey: 'item_3057_passive', name: '耀光', parameterCount: 3, effectCount: 1, formulaCount: 1, rawDamage: 100, manaRestored: 0 }
] as const;

// 两英雄属性与事件驱动是显式场景输入，装备的所有作者配置及吸血规则必须来自实际 GET。
// 本专项只运行咒刃附伤；普通攻击主体伤害未加入，不能据此声称一次普攻或整装备完整战斗。
const liveSpellbladeInput = {
  sourceBaseAd: 100, sourceTotalAd: 180, sourceCriticalChance: 0.4,
  sourceHp: 100, sourceMaxHp: 500, sourceMana: 0, sourceMaxMana: 200,
  targetBaseAd: 80, targetTotalAd: 80, targetCriticalChance: 0,
  targetHp: 1000, targetMaxHp: 1000, targetArmor: 100,
  lifeSteal: 0.1, omnivamp: 0.2, physicalVamp: 0, spellVamp: 0,
  castAt: 0, refreshAt: 9000, attackStartAt: 10900, attackHitAt: 11000
};

async function readLiveSpellblade(
  request: APIRequestContext,
  testInfo: TestInfo,
  scenario: typeof liveSpellbladeScenarios[number]
): Promise<AuthoredTriggerProgram> {
  if (process.env.P6_LIVE_API !== '1') throw new Error('正式配置预检未启用：需要显式 P6_LIVE_API=1');
  const root = '/api/admin/games/lol';
  const skillRoute = `${root}/skills/${scenario.skillKey}`;
  const snapshots = new Map<string, unknown>();
  const audit: Array<{ route: string; status: number }> = [];
  const headers = { Authorization: `Bearer ${process.env.DAMAGE_ADMIN_TOKEN || 'test'}` };
  const read = async <T,>(route: string): Promise<T> => {
    const response = await request.get(`http://127.0.0.1:8080${route}`, { headers });
    audit.push({ route, status: response.status() });
    if (response.status() !== 200) throw new Error(`正式配置未就绪：GET ${route} 返回 ${response.status()}`);
    const body: unknown = await response.json();
    if (snapshots.has(route)) expect(body, `读取期间配置改变：${route}`).toEqual(snapshots.get(route));
    else snapshots.set(route, body);
    return body as T;
  };
  const details = async <T,>(collection: string, key: string): Promise<T[]> => {
    const route = `${skillRoute}/${collection}`;
    const rows = await read<Array<Record<string, string>>>(route);
    expect(Array.isArray(rows), `正式配置未就绪：${route} 不是完整列表`).toBe(true);
    const keys = rows.map(row => row[key]);
    expect(keys.every(value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value)), `${route} 缺稳定标识`).toBe(true);
    expect(new Set(keys).size, `${route} 稳定标识重复`).toBe(keys.length);
    return Promise.all(keys.map(value => read<T>(`${route}/${encodeURIComponent(value)}`)));
  };
  try {
    const [skill, parameters, formulas, effects, processes, internalStates, rules, vampResponse, statuses, zones] = await Promise.all([
      read<Skill>(skillRoute),
      details<SkillParameter>('parameters', 'parameterKey'),
      details<SkillFormula>('formulas', 'formulaKey'),
      details<SkillEffect>('effects', 'effectKey'),
      details<SkillProcess>('processes', 'processKey'),
      details<SkillInternalState>('internal-states', 'stateKey'),
      details<SkillTriggerRuleDetail>('trigger-rules', 'ruleKey'),
      read<GameVampRulesResponse>(`${root}/vamp-rules`),
      read<StatusListResponse>(`${root}/statuses`),
      read<ModifierZoneListResponse>(`${root}/modifier-zones`)
    ]);
    expect(skill, '正式技能未就绪').toMatchObject({ gameId: 'lol', skillKey: scenario.skillKey, status: 'ENABLED', maxLevel: 1 });
    expect(skill.skillCategoryKeys, '保留正式被动分类，不伪装成普通攻击分类').toEqual(['passive']);
    expect(parameters, '正式参数未全部就绪').toHaveLength(scenario.parameterCount);
    expect(formulas, '正式公式未全部就绪').toHaveLength(scenario.formulaCount);
    expect(effects, '正式效果未全部就绪').toHaveLength(scenario.effectCount);
    expect(internalStates, '正式待命与内部冷却尚未完整保存').toHaveLength(2);
    expect(processes, '正式单强化步骤过程尚未完整保存').toHaveLength(1);
    expect(rules, '正式单启动规则尚未完整保存').toHaveLength(1);
    expect(parameters.find(row => row.parameterKey === 'spellblade_window_ms')).toMatchObject({ valueMode: 'FIXED', valueType: 'INTEGER', fixedValue: 10000 });
    expect(parameters.find(row => row.parameterKey === 'spellblade_cooldown_ms')).toMatchObject({ valueMode: 'FIXED', valueType: 'INTEGER', fixedValue: 1500 });
    expect(processes[0]).toMatchObject({ activationType: 'ACTIVE', cooldown: null });
    expect(processes[0]!.steps).toHaveLength(1);
    expect(processes[0]!.steps[0]).toMatchObject({ stepType: 'EMPOWERED_BASIC_ATTACK', detail: { consumeMoment: 'ATTACK_HIT' } });
    expect(processes[0]!.effectBindings.map(row => row.effectKey).sort()).toEqual(effects.map(row => row.effectKey).sort());
    expect(rules[0]!.eventSource).toEqual({ eventType: 'SKILL_USED', detail: { sourceSkillKey: null, useKind: 'ACTIVE', castPhase: 'INITIAL' } });
    const damage = effects.flatMap(effect => effect.results).filter(result => result.resultType === 'DAMAGE');
    expect(damage, '必须运行唯一正式附伤结果').toHaveLength(1);
    expect(damage[0]!.detail, '正式物理普攻附伤资格或例外尚未就绪').toMatchObject({
      damageTypeKey: 'physics', deliveryKind: 'BASIC_ATTACK', originKind: 'DIRECT', vampQualification: 'RESOLVED'
    });
    expect(damage[0]!.detail.vampOverrides, '保留生命偷取必要覆盖，全能吸血继承').toEqual([
      { vampType: 'LIFE_STEAL', mode: 'OVERRIDE', basisOutputKind: 'POST_DEFENSE_DAMAGE', efficiencyValue: { kind: 'FIXED', value: 1 } }
    ]);
    const vamp = parseGameVampRules(vampResponse).rules;
    const lifeSteal = vamp.find(row => row.vampType === 'LIFE_STEAL');
    const omnivamp = vamp.find(row => row.vampType === 'OMNIVAMP');
    expect(lifeSteal, '缺实际游戏生命偷取规则').toBeDefined();
    expect(lifeSteal!.skillCategoryKeys, '本场景必须由结果覆盖补足被动分类资格').not.toContain('passive');
    expect(omnivamp, '缺实际游戏全能吸血规则').toMatchObject({ basisOutputKind: 'POST_DEFENSE_DAMAGE', defaultEfficiency: 1 });
    expect(omnivamp!.skillCategoryKeys).toContain('passive');
    expect(omnivamp!.deliveryKinds).toContain('BASIC_ATTACK');
    expect(omnivamp!.originKinds).toContain('DIRECT');
    const damageDirectory = await read<{ status: string; damageTypeKey: string }>(`${root}/damage-types/physics`);
    expect(damageDirectory).toMatchObject({ damageTypeKey: 'physics', status: 'ENABLED' });
    for (const key of skill.skillCategoryKeys) {
      expect(await read<{ status: string }>(`${root}/skill-categories/${key}`)).toMatchObject({ status: 'ENABLED' });
    }
    expect(statuses.items).toHaveLength(statuses.total);
    expect(zones.items).toHaveLength(zones.total);
    // 第二轮逐路由回读，拒绝把同时变化的配置拼成一次“成功”输入。
    for (const route of [...snapshots.keys()]) await read(route);
    return {
      gameId: 'lol', skillKey: skill.skillKey, skillLevel: 1, characterLevel: 1,
      skillCategoryKeys: skill.skillCategoryKeys, parameters, formulas, effects, processes, internalStates, rules,
      statuses: statuses.items, modifierZones: zones.items, vampRules: vamp,
      identity: { source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' } }
    };
  } finally {
    await testInfo.attach(`${scenario.skillKey}-正式只读配置`, {
      contentType: 'application/json', body: Buffer.from(JSON.stringify({
        readAt: new Date().toISOString(), audit,
        snapshots: [...snapshots].map(([route, body]) => ({ route, sha256: createHash('sha256').update(JSON.stringify(body)).digest('hex'), body }))
      }, null, 2))
    });
  }
}

function liveSpellbladeRequest(authored: AuthoredTriggerProgram): CompileRequest {
  const input = baseRequest();
  const scene = liveSpellbladeInput;
  // 原生会从基础值和已挂载贡献重算总值；current/resolved 不是额外攻击力的输入渠道。
  input.sharedProviders![0]!.modifiers = [{
    modifierKey: 'fixture_bonus_attack_damage', kind: 'attribute', target: 'attack_damage',
    valuePolicy: 'add', value: { op: 'const', value: scene.sourceTotalAd - scene.sourceBaseAd }
  }];
  input.combatants = input.combatants.map(actor => {
    const source = actor.key === 'source';
    const baseAd = source ? scene.sourceBaseAd : scene.targetBaseAd;
    const totalAd = source ? scene.sourceTotalAd : scene.targetTotalAd;
    const attributes: CompileRequest['combatants'][number]['attributes'] = {
      hp: slot(source ? scene.sourceHp : scene.targetHp, source ? scene.sourceMaxHp : scene.targetMaxHp),
      attack_damage: { base: baseAd, current: baseAd, resolved: baseAd, max: totalAd },
      critical_strike_chance: slot(source ? scene.sourceCriticalChance : scene.targetCriticalChance, 1),
      armor: slot(source ? 0 : scene.targetArmor)
    };
    const ratios = { LIFE_STEAL: scene.lifeSteal, OMNIVAMP: scene.omnivamp, PHYSICAL_VAMP: scene.physicalVamp, SPELL_VAMP: scene.spellVamp };
    for (const rule of authored.vampRules ?? []) attributes[rule.sourceAttributeKey] = slot(source ? ratios[rule.vampType] : 0, 1);
    return { ...actor, attributes, resources: { mana: { current: scene.sourceMana, max: scene.sourceMaxMana } } };
  });
  return input;
}

for (const scenario of liveSpellbladeScenarios) {
  test(`正式单强化步骤只读实库→Worker：${scenario.name}附伤、吸血与同次消费`, async ({ page, request }, testInfo) => {
    test.skip(process.env.P6_LIVE_API !== '1', '仅显式开启实库检查；开启后未就绪配置必须失败');
    const authored = await readLiveSpellblade(request, testInfo, scenario);
    const input = liveSpellbladeRequest(authored);
    const scene = liveSpellbladeInput;
    const casts = [
      { entryKey: 'cast0', abilityKey: 'cast', at: scene.castAt, skillKey: 'fixture_active_spell', target: 'source' as const },
      { entryKey: 'refresh9', abilityKey: 'cast', at: scene.refreshAt, skillKey: 'fixture_active_spell', target: 'source' as const },
      { entryKey: 'cooldown_cast', abilityKey: 'cast', at: scene.attackHitAt + 2, skillKey: 'fixture_active_spell', target: 'source' as const }
    ];
    const aaHits = [
      { entryKey: 'real_hit', at: scene.attackHitAt, useKey: 'aa1' },
      { entryKey: 'same_time_duplicate', at: scene.attackHitAt, useKey: 'aa1' },
      { entryKey: 'duplicate', at: scene.attackHitAt + 1, useKey: 'aa1' }
    ];
    const payload: Parameters<typeof runP6>[1] = {
      mode: 'spellblade', program: authored, input, casts, aaHits, startAt: scene.attackStartAt, durationMs: 12000
    };
    const result = await runP6(page, payload);
    await assertNativeResult(result, testInfo);
    await testInfo.attach(`${scenario.skillKey}-实际属性与首轮运行`, {
      contentType: 'application/json', body: Buffer.from(JSON.stringify({
        syntheticInputs: scene, attributeContribution: input.sharedProviders![0]!.modifiers,
        sourceAttackDamage: result.done!.finalSnapshot.combatants.find(actor => actor.key === 'source')!.attributes.attack_damage,
        result
      }, null, 2))
    });
    const postDefense = scenario.rawDamage / 2;
    const expectedHealing = postDefense * (scene.lifeSteal + scene.omnivamp);
    const checkAmounts = (done: DoneResult) => {
      const source = done.finalSnapshot.combatants.find(actor => actor.key === 'source')!;
      const target = done.finalSnapshot.combatants.find(actor => actor.key === 'target')!;
      expect(source.attributes.attack_damage.base).toBe(scene.sourceBaseAd);
      expect(source.attributes.attack_damage.resolved).toBe(scene.sourceTotalAd);
      expect(source.attributes.attack_damage.resolved - source.attributes.attack_damage.base).toBe(80);
      expect(target.attributes.attack_damage.base).toBe(scene.targetBaseAd);
      expect(target.attributes.attack_damage.resolved).toBe(scene.targetTotalAd);
      expect(source.attributes.hp.current).toBeCloseTo(scene.sourceHp + expectedHealing, 9);
      expect(target.attributes.hp.current).toBeCloseTo(scene.targetHp - postDefense, 9);
      expect(source.resources.mana.current).toBeCloseTo(scene.sourceMana + scenario.manaRestored, 9);
      expect(target.resources.mana.current).toBe(0);
      expect(done.evidence.items.filter(item => item.kind === 'damage')).toHaveLength(1);
      const vamp = done.evidence.items.filter(item => item.kind === 'vamp');
      expect(vamp).toHaveLength(1);
      expect(vamp[0]!.data).toMatchObject({ postDefenseDamage: postDefense, actualHpLoss: postDefense });
      expect(vamp[0]!.data.actualHealing).toBeCloseTo(expectedHealing, 9);
      const contributions = vamp[0]!.data.contributions as Array<{ vampType: string; basisOutputKind: string; ratio: number; efficiency: number; amount: number }>;
      expect(contributions.find(row => row.vampType === 'LIFE_STEAL')).toMatchObject({ basisOutputKind: 'POST_DEFENSE_DAMAGE', ratio: 0.1, efficiency: 1, amount: postDefense * 0.1 });
      expect(contributions.find(row => row.vampType === 'OMNIVAMP')).toMatchObject({ basisOutputKind: 'POST_DEFENSE_DAMAGE', ratio: 0.2, efficiency: 1, amount: postDefense * 0.2 });
      expect(done.finalSnapshot.useTriggerLedger).toEqual([
        expect.objectContaining({ owner: 'source', providerRef: `item:${scenario.skillKey}`, groupKey: authored.processes[0]!.processKey, scope: 'provider', useKey: 'aa1' })
      ]);
    };
    checkAmounts(result.done!);
    const ready = authored.internalStates.find(state => state.stateType === 'FLAG')!.stateKey;
    const icd = authored.internalStates.find(state => state.stateType === 'INTERNAL_COOLDOWN')!.stateKey;
    expect(providerState(result.done!, `item:${scenario.skillKey}`)).toMatchObject({ state: { [ready]: 0, [icd]: 1 }, expireAt: { [icd]: 12500 } });
    const reopened = await runP6(page, {
      ...payload, durationMs: 13000,
      casts: [...casts, { entryKey: 'reopen', abilityKey: 'cast', at: 12500, skillKey: 'fixture_active_spell', target: 'source' }],
      aaHits: [...aaHits, { entryKey: 'old_after_reopen', at: 12501, useKey: 'aa1' }]
    });
    await assertNativeResult(reopened, testInfo);
    checkAmounts(reopened.done!);
    expect(providerState(reopened.done!, `item:${scenario.skillKey}`)).toMatchObject({ state: { [ready]: 1, [icd]: 0 }, expireAt: { [ready]: 22500 } });
    await testInfo.attach(`${scenario.skillKey}-正式组成运行证据`, {
      contentType: 'application/json', body: Buffer.from(JSON.stringify({
        syntheticInputs: scene,
        attributeContribution: input.sharedProviders![0]!.modifiers,
        actualAttackDamage: {
          firstRun: result.done!.finalSnapshot.combatants.find(actor => actor.key === 'source')!.attributes.attack_damage,
          reopened: reopened.done!.finalSnapshot.combatants.find(actor => actor.key === 'source')!.attributes.attack_damage
        },
        syntheticDrivers: '普通成功首次主动施法及真实普攻命中事件；不包含普通攻击主体伤害。作者过程、规则、参数、公式、效果和吸血规则均来自GET。',
        expected: { rawDamage: scenario.rawDamage, postDefenseDamage: postDefense, manaRestored: scenario.manaRestored, lifeStealHealing: postDefense * 0.1, omnivampHealing: postDefense * 0.2, totalHealing: expectedHealing },
        boundary: '实际Worker中的普通首次主动施法后一次强化普攻有限场景，不代表整装备或完整战斗。', result, reopened
      }, null, 2))
    });
  });
}
