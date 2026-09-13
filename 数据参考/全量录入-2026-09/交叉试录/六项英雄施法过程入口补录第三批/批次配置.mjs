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

const source3 = '数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第三批/录入候选.json';
const source4 = '数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第四批/录入候选.json';
const source5 = '数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第五批/完整候选.json';

export const batchConfig = {
  schemaVersion: 1,
  sourceVersion: '客户端16.17/官方16.17.1',
  scope: '图奇Q/E、维迦E/R、沃里克W和特朗德尔W六项已有主动施法过程入口规则',
  expectedCurrent: {
    skillCount: 1062,
    ruleCount: 152,
    sourceInitializedCount: 29,
    finalRuleCount: 158,
    finalSourceInitializedCount: 29
  },
  concurrency: 8,
  runtimeBoundary: '六条规则只启动当前已有cast过程；不产生伪装、实际命中、伤害、控制、区域增益或目标选择，Wasm组装、宿主技能使用事件和真实战斗尚未验证。',
  reviewBoundary: '独立批准只覆盖冻结的六个主动使用入口；不批准各技能剩余伪装、命中、伤害、控制、区域、目标选择或阶段分支。',
  writeBoundary: '仅创建独立批准散列覆盖的六条启动cast过程规则并即时回读；其余技能组成和运行边界不变。',
  readbackBoundary: '独立检查器只发GET；既有152条规则的完整事件明细与更新时间、六项目标非规则组成均不变，六条新增规则精确匹配冻结请求。',
  pageTargetBoundary: '只包含已写入且独立回读通过的六项过程入口；未接伪装、伤害、控制、区域和目标分支不进入页面目标。',
  manifestBoundary: '六条过程入口、独立批准、两路完整GET回读和真实页面通过；伪装、实际命中、伤害、控制、区域增益、目标选择、Wasm组装、宿主事件及真实战斗未执行。',
  targets: [
    {
      id: 'twitch_q_start_cast', ownerKind: 'character', ownerKey: 'champion_twitch', skillKey: 'twitch_q', skillName: '图奇·埋伏', sourceFile: source3,
      sourceSha256: 'c867ac7248907472d59dc39c3b19ed9f3d7d4e78e8a5ea19e98ba68606d4fd90',
      rule: startProcessRule('twitch_q', '主动使用启动埋伏施法过程', '接收twitch_q主动使用并启动已有cast过程，只处理已保存的法力消耗、基础冷却和施法延迟；伪装等待与进出、解除后攻速、移动速度条件和中毒英雄死亡重置继续暂缓。管理保存不证明宿主已生产该事件。', '启动埋伏施法过程')
    },
    {
      id: 'twitch_e_start_cast', ownerKind: 'character', ownerKey: 'champion_twitch', skillKey: 'twitch_e', skillName: '图奇·毒性爆发', sourceFile: source3,
      sourceSha256: 'c867ac7248907472d59dc39c3b19ed9f3d7d4e78e8a5ea19e98ba68606d4fd90',
      rule: startProcessRule('twitch_e', '主动使用启动毒性爆发施法过程', '接收twitch_e主动使用并启动已有cast过程，只处理已保存的法力消耗、基础冷却和施法延迟；目标中毒资格、实际1至6层读取及两部分伤害继续暂缓，不清除毒层。管理保存不证明宿主已生产该事件。', '启动毒性爆发施法过程')
    },
    {
      id: 'veigar_e_start_cast', ownerKind: 'character', ownerKey: 'champion_veigar', skillKey: 'veigar_e', skillName: '维迦·扭曲空间', sourceFile: source4,
      sourceSha256: '4d79b512033733cb164cc20a02030fb17b0bf8bdecd4124c0b3162a664282034',
      rule: startProcessRule('veigar_e', '主动使用启动扭曲空间施法过程', '接收veigar_e主动使用并启动已有cast过程，只处理已保存的法力消耗、基础冷却和施法延迟；牢笼生成、边缘接触、重复触发、状态归属与眩晕行动限制继续暂缓。管理保存不证明宿主已生产该事件。', '启动扭曲空间施法过程')
    },
    {
      id: 'veigar_r_start_cast', ownerKind: 'character', ownerKey: 'champion_veigar', skillKey: 'veigar_r', skillName: '维迦·能量爆裂', sourceFile: source4,
      sourceSha256: '4d79b512033733cb164cc20a02030fb17b0bf8bdecd4124c0b3162a664282034',
      rule: startProcessRule('veigar_r', '主动使用启动能量爆裂施法过程', '接收veigar_r主动使用并启动已有cast过程，只处理已保存的法力消耗、基础冷却和施法延迟；目标当前或已损生命、连续伤害倍率、实际命中与伤害继续暂缓。管理保存不证明宿主已生产该事件。', '启动能量爆裂施法过程')
    },
    {
      id: 'warwick_w_start_cast', ownerKind: 'character', ownerKey: 'champion_warwick', skillKey: 'warwick_w', skillName: '沃里克·鲜血追猎', sourceFile: source5,
      sourceSha256: '45a9e350cee18e57166d7de166dbcc44035e32b4a224da749e7d2189f96f6fef',
      rule: startProcessRule('warwick_w', '主动使用启动鲜血追猎施法过程', '接收warwick_w主动使用并启动已有cast过程，只处理已保存的法力消耗、基础冷却和立即步骤；主动目标选择、未找到英雄冷却返还、攻速档位、朝目标移速和施法时间冲突继续暂缓。管理保存不证明宿主已生产该事件。', '启动鲜血追猎施法过程')
    },
    {
      id: 'trundle_w_start_cast', ownerKind: 'character', ownerKey: 'champion_trundle', skillKey: 'trundle_w', skillName: '特朗德尔·冰封领域', sourceFile: source5,
      sourceSha256: '45a9e350cee18e57166d7de166dbcc44035e32b4a224da749e7d2189f96f6fef',
      rule: startProcessRule('trundle_w', '主动使用启动冰封领域施法过程', '接收trundle_w主动使用并启动已有cast过程，只处理已保存的法力消耗、基础冷却和施法延迟；领域生成、进入、离开、结束、攻击速度、移动速度与治疗提升接线继续暂缓。管理保存不证明宿主已生产该事件。', '启动冰封领域施法过程')
    }
  ]
};
