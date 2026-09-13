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

const source2 = '数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第二批/录入候选.json';
const source4 = '数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第四批/录入候选.json';
const source5 = '数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第五批/完整候选.json';

export const batchConfig = {
  schemaVersion: 1,
  sourceVersion: '客户端16.17/官方16.17.1',
  scope: '阿狸Q、布兰德W、德莱厄斯E和赵信W四项已有主动施法过程入口规则',
  expectedCurrent: {
    skillCount: 1062,
    ruleCount: 142,
    sourceInitializedCount: 29,
    finalRuleCount: 146,
    finalSourceInitializedCount: 29
  },
  concurrency: 8,
  runtimeBoundary: '四条规则只启动当前已有cast过程；不产生实际命中、伤害或控制，Wasm组装、宿主技能使用事件和真实战斗尚未验证。',
  reviewBoundary: '独立批准只覆盖冻结的四个主动使用入口；不批准伤害、命中、灼烧、穿透、拖拽、减速、挑战或其他阶段。',
  writeBoundary: '仅创建独立批准散列覆盖的四条启动cast过程规则并即时回读；其余技能组成和运行边界不变。',
  readbackBoundary: '独立检查器只发GET；既有142条规则的完整事件明细与更新时间、四项目标非规则组成均不变，四条新增规则精确匹配冻结请求。',
  pageTargetBoundary: '只包含已写入且独立回读通过的四项过程入口；未接伤害与控制分支不进入页面目标。',
  manifestBoundary: '四条过程入口、独立批准、两路完整GET回读和真实页面通过；实际命中、伤害、控制、Wasm组装、宿主事件及真实战斗未执行。',
  targets: [
    {
      id: 'ahri_q_start_cast',
      ownerKind: 'character',
      ownerKey: 'champion_ahri',
      skillKey: 'ahri_q',
      skillName: '阿狸·欺诈宝珠',
      sourceFile: source4,
      sourceSha256: '4d79b512033733cb164cc20a02030fb17b0bf8bdecd4124c0b3162a664282034',
      rule: startProcessRule(
        'ahri_q',
        '主动使用启动欺诈宝珠施法过程',
        '接收ahri_q主动使用并启动已有cast过程，只处理已保存的法力消耗、基础冷却和施法延迟；去程/返程、魔法/真实伤害、方向与实际命中继续暂缓。管理保存不证明宿主已生产该事件。',
        '启动欺诈宝珠施法过程'
      )
    },
    {
      id: 'brand_w_start_cast',
      ownerKind: 'character',
      ownerKey: 'champion_brand',
      skillKey: 'brand_w',
      skillName: '布兰德·烈焰之柱',
      sourceFile: source2,
      sourceSha256: 'dab2c80a74f4b7d8ad00d6dc933dd05fb553f47f241487d649b4e8809482a272',
      rule: startProcessRule(
        'brand_w',
        '主动使用启动烈焰之柱施法过程',
        '接收brand_w主动使用并启动已有cast过程，只处理已保存的法力消耗、基础冷却和施法延迟；火柱生成、实际命中、灼烧条件与强化伤害继续暂缓。管理保存不证明宿主已生产该事件。',
        '启动烈焰之柱施法过程'
      )
    },
    {
      id: 'darius_e_start_cast',
      ownerKind: 'character',
      ownerKey: 'champion_darius',
      skillKey: 'darius_e',
      skillName: '德莱厄斯·无情铁手',
      sourceFile: source4,
      sourceSha256: '4d79b512033733cb164cc20a02030fb17b0bf8bdecd4124c0b3162a664282034',
      rule: startProcessRule(
        'darius_e',
        '主动使用启动无情铁手施法过程',
        '接收darius_e主动使用并启动已有cast过程，只处理已保存的法力消耗、基础冷却和施法延迟；百分比穿透组合、实际拉中、拖拽、击飞和减速继续暂缓。管理保存不证明宿主已生产该事件。',
        '启动无情铁手施法过程'
      )
    },
    {
      id: 'xinzhao_w_start_cast',
      ownerKind: 'character',
      ownerKey: 'champion_xinzhao',
      skillKey: 'xinzhao_w',
      skillName: '赵信·风斩电刺',
      sourceFile: source5,
      sourceSha256: '45a9e350cee18e57166d7de166dbcc44035e32b4a224da749e7d2189f96f6fef',
      rule: startProcessRule(
        'xinzhao_w',
        '主动使用启动风斩电刺施法过程',
        '接收xinzhao_w主动使用并启动已有cast过程，只处理已保存的法力消耗和基础冷却；斩击/刺击阶段、实际命中、伤害、减速、挑战、被动联动与冲突施法时间继续暂缓。管理保存不证明宿主已生产该事件。',
        '启动风斩电刺施法过程'
      )
    }
  ]
};
