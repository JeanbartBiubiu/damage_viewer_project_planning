const rule = {
  ruleKey: 'on_used',
  name: '主动使用启动透体之劲施法过程',
  description: '接收vi_e主动使用并启动已有cast过程，只处理已保存的法力消耗和立即步骤，不配置普通冷却；两次弹药、恢复时间、1秒静态冷却、强化窗口、普攻替换、伤害、身后范围和法术护盾资格继续暂缓。管理保存不证明宿主已生产该事件。',
  sortOrder: 10,
  eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'vi_e', useKind: 'ACTIVE' } },
  conditionGroups: [],
  actions: [{
    actionKey: 'start_cast',
    name: '启动透体之劲施法过程',
    actionType: 'START_PROCESS',
    sortOrder: 10,
    targetContext: 'CURRENT_TARGET',
    detail: { processKey: 'cast' },
    runtimeInputBindings: [],
    resultModifiers: []
  }],
  perTargetCooldown: null,
  maxTriggersPerProcess: null
};

export const batchConfig = {
  schemaVersion: 1,
  sourceVersion: '客户端16.17/官方16.17.1',
  scope: '蔚E已有主动施法过程入口规则',
  expectedCurrent: {
    skillCount: 1062,
    ruleCount: 167,
    sourceInitializedCount: 29,
    finalRuleCount: 168,
    finalSourceInitializedCount: 29
  },
  concurrency: 8,
  runtimeBoundary: '规则只启动当前已有cast过程并消耗已保存法力；不产生普通冷却、弹药恢复、强化普攻、实际命中或伤害，Wasm组装、宿主技能使用事件和真实战斗尚未验证。',
  reviewBoundary: '独立批准只覆盖冻结的蔚E主动使用入口；不批准弹药、恢复、强化窗口、普攻替换、命中、伤害、范围或法术护盾分支。',
  writeBoundary: '仅创建独立批准散列覆盖的一条启动cast过程规则并即时回读；其余技能组成和运行边界不变。',
  readbackBoundary: '独立检查器只发GET；既有167条规则的完整事件明细与更新时间、蔚E非规则组成均不变，新增规则精确匹配冻结请求。',
  pageTargetBoundary: '只包含已写入且独立回读通过的蔚E过程入口；未接弹药、普攻、伤害和法术护盾分支不进入页面目标。',
  manifestBoundary: '蔚E过程入口、独立批准、两路完整GET回读和真实页面通过；普通冷却、弹药恢复、强化普攻、实际命中、伤害、范围、法术护盾、Wasm组装、宿主事件及真实战斗未执行。',
  targets: [{
    id: 'vi_e_start_cast',
    ownerKind: 'character',
    ownerKey: 'champion_vi',
    skillKey: 'vi_e',
    skillName: '蔚·透体之劲',
    sourceFile: '数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第七批/完整候选.json',
    sourceSha256: 'b3908f6740ea02c32828e52044b78f4c6ed080fea7d7a3e6188641fcf3766b35',
    rule
  }]
};
