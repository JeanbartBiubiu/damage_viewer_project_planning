import { expect, test, type Page, type Route } from '@playwright/test';

const API = 'http://127.0.0.1:19084';
const FIRST_GAME = 'authoring_p8';
const SECOND_GAME = 'authoring_p8_other';
const NOW = '2026-09-06T12:00:00Z';
const SKILL_KEY = 'p8_q';
const CHAR_KEY = 'p8_champ';
const RESOURCE_NOTE = '资源扣减，是否属于施放消耗需按来源核对';

type Json = Record<string, unknown>;

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: status === 204 ? '' : JSON.stringify(body)
  });
}

function location(
  identity: { skillKey: string | null; objectType: string; objectKey: string; fieldPath: string },
  editor: string | null,
  extra: Partial<{
    precision: string;
    degradeReason: string | null;
    segments: unknown[];
    formulaSnapshot: unknown;
  }> = {}
) {
  const precision = extra.precision ?? (editor ? 'FIELD' : 'NONE');
  return {
    ...identity,
    editor,
    precision,
    degradeReason: extra.degradeReason ?? (precision === 'FIELD' ? null : extra.degradeReason ?? 'UNKNOWN_FIELD'),
    segments: extra.segments ?? [],
    formulaSnapshot: extra.formulaSnapshot ?? null
  };
}

function skillRow(gameId: string, name = '秘术射击'): Json {
  return {
    gameId, skillKey: SKILL_KEY, name, description: null, maxLevel: 5, status: 'ENABLED', sortOrder: 10,
    skillCategoryKeys: [], createdAt: NOW, updatedAt: NOW
  };
}

function valueRule(value: number | { kind: 'PARAMETER'; parameterKey: string }) {
  const numeric = typeof value === 'number' ? { kind: 'FIXED', value } : value;
  return { value: numeric, fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null };
}

const formulaExpression = {
  nodeType: 'OPERATION',
  operation: 'ADD',
  operands: [
    { nodeType: 'PARAMETER', parameterKey: 'ratio' },
    { nodeType: 'PARAMETER', parameterKey: 'bonus' }
  ]
};

function damageResult(): Json {
  return {
    resultKey: 'dmg', name: '秘术伤害', resultType: 'DAMAGE', target: 'TARGET', description: null, sortOrder: 20,
    lifecycleBehavior: null, spellShieldBlockScope: null, valueRule: valueRule(80),
    detail: {
      damageTypeKey: 'magic', deliveryKind: 'SKILL', originKind: 'DIRECT',
      critical: { mode: 'DISALLOWED', multiplierValue: null },
      vampQualification: 'UNRESOLVED', vampOverrides: []
    }
  };
}

function effects(gameId: string, skillNameChanged = false): Json[] {
  return [
    {
      gameId, skillKey: SKILL_KEY, effectKey: 'hit', name: skillNameChanged ? '已更新命中' : '命中效果',
      description: null, sortOrder: 0, createdAt: NOW, updatedAt: NOW, lifecycle: null,
      results: [
        {
          resultKey: 'heal', name: '回蓝', resultType: 'RESOURCE_CHANGE', target: 'SOURCE', description: null, sortOrder: 0,
          lifecycleBehavior: null, spellShieldBlockScope: null, valueRule: valueRule(10),
          detail: { attributeKey: 'mana', operation: 'RESTORE' }
        },
        damageResult()
      ]
    },
    {
      gameId, skillKey: SKILL_KEY, effectKey: 'mana', name: '扣蓝',
      description: null, sortOrder: 1, createdAt: NOW, updatedAt: NOW, lifecycle: null,
      results: [{
        resultKey: 'spend', name: '扣蓝', resultType: 'RESOURCE_CHANGE', target: 'SOURCE', description: null, sortOrder: 0,
        lifecycleBehavior: null, spellShieldBlockScope: null, valueRule: valueRule(-40),
        detail: { attributeKey: 'mana', operation: 'CONSUME' }
      }]
    },
    {
      gameId, skillKey: SKILL_KEY, effectKey: 'orphan', name: '未挂接',
      description: null, sortOrder: 2, createdAt: NOW, updatedAt: NOW, lifecycle: null,
      results: [{
        resultKey: 'mark', name: '标记', resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE', description: null, sortOrder: 0,
        lifecycleBehavior: null, spellShieldBlockScope: null, valueRule: valueRule(5),
        detail: { attributeKey: 'ad', operation: 'DECREASE', modifierZoneKey: null }
      }]
    }
  ];
}

function processes(gameId: string, auraName = '被动光环'): Json[] {
  return [
    {
      gameId, skillKey: SKILL_KEY, processKey: 'cast', name: '施放过程', activationType: 'ACTIVE',
      description: null, sortOrder: 0, createdAt: NOW, updatedAt: NOW,
      cooldown: {
        durationValue: { kind: 'FIXED', value: 8000 },
        startMoment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null }
      },
      steps: [{ stepKey: 'fire', name: '出手', description: null, sortOrder: 0, stepType: 'IMMEDIATE', detail: {} }],
      effectBindings: [
        { bindingKey: 'on_start', effectKey: 'mana', moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null }, sortOrder: 0 },
        { bindingKey: 'on_end', effectKey: 'hit', moment: { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null }, sortOrder: 1 }
      ],
      stateOperations: []
    },
    {
      gameId, skillKey: SKILL_KEY, processKey: 'aura', name: auraName, activationType: 'PASSIVE',
      description: null, sortOrder: 1, createdAt: NOW, updatedAt: NOW,
      cooldown: {
        durationValue: { kind: 'FIXED', value: 1000 },
        startMoment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null }
      },
      steps: [{
        stepKey: 'tick', name: '周期', description: null, sortOrder: 0, stepType: 'PERIODIC',
        detail: {
          repeatCountValue: { kind: 'FIXED', value: 1 },
          intervalValue: { kind: 'FIXED', value: 1000 },
          firstExecution: 'IMMEDIATE'
        }
      }],
      effectBindings: [],
      stateOperations: []
    },
    {
      gameId, skillKey: SKILL_KEY, processKey: 'charge', name: '充能过程', activationType: 'CONSUMABLE',
      description: null, sortOrder: 2, createdAt: NOW, updatedAt: NOW, cooldown: null,
      steps: [{ stepKey: 'ready', name: '就绪', description: null, sortOrder: 0, stepType: 'IMMEDIATE', detail: {} }],
      effectBindings: [],
      stateOperations: []
    }
  ];
}

function rules(): Json[] {
  return [
    {
      ruleKey: 'on_use', name: '主动使用', description: null, sortOrder: 0,
      eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: null, useKind: 'ACTIVE', castPhase: 'INITIAL' } },
      conditionGroups: [],
      actions: [{
        actionKey: 'start', name: '启动', actionType: 'START_PROCESS', sortOrder: 0, targetContext: 'CURRENT_TARGET',
        detail: { processKey: 'cast' }, runtimeInputBindings: [], resultModifiers: []
      }],
      perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null
    },
    {
      ruleKey: 'on_hit', name: '技能命中', description: null, sortOrder: 1,
      eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: null } },
      conditionGroups: [{
        groupKey: 'hit_if', name: '命中条件', sortOrder: 0,
        conditions: [{ conditionKey: 'enemy', conditionType: 'SKILL_HIT_TARGET_IS_ENEMY', sortOrder: 0, detail: {} }]
      }],
      actions: [{
        actionKey: 'apply', name: '执行伤害', actionType: 'EXECUTE_EFFECT', sortOrder: 0, targetContext: 'CURRENT_TARGET',
        detail: { effectKey: 'hit' },
        runtimeInputBindings: [{
          bindingKey: 'first', parameterKey: 'contact', sourceType: 'EVENT_VALUE',
          detail: { eventValueKey: 'SKILL_HIT_FIRST_CONTACT' }
        }],
        resultModifiers: []
      }],
      perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null
    },
    {
      ruleKey: 'on_init', name: '初始化', description: null, sortOrder: 2,
      eventSource: { eventType: 'SOURCE_INITIALIZED', detail: {} },
      conditionGroups: [], actions: [], perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null
    }
  ];
}

function parameters(gameId: string): Json[] {
  return [
    {
      gameId, skillKey: SKILL_KEY, parameterKey: 'ratio', name: '比例', valueType: 'DECIMAL',
      valueMode: 'FIXED', fixedValue: 0.7, levelValues: null, description: null, sortOrder: 0, createdAt: NOW, updatedAt: NOW
    },
    {
      gameId, skillKey: SKILL_KEY, parameterKey: 'bonus', name: '加成', valueType: 'DECIMAL',
      valueMode: 'FIXED', fixedValue: 0.3, levelValues: null, description: null, sortOrder: 1, createdAt: NOW, updatedAt: NOW
    },
    {
      gameId, skillKey: SKILL_KEY, parameterKey: 'contact', name: '接触', valueType: 'INTEGER',
      valueMode: 'RUNTIME_INPUT', fixedValue: null, levelValues: null, description: null, sortOrder: 2, createdAt: NOW, updatedAt: NOW
    }
  ];
}

function internalState(gameId: string): Json {
  return {
    gameId, skillKey: SKILL_KEY, stateKey: 'stance', name: '姿态', scope: 'SKILL', stateType: 'MODE',
    description: null, sortOrder: 0, createdAt: NOW, updatedAt: NOW,
    detail: { options: [{ optionKey: 'open', name: '开启', sortOrder: 0, initial: true }] }
  };
}

function checkReport(): Json {
  const dmgLoc = location(
    { skillKey: SKILL_KEY, objectType: 'EFFECT', objectKey: 'hit', fieldPath: 'results[resultKey=dmg].resultType' },
    'EFFECT',
    {
      segments: [
        { kind: 'KEYED_CHILD', collection: 'results', keyField: 'resultKey', key: 'dmg' },
        { kind: 'FIELD', field: 'resultType' }
      ]
    }
  );
  const condLoc = location(
    { skillKey: SKILL_KEY, objectType: 'TRIGGER', objectKey: 'on_hit', fieldPath: 'conditionGroups[groupKey=hit_if].conditions[conditionKey=enemy].conditionType' },
    'TRIGGER_RULE',
    {
      segments: [
        { kind: 'KEYED_CHILD', collection: 'conditionGroups', keyField: 'groupKey', key: 'hit_if' },
        { kind: 'KEYED_CHILD', collection: 'conditions', keyField: 'conditionKey', key: 'enemy' },
        { kind: 'FIELD', field: 'conditionType' }
      ]
    }
  );
  const bindLoc = location(
    { skillKey: SKILL_KEY, objectType: 'TRIGGER', objectKey: 'on_hit', fieldPath: 'actions[actionKey=apply].runtimeInputBindings[bindingKey=first].sourceType' },
    'TRIGGER_RULE',
    {
      segments: [
        { kind: 'KEYED_CHILD', collection: 'actions', keyField: 'actionKey', key: 'apply' },
        { kind: 'KEYED_CHILD', collection: 'runtimeInputBindings', keyField: 'bindingKey', key: 'first' },
        { kind: 'FIELD', field: 'sourceType' }
      ]
    }
  );
  const stepLoc = location(
    { skillKey: SKILL_KEY, objectType: 'PROCESS', objectKey: 'cast', fieldPath: 'steps[stepKey=fire].stepType' },
    'PROCESS',
    {
      segments: [
        { kind: 'KEYED_CHILD', collection: 'steps', keyField: 'stepKey', key: 'fire' },
        { kind: 'FIELD', field: 'stepType' }
      ]
    }
  );
  const cdLoc = location(
    { skillKey: SKILL_KEY, objectType: 'PROCESS', objectKey: 'cast', fieldPath: 'cooldown' },
    'PROCESS',
    { segments: [{ kind: 'FIELD', field: 'cooldown' }] }
  );
  const paramLoc = location(
    { skillKey: SKILL_KEY, objectType: 'PARAMETER', objectKey: 'ratio', fieldPath: 'name' },
    'PARAMETER',
    { segments: [{ kind: 'FIELD', field: 'name' }] }
  );
  const paramRefLoc = location(
    { skillKey: SKILL_KEY, objectType: 'PARAMETER', objectKey: 'ratio', fieldPath: 'parameterKey' },
    'PARAMETER',
    { segments: [{ kind: 'FIELD', field: 'parameterKey' }] }
  );
  const formulaRefLoc = location(
    { skillKey: SKILL_KEY, objectType: 'FORMULA', objectKey: 'scale', fieldPath: 'expression' },
    'FORMULA',
    {
      segments: [{ kind: 'FIELD', field: 'expression' }],
      formulaSnapshot: formulaExpression
    }
  );
  const dmgRefLoc = location(
    { skillKey: SKILL_KEY, objectType: 'EFFECT', objectKey: 'hit', fieldPath: 'results[resultKey=dmg].detail.damageTypeKey' },
    'EFFECT',
    {
      segments: [
        { kind: 'KEYED_CHILD', collection: 'results', keyField: 'resultKey', key: 'dmg' },
        { kind: 'FIELD', field: 'detail' },
        { kind: 'FIELD', field: 'damageTypeKey' }
      ]
    }
  );
  const formulaOk = location(
    { skillKey: SKILL_KEY, objectType: 'FORMULA', objectKey: 'scale', fieldPath: 'expression.operands[1].parameterKey' },
    'FORMULA',
    {
      segments: [
        { kind: 'FIELD', field: 'expression' },
        { kind: 'EXPECT_VALUE', field: 'nodeType', value: 'OPERATION' },
        { kind: 'FORMULA_OPERAND', operand: 1 },
        { kind: 'EXPECT_VALUE', field: 'nodeType', value: 'PARAMETER' },
        { kind: 'FIELD', field: 'parameterKey' }
      ],
      formulaSnapshot: formulaExpression
    }
  );
  const formulaSwap = location(
    { skillKey: SKILL_KEY, objectType: 'FORMULA', objectKey: 'scale', fieldPath: 'expression.operands[1].parameterKey' },
    'FORMULA',
    {
      segments: [
        { kind: 'FIELD', field: 'expression' },
        { kind: 'FORMULA_OPERAND', operand: 1 },
        { kind: 'FIELD', field: 'parameterKey' }
      ],
      formulaSnapshot: {
        nodeType: 'OPERATION',
        operation: 'ADD',
        operands: [
          { nodeType: 'PARAMETER', parameterKey: 'bonus' },
          { nodeType: 'PARAMETER', parameterKey: 'ratio' }
        ]
      }
    }
  );
  const missingResult = location(
    { skillKey: SKILL_KEY, objectType: 'EFFECT', objectKey: 'hit', fieldPath: 'results[resultKey=gone].attributeKey' },
    'EFFECT',
    {
      segments: [
        { kind: 'KEYED_CHILD', collection: 'results', keyField: 'resultKey', key: 'gone' },
        { kind: 'FIELD', field: 'attributeKey' }
      ]
    }
  );
  const typeChanged = location(
    { skillKey: SKILL_KEY, objectType: 'EFFECT', objectKey: 'orphan', fieldPath: 'results[resultKey=mark].resultType' },
    'EFFECT',
    {
      segments: [
        { kind: 'KEYED_CHILD', collection: 'results', keyField: 'resultKey', key: 'mark' },
        { kind: 'EXPECT_VALUE', field: 'resultType', value: 'DAMAGE' },
        { kind: 'FIELD', field: 'resultType' }
      ]
    }
  );
  const optionLoc = location(
    { skillKey: SKILL_KEY, objectType: 'STATE', objectKey: 'stance', fieldPath: 'options[optionKey=open].optionKey' },
    'INTERNAL_STATE',
    {
      segments: [
        { kind: 'FIELD', field: 'detail' },
        { kind: 'KEYED_CHILD', collection: 'options', keyField: 'optionKey', key: 'open' },
        { kind: 'FIELD', field: 'optionKey' }
      ]
    }
  );
  const missingSkillLoc = location(
    { skillKey: 'missing', objectType: 'SKILL', objectKey: 'missing', fieldPath: 'skills' },
    'CHARACTER_RELATIONS',
    { precision: 'OBJECT', degradeReason: 'OBJECT_MISSING', segments: [] }
  );
  const references = [
    { sourceSkillKey: SKILL_KEY, sourceType: 'EFFECT', sourceKey: 'hit', fieldPath: 'results[resultKey=dmg].detail.damageTypeKey', targetType: 'DAMAGE_TYPE', targetSkillKey: null, targetKey: 'magic', targetSubKey: null, location: dmgRefLoc },
    { sourceSkillKey: SKILL_KEY, sourceType: 'EFFECT', sourceKey: 'mana', fieldPath: 'results[resultKey=spend].detail.attributeKey', targetType: 'ATTRIBUTE', targetSkillKey: null, targetKey: 'mana', targetSubKey: null, location: location({ skillKey: SKILL_KEY, objectType: 'EFFECT', objectKey: 'mana', fieldPath: 'results[resultKey=spend].detail.attributeKey' }, 'EFFECT', { segments: [{ kind: 'KEYED_CHILD', collection: 'results', keyField: 'resultKey', key: 'spend' }, { kind: 'FIELD', field: 'detail' }, { kind: 'FIELD', field: 'attributeKey' }] }) },
    { sourceSkillKey: SKILL_KEY, sourceType: 'PARAMETER', sourceKey: 'ratio', fieldPath: 'parameterKey', targetType: 'PARAMETER', targetSkillKey: SKILL_KEY, targetKey: 'ratio', targetSubKey: null, location: paramRefLoc },
    { sourceSkillKey: SKILL_KEY, sourceType: 'FORMULA', sourceKey: 'scale', fieldPath: 'expression', targetType: 'PARAMETER', targetSkillKey: SKILL_KEY, targetKey: 'bonus', targetSubKey: null, location: formulaRefLoc }
  ];
  return {
    gameId: FIRST_GAME, characterKey: CHAR_KEY, characterName: '测试英雄', checkedAt: NOW,
    conclusions: { structure: 'HAS_ERRORS', mechanics: 'NOT_CHECKED', runtime: 'NOT_RUN' },
    summary: { attachedSkillCount: 2, configuredAttributeCount: 0, errorCount: 3, reviewCount: 9 },
    skills: [
      { skillKey: SKILL_KEY, name: '秘术射击', status: 'ENABLED', maxLevel: 5, sortOrder: 10, effectCount: 3, processCount: 3, triggerRuleCount: 3 },
      { skillKey: 'missing', name: null, status: null, maxLevel: null, sortOrder: 20, effectCount: 0, processCount: 0, triggerRuleCount: 0 }
    ],
    references,
    issues: [
      { code: 'RESULT_REVIEW', severity: 'REVIEW', message: '核对伤害结果种类', skillKey: SKILL_KEY, objectType: 'EFFECT', objectKey: 'hit', fieldPath: dmgLoc.fieldPath, location: dmgLoc },
      { code: 'CONDITION_REVIEW', severity: 'REVIEW', message: '核对命中条件', skillKey: SKILL_KEY, objectType: 'TRIGGER', objectKey: 'on_hit', fieldPath: condLoc.fieldPath, location: condLoc },
      { code: 'BINDING_REVIEW', severity: 'REVIEW', message: '核对动态绑定', skillKey: SKILL_KEY, objectType: 'TRIGGER', objectKey: 'on_hit', fieldPath: bindLoc.fieldPath, location: bindLoc },
      { code: 'STEP_REVIEW', severity: 'REVIEW', message: '核对过程步骤', skillKey: SKILL_KEY, objectType: 'PROCESS', objectKey: 'cast', fieldPath: stepLoc.fieldPath, location: stepLoc },
      { code: 'COOLDOWN_REVIEW', severity: 'REVIEW', message: '核对过程冷却', skillKey: SKILL_KEY, objectType: 'PROCESS', objectKey: 'cast', fieldPath: cdLoc.fieldPath, location: cdLoc },
      { code: 'PARAM_REVIEW', severity: 'REVIEW', message: '核对参数名称', skillKey: SKILL_KEY, objectType: 'PARAMETER', objectKey: 'ratio', fieldPath: paramLoc.fieldPath, location: paramLoc },
      { code: 'FORMULA_OK', severity: 'REVIEW', message: '核对公式右操作数', skillKey: SKILL_KEY, objectType: 'FORMULA', objectKey: 'scale', fieldPath: formulaOk.fieldPath, location: formulaOk },
      { code: 'FORMULA_SWAP', severity: 'REVIEW', message: '公式左右同类节点已交换', skillKey: SKILL_KEY, objectType: 'FORMULA', objectKey: 'scale', fieldPath: formulaSwap.fieldPath, location: formulaSwap },
      { code: 'RESULT_MISSING', severity: 'ERROR', message: '结果已删除', skillKey: SKILL_KEY, objectType: 'EFFECT', objectKey: 'hit', fieldPath: missingResult.fieldPath, location: missingResult },
      { code: 'RESULT_TYPE', severity: 'ERROR', message: '结果类型已变化', skillKey: SKILL_KEY, objectType: 'EFFECT', objectKey: 'orphan', fieldPath: typeChanged.fieldPath, location: typeChanged },
      { code: 'OPTION_REVIEW', severity: 'REVIEW', message: '核对模式选项', skillKey: SKILL_KEY, objectType: 'STATE', objectKey: 'stance', fieldPath: optionLoc.fieldPath, location: optionLoc },
      { code: 'ATTACHED_SKILL_MISSING', severity: 'ERROR', message: '挂载技能缺失', skillKey: 'missing', objectType: 'SKILL', objectKey: 'missing', fieldPath: 'skills', location: missingSkillLoc }
    ]
  };
}

class AuthoringP8Api {
  unexpected: string[] = [];
  skillGets: string[] = [];
  holdEffects: Route | undefined;
  delayEffects = false;
  auraName = '被动光环';
  processStore = processes(FIRST_GAME);

  async install(page: Page) {
    await page.route('**/api/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS'
          }
        });
        return;
      }
      if (url.origin !== API) {
        this.unexpected.push(`${request.method()} ${url.href}`);
        await route.abort();
        return;
      }
      await this.dispatch(route, url);
    });
  }

  async dispatch(route: Route, url: URL) {
    const method = route.request().method();
    const pathname = url.pathname;
    const segments = pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (method === 'GET' && pathname === '/api/games') {
      await json(route, [
        { gameId: FIRST_GAME, gameName: '第8项游戏' },
        { gameId: SECOND_GAME, gameName: '第8项另一游戏' }
      ]);
      return;
    }
    if (segments[0] !== 'api' || segments[1] !== 'admin' || segments[2] !== 'games') {
      this.unexpected.push(`${method} ${pathname}`);
      await json(route, { error: { code: '404.UNMOCKED', message: pathname } }, 404);
      return;
    }
    const gameId = segments[3]!;
    const tail = segments.slice(4);
    if (pathname.endsWith('/representative-image')) {
      await json(route, { image: null });
      return;
    }
    if (tail[0] === 'level-config' && method === 'GET') {
      await json(route, { gameId, minLevel: 1, maxLevel: 18 });
      return;
    }
    if (pathname.endsWith('/vamp-rules')) {
      await json(route, { rules: [] });
      return;
    }
    if (tail[0] === 'characters' && method === 'GET' && tail.length === 1) {
      const items = gameId === FIRST_GAME
        ? [{ gameId, characterKey: CHAR_KEY, name: '测试英雄', description: null, createdAt: NOW, updatedAt: NOW }]
        : [{ gameId, characterKey: 'other', name: '另一游戏英雄', description: null, createdAt: NOW, updatedAt: NOW }];
      await json(route, { items, total: items.length });
      return;
    }
    if (tail[0] === 'characters' && tail[2] === 'authoring-check' && method === 'GET') {
      if (gameId !== FIRST_GAME || tail[1] !== CHAR_KEY) {
        await json(route, { error: { code: '404.NOT_FOUND', message: pathname } }, 404);
        return;
      }
      await json(route, checkReport());
      return;
    }
    if (tail[0] === 'character-skill-relations' && method === 'GET') {
      await json(route, {
        items: gameId === FIRST_GAME ? [{
          gameId, characterKey: CHAR_KEY, characterName: '测试英雄',
          skillKey: SKILL_KEY, skillName: '秘术射击', skillStatus: 'ENABLED', sortOrder: 10
        }] : [],
        total: gameId === FIRST_GAME ? 1 : 0
      });
      return;
    }
    if (tail[0] === 'skill-categories' && method === 'GET') {
      await json(route, { items: [], total: 0 });
      return;
    }
    if (tail[0] === 'attributes' && method === 'GET') {
      if (tail.length === 2) {
        const name = tail[1] === 'mana' ? '法力' : tail[1] === 'ad' ? '攻击' : null;
        await json(route, name ? { gameId, attributeKey: tail[1], name, status: 'ENABLED' }
          : { error: { code: '404.ATTRIBUTE_NOT_FOUND', message: pathname } }, name ? 200 : 404);
        return;
      }
      await json(route, {
        items: [{
          gameId, attributeKey: 'mana', name: '法力', description: null, status: 'ENABLED',
          valueType: 'DECIMAL', minValue: 0, maxValue: null, sortOrder: 0, createdAt: NOW, updatedAt: NOW
        }, {
          gameId, attributeKey: 'ad', name: '攻击', description: null, status: 'ENABLED',
          valueType: 'DECIMAL', minValue: 0, maxValue: null, sortOrder: 1, createdAt: NOW, updatedAt: NOW
        }],
        total: 2
      });
      return;
    }
    if (tail[0] === 'damage-types' && method === 'GET') {
      if (tail.length === 2) {
        await json(route, { gameId, damageTypeKey: 'magic', name: '魔法', description: null, status: 'ENABLED', sortOrder: 0, createdAt: NOW, updatedAt: NOW });
        return;
      }
      await json(route, {
        items: [{ gameId, damageTypeKey: 'magic', name: '魔法', description: null, status: 'ENABLED', sortOrder: 0, createdAt: NOW, updatedAt: NOW }],
        total: 1
      });
      return;
    }
    if (tail[0] === 'statuses' && method === 'GET') {
      await json(route, { items: [], total: 0 });
      return;
    }
    if (tail[0] === 'modifier-zones' && method === 'GET') {
      await json(route, { items: [], total: 0 });
      return;
    }
    if (tail[0] === 'skills' && tail.length === 1 && method === 'GET') {
      const items = gameId === FIRST_GAME ? [skillRow(gameId)] : [{ ...skillRow(gameId, '另一游戏技能'), skillKey: 'other_q' }];
      await json(route, { items, total: items.length });
      return;
    }
    if (tail[0] === 'skills' && tail.length === 2 && method === 'GET') {
      this.skillGets.push(tail[1]!);
      if (tail[1] === SKILL_KEY && gameId === FIRST_GAME) {
        await json(route, skillRow(gameId));
        return;
      }
      await json(route, { error: { code: '404.SKILL_NOT_FOUND', message: pathname } }, 404);
      return;
    }
    if (tail[0] === 'skills' && tail[2] === 'parameters' && method === 'GET') {
      const items = gameId === FIRST_GAME ? parameters(gameId) : [];
      if (tail.length === 4) {
        const found = items.find((item) => item.parameterKey === tail[3]);
        if (found) {
          await json(route, found);
          return;
        }
      } else {
        await json(route, items);
        return;
      }
    }
    if (tail[0] === 'skills' && tail[2] === 'formulas' && method === 'GET') {
      if (tail.length === 4 && tail[3] === 'scale') {
        await json(route, {
          gameId, skillKey: tail[1], formulaKey: 'scale', name: '缩放', description: null, sortOrder: 0,
          createdAt: NOW, updatedAt: NOW, expression: formulaExpression
        });
        return;
      }
      await json(route, gameId === FIRST_GAME ? [{
        gameId, skillKey: tail[1], formulaKey: 'scale', name: '缩放', description: null, sortOrder: 0, createdAt: NOW, updatedAt: NOW
      }] : []);
      return;
    }
    if (tail[0] === 'skills' && tail[2] === 'effects' && method === 'GET') {
      if (this.delayEffects && gameId === FIRST_GAME && tail.length === 3 && !this.holdEffects) {
        this.holdEffects = route;
        return;
      }
      const items = gameId === FIRST_GAME ? effects(gameId) : [];
      if (tail.length === 3) {
        await json(route, items.map((item) => ({
          gameId, skillKey: item.skillKey, effectKey: item.effectKey, name: item.name,
          description: item.description, sortOrder: item.sortOrder,
          resultCount: Array.isArray(item.results) ? item.results.length : 0,
          lifecycleEnabled: false, createdAt: NOW, updatedAt: NOW
        })));
        return;
      }
      const found = items.find((item) => item.effectKey === tail[3]);
      if (found) {
        await json(route, found);
        return;
      }
    }
    if (tail[0] === 'skills' && tail[2] === 'processes' && method === 'GET') {
      const items = gameId === FIRST_GAME ? this.processStore : [];
      if (tail.length === 3) {
        await json(route, items.map((item) => ({
          gameId, skillKey: item.skillKey, processKey: item.processKey, name: item.name,
          activationType: item.activationType, description: item.description, sortOrder: item.sortOrder,
          stepCount: Array.isArray(item.steps) ? item.steps.length : 0,
          effectBindingCount: Array.isArray(item.effectBindings) ? item.effectBindings.length : 0,
          stateOperationCount: 0, createdAt: NOW, updatedAt: NOW
        })));
        return;
      }
      const found = items.find((item) => item.processKey === tail[3]);
      if (found) {
        await json(route, found);
        return;
      }
    }
    if (tail[0] === 'skills' && tail[2] === 'processes' && tail.length === 4 && method === 'PUT') {
      const body = JSON.parse(route.request().postData() || '{}') as Json;
      const current = this.processStore.find((item) => item.processKey === tail[3]);
      if (!current) {
        await json(route, { error: { code: '404.NOT_FOUND', message: pathname } }, 404);
        return;
      }
      Object.assign(current, body, { processKey: tail[3], gameId, skillKey: tail[1], updatedAt: NOW });
      this.auraName = String(current.name);
      await json(route, current);
      return;
    }
    if (tail[0] === 'skills' && tail[2] === 'internal-states' && method === 'GET') {
      if (gameId !== FIRST_GAME) {
        await json(route, tail.length === 3 ? [] : { error: { code: '404.NOT_FOUND', message: pathname } }, tail.length === 3 ? 200 : 404);
        return;
      }
      if (tail.length === 3) {
        const state = internalState(gameId);
        await json(route, [{
          gameId, skillKey: SKILL_KEY, stateKey: state.stateKey, name: state.name, stateType: state.stateType,
          scope: state.scope, description: null, sortOrder: 0, createdAt: NOW, updatedAt: NOW
        }]);
        return;
      }
      if (tail[3] === 'stance') {
        await json(route, internalState(gameId));
        return;
      }
    }
    if (tail[0] === 'skills' && tail[2] === 'trigger-rules' && method === 'GET') {
      const items = gameId === FIRST_GAME ? rules() : [];
      if (tail.length === 3) {
        await json(route, items.map((item) => ({
          ruleKey: item.ruleKey, name: item.name, description: item.description, eventType: (item.eventSource as Json).eventType,
          conditionGroupCount: Array.isArray(item.conditionGroups) ? item.conditionGroups.length : 0,
          actionCount: Array.isArray(item.actions) ? item.actions.length : 0,
          perTargetCooldownEnabled: false, maxTriggersPerProcessEnabled: false, oncePerUseEnabled: false,
          sortOrder: item.sortOrder, updatedAt: NOW
        })));
        return;
      }
      const found = items.find((item) => item.ruleKey === tail[3]);
      if (found) {
        await json(route, found);
        return;
      }
    }
    this.unexpected.push(`${method} ${pathname}`);
    await json(route, { error: { code: '404.UNMOCKED', message: pathname } }, 404);
  }
}

async function prepare(page: Page, api: AuthoringP8Api, hash = '/#/skills') {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await api.install(page);
  await page.addInitScript(apiBase => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('damage-viewer.web.api-base-url', apiBase);
    localStorage.setItem('damage-viewer.web.admin-token', 'authoring-p8-example');
  }, API);
  await page.goto(hash);
  return () => {
    expect(errors, '未捕获浏览器异常').toEqual([]);
    expect(api.unexpected, '未定义或已删除接口请求').toEqual([]);
    expect(api.skillGets.includes('missing'), '缺失挂载技能不得 GET').toBe(false);
  };
}

function row(page: Page, key: string) {
  return page.getByRole('row').filter({ has: page.getByRole('cell', { name: key, exact: true }) });
}

function modal(page: Page, title: string) {
  return page.locator('.arco-modal:visible').filter({ has: page.locator('.arco-modal-title', { hasText: title }) });
}

async function answerDialog(page: Page, trigger: () => Promise<unknown>, accept: boolean) {
  let message = '';
  const handled = new Promise<void>((resolve, reject) => {
    page.once('dialog', dialog => {
      message = dialog.message();
      (accept ? dialog.accept() : dialog.dismiss()).then(() => resolve(), reject);
    });
  });
  await trigger();
  await handled;
  return message;
}

async function closeEditor(page: Page, title: string, button = '取消') {
  const shell = modal(page, title);
  await expect(shell).toBeVisible();
  await shell.getByRole('button', { name: button, exact: true }).click();
  await expect(shell).toHaveCount(0);
}

test('技能行为总览五组、资源扣减说明、未启动被动，以及编辑后刷新和旧请求隔离', async ({ page }) => {
  const api = new AuthoringP8Api();
  const assertClean = await prepare(page, api);
  await expect(page.locator('.app-toolbar-field--game')).toContainText(FIRST_GAME);
  await row(page, SKILL_KEY).getByRole('button', { name: '行为总览', exact: true }).click();
  const overview = modal(page, '行为总览 · 秘术射击');
  await expect(overview.getByText('本页只汇总已保存配置，不表示机制已核对或战斗运行已验证。')).toBeVisible();
  await expect(overview.getByRole('heading', { name: '使用', exact: true })).toBeVisible();
  await expect(overview.getByRole('heading', { name: '消耗与冷却', exact: true })).toBeVisible();
  await expect(overview.getByRole('heading', { name: '命中', exact: true })).toBeVisible();
  await expect(overview.getByRole('heading', { name: '效果', exact: true })).toBeVisible();
  await expect(overview.getByRole('heading', { name: '结束', exact: true })).toBeVisible();
  await expect(overview.getByRole('heading', { name: '补充入口', exact: true })).toBeVisible();
  await expect(overview.getByText('触发规则：主动使用（on_use）').first()).toBeVisible();
  await expect(overview.getByText(RESOURCE_NOTE)).toHaveCount(2);
  await expect(overview.getByRole('row').filter({ hasText: '效果结果：扣蓝 / 扣蓝' }).first()).toContainText(RESOURCE_NOTE);
  await expect(overview.getByText('过程冷却：施放过程（cast）').first()).toBeVisible();
  const restoreRows = overview.getByRole('row').filter({ hasText: '效果结果：命中效果 / 回蓝' });
  await expect(restoreRows.first()).toBeVisible();
  await expect(restoreRows).toHaveCount(2);
  await expect(restoreRows.first()).not.toContainText(RESOURCE_NOTE);
  await expect(restoreRows.nth(1)).not.toContainText(RESOURCE_NOTE);
  await expect(overview.getByText('触发规则：技能命中（on_hit）').first()).toBeVisible();
  await expect(overview.getByText('效果结果：命中效果 / 秘术伤害').first()).toBeVisible();
  const effectBinding = overview.getByRole('row').filter({ hasText: '过程效果挂接：施放过程 → 命中效果（hit）' }).first();
  await expect(effectBinding).toBeVisible();
  await expect(effectBinding.getByRole('cell').nth(2)).toContainText('当前目标');
  await expect(overview.getByText('未启动过程：被动光环（aura）')).toBeVisible();
  await expect(overview.getByText('未启动过程：充能过程（charge）')).toBeVisible();
  await expect(overview.getByText('未挂接效果：未挂接（orphan）')).toBeVisible();
  await expect(overview.getByText('触发规则：初始化（on_init）')).toBeVisible();
  await expect(overview.getByRole('row').filter({ hasText: '标记' })).not.toContainText(RESOURCE_NOTE);

  await overview.getByRole('row').filter({ hasText: '未启动过程：被动光环' }).getByRole('button', { name: '编辑', exact: true }).click();
  const processShell = modal(page, '过程与内部状态 - 秘术射击');
  await expect(processShell).toBeVisible();
  const processEditor = modal(page, '编辑过程');
  await processEditor.getByLabel('过程名称', { exact: true }).fill('已更新光环');
  await processEditor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(processEditor).toHaveCount(0);
  await processShell.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(overview.getByText('未启动过程：已更新光环（aura）')).toBeVisible();

  api.delayEffects = true;
  await overview.getByRole('button', { name: '重试', exact: true }).click();
  await expect.poll(() => Boolean(api.holdEffects)).toBe(true);
  await overview.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(modal(page, '行为总览 · 秘术射击')).toHaveCount(0);
  await page.locator('.app-toolbar-field--game .arco-select-view').click();
  await page.getByRole('option', { name: `${SECOND_GAME} / 第8项另一游戏`, exact: true }).click();
  await expect(page.getByRole('heading', { name: '技能管理', exact: true })).toBeVisible();
  await expect(modal(page, '行为总览 · 秘术射击')).toHaveCount(0);
  await json(api.holdEffects!, effects(FIRST_GAME).map((item) => ({
    gameId: FIRST_GAME, skillKey: item.skillKey, effectKey: item.effectKey, name: '迟到效果',
    description: item.description, sortOrder: item.sortOrder,
    resultCount: Array.isArray(item.results) ? item.results.length : 0,
    lifecycleEnabled: false, createdAt: NOW, updatedAt: NOW
  })));
  await expect(page.getByText('迟到效果', { exact: true })).toHaveCount(0);
  await expect(row(page, 'other_q')).toBeVisible();
  assertClean();
});

test('录入检查按稳定键直达字段、公式交换降级、草稿取消与引用折叠', async ({ page }) => {
  const api = new AuthoringP8Api();
  const assertClean = await prepare(page, api, '/#/characters');
  await expect(page.locator('.app-toolbar-field--game')).toContainText(FIRST_GAME);
  await page.getByRole('textbox', { name: '角色关键词', exact: true }).fill('保留的筛选草稿');
  await row(page, CHAR_KEY).getByRole('button', { name: '录入检查', exact: true }).click();
  const check = modal(page, '录入检查 · 测试英雄');
  await expect(check.getByText(/结构检查：发现 3 项错误/)).toBeVisible();
  await expect(check.getByText('秘术射击（p8_q）', { exact: true })).toBeVisible();
  await expect(check.getByText('目录缺失（missing）')).toBeVisible();
  await expect(check.getByText('results[resultKey=dmg].detail.damageTypeKey')).toBeVisible();
  await expect(check.getByText('results[resultKey=spend].detail.attributeKey')).toBeVisible();
  await expect(check.getByText('parameterKey', { exact: true })).toBeVisible();
  await expect(check.getByText('伤害类型 / 魔法（magic）', { exact: true })).toBeVisible();
  await expect(check.getByText('属性 / 法力（mana）', { exact: true })).toBeVisible();
  await expect(check.getByText('expression', { exact: true })).toHaveCount(0);
  await check.getByRole('button', { name: '展开全部引用（共 4 项）' }).click();
  await expect(check.getByText('expression', { exact: true })).toBeVisible();
  await check.getByRole('button', { name: '收起全部引用' }).click();
  await expect(check.getByText('expression', { exact: true })).toHaveCount(0);

  await check.getByRole('row').filter({ hasText: '核对伤害结果种类' }).getByRole('button', { name: '定位问题', exact: true }).click();
  await expect(page.getByRole('button', { name: '返回录入检查', exact: true })).toBeVisible();
  const resultEditor = modal(page, '编辑结果');
  await expect(resultEditor.locator('[data-authoring-field="resultType"].authoring-field-active')).toBeVisible();
  await expect(resultEditor.getByLabel('结果名称', { exact: true })).toHaveValue('秘术伤害');
  await resultEditor.getByLabel('结果名称', { exact: true }).fill('未保存伤害');
  expect(await answerDialog(page, () => resultEditor.getByRole('button', { name: '取消', exact: true }).click(), false)).toBe('当前修改尚未保存，确定要离开吗？');
  await expect(resultEditor.getByLabel('结果名称', { exact: true })).toHaveValue('未保存伤害');
  expect(await answerDialog(page, () => resultEditor.getByRole('button', { name: '取消', exact: true }).click(), true)).toBe('当前修改尚未保存，确定要离开吗？');
  await expect(resultEditor).toHaveCount(0);
  await closeEditor(page, '编辑效果');
  await closeEditor(page, '效果与结果 - 秘术射击', '关闭');
  await page.getByRole('button', { name: '返回录入检查', exact: true }).click();
  await expect(check.getByText(/结构检查：发现 3 项错误/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: '角色关键词', exact: true })).toHaveValue('保留的筛选草稿');

  await check.getByRole('row').filter({ hasText: '核对命中条件' }).getByRole('button', { name: '定位问题', exact: true }).click();
  await expect(modal(page, '编辑条件').locator('[data-authoring-field="conditionType"].authoring-field-active')).toBeVisible();
  await closeEditor(page, '编辑条件');
  await closeEditor(page, '编辑规则');
  await closeEditor(page, '条件与触发 - 秘术射击', '关闭');
  await page.getByRole('button', { name: '返回录入检查', exact: true }).click();

  await check.getByRole('row').filter({ hasText: '核对动态绑定' }).getByRole('button', { name: '定位问题', exact: true }).click();
  await expect(modal(page, '编辑绑定').locator('[data-authoring-field="sourceType"].authoring-field-active')).toBeVisible();
  await closeEditor(page, '编辑绑定');
  await closeEditor(page, '编辑动作');
  await closeEditor(page, '编辑规则');
  await closeEditor(page, '条件与触发 - 秘术射击', '关闭');
  await page.getByRole('button', { name: '返回录入检查', exact: true }).click();

  await check.getByRole('row').filter({ hasText: '核对过程步骤' }).getByRole('button', { name: '定位问题', exact: true }).click();
  await expect(modal(page, '编辑步骤').locator('[data-authoring-field="stepType"].authoring-field-active')).toBeVisible();
  await closeEditor(page, '编辑步骤');
  await closeEditor(page, '编辑过程');
  await closeEditor(page, '过程与内部状态 - 秘术射击', '关闭');
  await page.getByRole('button', { name: '返回录入检查', exact: true }).click();

  await check.getByRole('row').filter({ hasText: '核对过程冷却' }).getByRole('button', { name: '定位问题', exact: true }).click();
  await expect(modal(page, '编辑过程').locator('[data-authoring-field="cooldown"].authoring-field-active')).toBeVisible();
  await closeEditor(page, '编辑过程');
  await closeEditor(page, '过程与内部状态 - 秘术射击', '关闭');
  await page.getByRole('button', { name: '返回录入检查', exact: true }).click();

  await check.getByRole('row').filter({ hasText: '核对参数名称' }).getByRole('button', { name: '定位问题', exact: true }).click();
  await expect(modal(page, '编辑参数').locator('[data-authoring-field="name"].authoring-field-active')).toBeVisible();
  await closeEditor(page, '编辑参数');
  await closeEditor(page, '参数与公式 - 秘术射击', '关闭');
  await page.getByRole('button', { name: '返回录入检查', exact: true }).click();

  await check.getByRole('row').filter({ hasText: '核对公式右操作数' }).getByRole('button', { name: '定位问题', exact: true }).click();
  await expect(modal(page, '编辑公式').locator('[data-authoring-field="expression.operands[1]"].authoring-field-active')).toBeVisible();
  await closeEditor(page, '编辑公式');
  await closeEditor(page, '参数与公式 - 秘术射击', '关闭');
  await page.getByRole('button', { name: '返回录入检查', exact: true }).click();

  await check.getByRole('row').filter({ hasText: '公式左右同类节点已交换' }).getByRole('button', { name: '定位问题', exact: true }).click();
  const swapped = modal(page, '编辑公式');
  await expect(swapped.getByText(/无法精确定位/)).toBeVisible();
  await expect(swapped.getByText(/公式表达式已变化/)).toBeVisible();
  await expect(swapped.locator('[data-authoring-field="expression.operands[1]"].authoring-field-active')).toHaveCount(0);
  await closeEditor(page, '编辑公式');
  await closeEditor(page, '参数与公式 - 秘术射击', '关闭');
  await page.getByRole('button', { name: '返回录入检查', exact: true }).click();

  await check.getByRole('row').filter({ hasText: '结果已删除' }).getByRole('button', { name: '定位问题', exact: true }).click();
  const missing = modal(page, '编辑效果');
  await expect(missing.getByText(/无法精确定位/)).toBeVisible();
  await expect(modal(page, '编辑结果')).toHaveCount(0);
  await closeEditor(page, '编辑效果');
  await closeEditor(page, '效果与结果 - 秘术射击', '关闭');
  await page.getByRole('button', { name: '返回录入检查', exact: true }).click();

  await check.getByRole('row').filter({ hasText: '结果类型已变化' }).getByRole('button', { name: '定位问题', exact: true }).click();
  const changed = modal(page, '编辑结果');
  await expect(changed.getByText(/无法精确定位/)).toBeVisible();
  await expect(changed.locator('[data-authoring-field="resultType"].authoring-field-active')).toHaveCount(0);
  await closeEditor(page, '编辑结果');
  await closeEditor(page, '编辑效果');
  await closeEditor(page, '效果与结果 - 秘术射击', '关闭');
  await page.getByRole('button', { name: '返回录入检查', exact: true }).click();

  await check.getByRole('row').filter({ hasText: '核对模式选项' }).getByRole('button', { name: '定位问题', exact: true }).click();
  await expect(modal(page, '编辑内部状态').locator('[data-authoring-field="optionKey"].authoring-field-active')).toBeVisible();
  await closeEditor(page, '编辑内部状态');
  await closeEditor(page, '过程与内部状态 - 秘术射击', '关闭');
  await page.getByRole('button', { name: '返回录入检查', exact: true }).click();

  await check.getByRole('row').filter({ hasText: '挂载技能缺失' }).getByRole('button', { name: '定位问题', exact: true }).click();
  await expect(modal(page, '关联技能 · 测试英雄')).toBeVisible();
  await modal(page, '关联技能 · 测试英雄').getByRole('button', { name: '关闭', exact: true }).click();
  await expect(check.getByText(/结构检查：发现 3 项错误/)).toBeVisible();
  assertClean();
});
