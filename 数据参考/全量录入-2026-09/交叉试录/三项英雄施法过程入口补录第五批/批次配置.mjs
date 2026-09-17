const startProcessRule = (skillKey, ruleName, description, actionName) => ({
  ruleKey: 'on_used',
  name: ruleName,
  description,
  sortOrder: 10,
  eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: skillKey, useKind: 'ACTIVE' } },
  conditionGroups: [],
  actions: [{
    actionKey: 'start_cast',
    name: actionName,
    actionType: 'START_PROCESS',
    sortOrder: 10,
    targetContext: 'CURRENT_TARGET',
    detail: { processKey: 'cast' },
    runtimeInputBindings: [],
    resultModifiers: []
  }],
  perTargetCooldown: null,
  maxTriggersPerProcess: null
});

const adaptedSource = '数据参考/全量录入-2026-09/交叉试录/三项英雄施法过程入口补录第五批/旧版规范化来源候选.json';

export const batchConfig = {
  schemaVersion: 1,
  sourceVersion: '客户端16.17/官方16.17.1',
  scope: '内瑟斯W/R和拉克丝W三项已有主动施法过程入口规则',
  expectedCurrent: {
    skillCount: 1062,
    ruleCount: 164,
    sourceInitializedCount: 29,
    finalRuleCount: 167,
    finalSourceInitializedCount: 29
  },
  concurrency: 8,
  runtimeBoundary: '三条规则只启动当前已有cast过程；不产生实际命中、减速、属性、周期伤害、冷却修正或护盾，Wasm组装、宿主技能使用事件和真实战斗尚未验证。',
  reviewBoundary: '独立批准只覆盖冻结的三个主动使用入口；不批准各技能剩余命中、减速、属性、周期伤害、冷却修正、护盾或阶段分支。',
  writeBoundary: '仅创建独立批准散列覆盖的三条启动cast过程规则并即时回读；其余技能组成和运行边界不变。',
  readbackBoundary: '独立检查器只发GET；既有164条规则的完整事件明细与更新时间、三项目标非规则组成均不变，三条新增规则精确匹配冻结请求。',
  pageTargetBoundary: '只包含已写入且独立回读通过的三项过程入口；未接减速、属性、周期伤害、冷却修正和护盾分支不进入页面目标。',
  manifestBoundary: '三条过程入口、独立批准、两路完整GET回读和真实页面通过；实际命中、减速、属性、周期伤害、冷却修正、护盾、Wasm组装、宿主事件及真实战斗未执行。',
  targets: [
    {
      id: 'nasus_w_start_cast', ownerKind: 'character', ownerKey: 'champion_nasus', skillKey: 'nasus_w', skillName: '内瑟斯·枯萎', sourceFile: adaptedSource,
      sourceSha256: 'e186836aacf1d8f4f9d5d9398fd45fabf4314217c6a321c149de8e9bb218dbaa',
      rule: startProcessRule('nasus_w', '主动使用启动枯萎施法过程', '接收nasus_w主动使用并启动已有cast过程，只处理已保存的法力消耗、基础冷却和施法延迟；渐进减速更新时间、攻击速度降低、控制类别与实际命中继续暂缓。管理保存不证明宿主已生产该事件。', '启动枯萎施法过程')
    },
    {
      id: 'nasus_r_start_cast', ownerKind: 'character', ownerKey: 'champion_nasus', skillKey: 'nasus_r', skillName: '内瑟斯·死神降临', sourceFile: adaptedSource,
      sourceSha256: 'e186836aacf1d8f4f9d5d9398fd45fabf4314217c6a321c149de8e9bb218dbaa',
      rule: startProcessRule('nasus_r', '主动使用启动死神降临施法过程', '接收nasus_r主动使用并启动已有cast过程，只处理已保存的法力消耗、基础冷却和施法延迟；自身属性、周期魔法伤害、首次结算与完整次数、Q冷却折半的施加时点继续暂缓。管理保存不证明宿主已生产该事件。', '启动死神降临施法过程')
    },
    {
      id: 'lux_w_start_cast', ownerKind: 'character', ownerKey: 'champion_lux', skillKey: 'lux_w', skillName: '拉克丝·曲光屏障', sourceFile: adaptedSource,
      sourceSha256: 'e186836aacf1d8f4f9d5d9398fd45fabf4314217c6a321c149de8e9bb218dbaa',
      rule: startProcessRule('lux_w', '主动使用启动曲光屏障施法过程', '接收lux_w主动使用并启动已有cast过程，只处理已保存的法力消耗、基础冷却和施法延迟；护盾施加时点、去程与回程命中、目标资格和护盾叠加继续暂缓。管理保存不证明宿主已生产该事件。', '启动曲光屏障施法过程')
    }
  ]
};
