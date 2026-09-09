import { readFile } from 'node:fs/promises';

export {
  evidence, clean, levels, val, fval, fixed, pn, attr, op, add, sub, mul, div, min, max,
  valueRule, behavior, life, begin, parameter, data, literal, runtime, unknownCurve,
  formula, result, effect, manaEffect, resourceEffect, common, pending, exclude, excludeData,
  requireCalc, markCalc, sourceProof, statEffect, finish
};

const evidence = JSON.parse(await readFile(new URL('./根绑定与数值证据.json', import.meta.url), 'utf8'));
const textEvidence = JSON.parse(await readFile(new URL('./补充文本证据.json', import.meta.url), 'utf8'));
const clean = value => Math.round(Number(value) * 1000000) / 1000000;
const levels = values => Object.fromEntries(values.map((value, index) => [String(index + 1), value]));
const val = parameterKey => ({ kind: 'PARAMETER', parameterKey });
const fval = formulaKey => ({ kind: 'FORMULA', formulaKey });
const fixed = value => ({ kind: 'FIXED', value });
const pn = parameterKey => ({ nodeType: 'PARAMETER', parameterKey });
const attr = (attributeKey, attributeOwner = 'SOURCE', attributeValueKind = 'TOTAL') => ({
  nodeType: 'ATTRIBUTE',
  attributeOwner,
  attributeKey,
  attributeValueKind
});
const op = (operation, left, right) => ({ nodeType: 'OPERATION', operation, operands: [left, right] });
const add = (...items) => items.reduce((left, right) => op('ADD', left, right));
const sub = (left, right) => op('SUBTRACT', left, right);
const mul = (left, right) => op('MULTIPLY', left, right);
const div = (left, right) => op('DIVIDE', left, right);
const min = (left, right) => op('MIN', left, right);
const max = (left, right) => op('MAX', left, right);
const valueRule = value => ({ value, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null });
const behavior = {
  moment: 'PERSISTENT',
  valueReadMode: 'APPLICATION_SNAPSHOT',
  stackValueMode: 'SHARED',
  reapplicationValueMode: 'REPLACE',
  periodicExecutionMode: null
};
const life = durationValue => ({
  durationValue,
  maxStacksValue: fixed(1),
  applicationStacksValue: fixed(1),
  instanceScope: 'SOURCE',
  reapplicationStackMode: 'KEEP',
  reapplicationDurationMode: durationValue ? 'REFRESH_ALL' : null,
  expiryMode: durationValue ? 'ALL_AT_ONCE' : 'EXPLICIT_ONLY',
  periodicIntervalValue: null,
  firstPeriodicExecution: null
});

const expressionNodeTypes = new Set(['PARAMETER', 'ATTRIBUTE', 'OPERATION']);
function assertExpression(node, path) {
  if (!node || typeof node !== 'object' || !expressionNodeTypes.has(node.nodeType)) {
    throw Error('公式表达式含不支持节点 ' + path + '；只允许参数、属性和二元运算');
  }
  if (node.nodeType === 'PARAMETER' && !node.parameterKey) {
    throw Error('公式表达式参数键缺失 ' + path);
  }
  if (node.nodeType === 'ATTRIBUTE' && (!node.attributeOwner || !node.attributeKey || !node.attributeValueKind)) {
    throw Error('公式表达式属性字段缺失 ' + path);
  }
  if (node.nodeType === 'OPERATION') {
    if (!Array.isArray(node.operands) || node.operands.length !== 2) {
      throw Error('公式表达式必须使用二元运算 ' + path);
    }
    node.operands.forEach((child, index) => assertExpression(child, path + '.operands[' + index + ']'));
  }
}

export const plan = {
  meta: {
    executor: '第十七批由Codex执行代理准备；只读来源与候选，未业务写入',
    gameId: 'lol',
    note: '客户端16.17、官方16.17.1与构建16.17.8104348来源已冻结；本批只生成候选和写前意图，不调用业务写接口。',
    sources: evidence.heroes.map(hero => ({ id: hero.id, client: hero.client, official: hero.official })),
    scope: '弗拉基米尔、斯维因、兰博、奥瑞利安·索尔各P/Q/W/E/R，共20个技能位。保留已有公共参数、来源明确的技能数值、明确数学关系、单一敌人收益、非即时资源和自身效果。独立召唤、完整变形替换、纯视觉、金币经验、多目标分摊和未知事件链留在来源证据或范围说明中。',
    unitPolicy: '正文直接写百分号或乘100的值按来源实值判定；比例参数使用0至1，百分数点使用原值，不能仅因字段名再次乘0.01。秒转换为毫秒只用于明确的时长参数。未知等级曲线、断点和运行输入不猜线性、不补端点、不默认零。',
    attributeBoundary: '法强只按当前同版本树中明确的SOURCE/TOTAL/ability_power窄口径使用；生命值只在根树已明确所有者和取值类型时绑定，无法确认的输入使用无默认的RUNTIME_INPUT。Rumble热量不映射到mana，AurelionSol星尘和Swain魂屑只保留进度输入，不造自动叠层。',
    forbidden: '本批不生成DAMAGE、DIRECT_HEAL、瞬时结果、自动触发、过程、内部状态或规则；所有自益和资源效果只表示可独立定义的组成，触发与接线待后续系统工作。'
  },
  skills: {}
};

function findSpell(skillKey) {
  for (const hero of evidence.heroes) {
    const spell = hero.spells.find(item => item.skillKey === skillKey);
    if (spell) return { hero, spell };
  }
  return null;
}

function begin(skillKey) {
  const found = findSpell(skillKey);
  if (!found) throw Error('来源证据缺技能 ' + skillKey);
  const { hero, spell } = found;
  const candidate = {
    skillKey,
    name: spell.official.name,
    maxLevel: spell.maxrank ?? 1,
    source: {
      hero: hero.id,
      rootPath: hero.rootPath,
      spellPath: spell.binding,
      clientSha256: hero.client.sha256,
      officialSha256: hero.official.sha256,
      currentBoundText: textEvidence.skills?.[skillKey] ?? null
    },
    write: {
      parameters: [],
      formulas: [],
      effects: [],
      processes: [],
      internalStates: [],
      triggerRules: []
    },
    proofs: [],
    pending: [],
    excluded: []
  };
  plan.skills[skillKey] = candidate;
  return { c: candidate, s: spell.official, p: spell.object.mSpell };
}

function parameter(x, key, name, values, description, mode) {
  const array = (Array.isArray(values) ? values : [values]).map(clean);
  if (!array.length || !array.every(Number.isFinite)) throw Error('缺值 ' + x.c.skillKey + '/' + key);
  const variable = mode === 'SKILL_LEVEL' || (mode == null && new Set(array).size > 1);
  const body = {
    parameterKey: key,
    name,
    valueType: array.every(Number.isInteger) ? 'INTEGER' : 'DECIMAL',
    valueMode: mode ?? (variable ? 'SKILL_LEVEL' : 'FIXED'),
    fixedValue: variable ? null : array[0],
    levelValues: variable ? levels(array) : null,
    description,
    sortOrder: (x.c.write.parameters.length + 1) * 10
  };
  x.c.write.parameters.push(body);
  return pn(key);
}

function rawData(x, source) {
  return (x.p.DataValues ?? x.p.mDataValues ?? []).find(item => (item.name ?? item.mName) === source);
}

function data(x, source, key, name, options = {}) {
  const rawEntry = rawData(x, source);
  const raw = rawEntry?.values ?? rawEntry?.mValues;
  const offset = options.offset ?? 1;
  const count = x.c.maxLevel;
  if (!Array.isArray(raw) || raw.length < count + offset) {
    throw Error('数据字段缺失 ' + x.c.skillKey + '/' + source);
  }
  const scale = options.scale ?? 1;
  const values = raw.slice(offset, offset + count).map(value => clean(Number(value) * scale));
  x.c.proofs.push({
    parameterKey: key,
    source: 'DataValues.' + source,
    raw,
    offset,
    values,
    scale
  });
  const unit = options.unit ? '；单位' + options.unit : '';
  const conversion = scale === 1 ? '' : '；按来源单位换算为系统比例或毫秒';
  return parameter(
    x,
    key,
    name,
    values,
    options.description ?? ('客户端当前根绑定 DataValues.' + source + ' 取索引' + offset + '至' + (offset + count - 1) + unit + conversion),
    options.mode
  );
}

function literal(x, key, name, value, description, source, mode) {
  const values = Array.isArray(value) ? value : [value];
  x.c.proofs.push({ parameterKey: key, source: source ?? '官方中文正文或明确派生', values });
  return parameter(x, key, name, value, description, mode);
}

function runtime(x, key, name, description, type = 'DECIMAL') {
  x.c.write.parameters.push({
    parameterKey: key,
    name,
    valueType: type,
    valueMode: 'RUNTIME_INPUT',
    fixedValue: null,
    levelValues: null,
    description,
    sortOrder: (x.c.write.parameters.length + 1) * 10
  });
}

function unknownCurve(x, key, name, raw, source, description, type = 'DECIMAL') {
  runtime(x, key, name + '（实际值外供）', description, type);
  x.c.proofs.push({ parameterKey: key, source, raw, values: null, sourcePending: true, semantic: description });
  pending(x, '等级曲线或断点求值：' + key, description, '来源');
  return pn(key);
}

function formula(x, key, name, expression, description) {
  assertExpression(expression, x.c.skillKey + '/' + key);
  x.c.write.formulas.push({
    formulaKey: key,
    name,
    expression,
    description,
    sortOrder: (x.c.write.formulas.length + 1) * 10
  });
}

function result(key, name, resultType, target, value, detail, lifecycleBehavior = null, block = null, description = null) {
  return {
    resultKey: key,
    name,
    resultType,
    target,
    description,
    sortOrder: 10,
    lifecycleBehavior,
    spellShieldBlockScope: block,
    valueRule: value ? valueRule(value) : null,
    detail
  };
}

function effect(x, key, name, results, lifecycle = null, description = null) {
  x.c.write.effects.push({
    effectKey: key,
    name,
    description,
    sortOrder: (x.c.write.effects.length + 1) * 10,
    lifecycle,
    results
  });
}

function manaEffect(x, description = '仅记录官方基础法力消耗；实际扣除资格、扣除时点与资源不足处理尚未接线。') {
  if (!x.c.write.parameters.some(item => item.parameterKey === 'mana_cost')) return;
  if (x.c.write.effects.some(item => item.effectKey === 'mana_cost')) return;
  effect(
    x,
    'mana_cost',
    '施放法力消耗',
    [result('consume_mana', '消耗法力', 'RESOURCE_CHANGE', 'SOURCE', val('mana_cost'), { attributeKey: 'mana', operation: 'CONSUME' })],
    null,
    description
  );
}

function resourceEffect(x, key, name, value, attributeKey, operation, description) {
  effect(
    x,
    key,
    name,
    [result('resource', name, 'RESOURCE_CHANGE', 'SOURCE', value, { attributeKey, operation })],
    null,
    description
  );
}

function statEffect(x, key, name, value, attributeKey, options = {}) {
  const duration = options.duration ?? null;
  const lifecycle = life(duration);
  effect(
    x,
    key,
    name,
    [result(
      'attribute',
      name,
      'ATTRIBUTE_CHANGE',
      options.target ?? 'SOURCE',
      value,
      { attributeKey, operation: options.operation ?? 'INCREASE', modifierZoneKey: 'attribute_flat_add' },
      behavior
    )],
    lifecycle,
    options.description ?? '独立自身属性效果；实际触发、应用时点和取消条件尚未接线。'
  );
}

function common(x, options = {}) {
  const useCooldown = options.cooldown !== false;
  const useMana = options.mana !== false;
  const useCast = options.cast !== false;
  const official = x.s;
  const n = x.c.maxLevel;
  const p = x.p;
  if (useCooldown) {
    if (!Array.isArray(official.cooldown) || official.cooldown.length !== n) {
      throw Error('官方冷却数组缺失 ' + x.c.skillKey);
    }
    const root = Array.isArray(p.cooldownTime) ? p.cooldownTime.slice(1, n + 1) : null;
    const matches = root && root.length === n && root.every((value, index) => Math.abs(Number(value) - Number(official.cooldown[index])) < 0.0001);
    literal(
      x,
      'cooldown_ms',
      '基础冷却时间（毫秒）',
      official.cooldown.map(value => Math.round(Number(value) * 1000)),
      matches
        ? '官方逐级冷却与当前根cooldownTime索引1至等级上限逐级一致；不含技能急速或其他技能修正。'
        : '官方逐级冷却作为冻结候选；当前根cooldownTime缺失或逐级不一致，保留差异，不把缺失当作零。',
      matches ? 'official.cooldown + mSpell.cooldownTime' : 'official.cooldown；根cooldownTime差异'
    );
    if (!matches) pending(x, '官方冷却与当前根字段差异', '官方逐级冷却和当前根cooldownTime没有逐级一致证据；本批保留官方值，根字段继续留源。', '来源');
  }
  if (useMana) {
    if (!Array.isArray(official.cost) || official.cost.length !== n) {
      throw Error('官方法力数组缺失 ' + x.c.skillKey);
    }
    if (official.cost.every(value => Number(value) === 0)) {
      sourceProof(x, 'official.cost', official.cost, '官方基础成本全为0；不创建0法力参数或效果。', { excluded: true });
    } else {
      const root = Array.isArray(p.manaValues?.values) ? p.manaValues.values.slice(0, n) : null;
      const matches = root && root.length === n && root.every((value, index) => Math.abs(Number(value) - Number(official.cost[index])) < 0.0001);
      literal(
        x,
        'mana_cost',
        '基础法力消耗',
        official.cost,
        matches
          ? '官方cost与当前根manaValues逐级一致；法力值；未包含持续资源。'
          : '官方cost保留基础法力消耗；当前根manaValues缺失或逐级不一致，保留差异，不将缺失当作零。',
        matches ? 'official.cost + mSpell.manaValues' : 'official.cost；根manaValues差异'
      );
      if (!matches) pending(x, '官方法力与当前根字段差异', '官方cost和当前根manaValues没有逐级一致证据；本批保留官方值，根字段继续留源。', '来源');
      manaEffect(x);
    }
  }
  if (useCast) {
    if (Number.isFinite(p.spellCastTime)) {
      if (Number(p.spellCastTime) < 0) {
        sourceProof(
          x,
          'mSpell.spellCastTime',
          p.spellCastTime,
          '当前根spellCastTime为负值，只保留原始字段和未知语义，不生成可操作的负施法时长。',
          { sourcePending: true }
        );
        pending(x, '负施法时长字段语义', '当前根spellCastTime为负值，不能转换成实际施法毫秒；等待来源确认后再决定是否有可用施法时长。', '来源');
      } else if (p.mCastTime != null && Math.abs(Number(p.spellCastTime) - Number(p.mCastTime)) > 0.0001) {
        pending(x, 'spellCastTime与mCastTime冲突', '当前根两个施法时长字段不一致；不擅自选择其中一个作为完整命中时点。', '来源');
      } else {
        literal(x, 'cast_time_ms', '施法时间（毫秒）', Math.round(Number(p.spellCastTime) * 1000), '当前根spellCastTime；仅保存根字段，不表示命中发生在施法结束。', 'mSpell.spellCastTime');
      }
    } else {
      pending(x, '施法时间缺失', '当前根没有可用spellCastTime；不补写0毫秒。', '来源');
    }
  }
}

function requireCalc(x, key) {
  const calculation = x.p.mSpellCalculations?.[key];
  if (!calculation) throw Error('缺计算树 ' + x.c.skillKey + '/' + key);
  return calculation;
}

function markCalc(x, key, semantic) {
  sourceProof(x, 'mSpellCalculations.' + key, requireCalc(x, key), semantic);
}

function sourceProof(x, source, raw, semantic, extra = {}) {
  x.c.proofs.push({ source, raw, semantic, ...extra });
}

function pending(x, component, reason, kind = '配置') {
  x.c.pending.push({ kind, component, reason });
}

function exclude(x, component, reason) {
  x.c.excluded.push({ component, reason });
}

function excludeData(x, source, semantic) {
  const item = rawData(x, source);
  x.c.proofs.push({
    source: 'DataValues.' + source,
    raw: item?.values ?? item?.mValues ?? null,
    excluded: true,
    semantic
  });
}

function finish(x) {
  for (const item of x.p.DataValues ?? x.p.mDataValues ?? []) {
    const source = 'DataValues.' + (item.name ?? item.mName);
    if (!x.c.proofs.some(proof => proof.source === source)) {
      sourceProof(x, source, item.values ?? item.mValues ?? null, '原始数据字段完整留源；当前候选没有独立数值消费，不按字段名猜测含义。', { sourcePending: true });
    }
  }
  for (const key of Object.keys(x.p.mSpellCalculations ?? {})) {
    const source = 'mSpellCalculations.' + key;
    if (!x.c.proofs.some(proof => proof.source === source)) {
      sourceProof(x, source, requireCalc(x, key), '原始计算树完整留源；当前候选没有独立消费，不重复创建无消费者公式。', { sourcePending: true });
    }
  }
  x.c.disposition = {
    范围外: x.c.excluded,
    来源待核: x.c.pending.filter(item => item.kind === '来源'),
    系统缺口: x.c.pending.filter(item => item.kind === '系统'),
    尚未接线: x.c.pending.filter(item => !['来源', '系统'].includes(item.kind))
  };
  x.c.status = '确定组成候选；未保存、未接线和范围外分支不表示完整战斗机制';
}
