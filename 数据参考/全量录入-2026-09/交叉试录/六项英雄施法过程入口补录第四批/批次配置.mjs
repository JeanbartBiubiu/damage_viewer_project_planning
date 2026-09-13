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

const source5 = '数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第五批/完整候选.json';
const source6 = '数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第六批/完整候选.json';
const source7 = '数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第七批/完整候选.json';

export const batchConfig = {
  schemaVersion: 1,
  sourceVersion: '客户端16.17/官方16.17.1',
  scope: '特朗德尔Q/E/R、沃里克R、贾克斯W和魔腾E六项已有主动施法过程入口规则',
  expectedCurrent: {
    skillCount: 1062,
    ruleCount: 158,
    sourceInitializedCount: 29,
    finalRuleCount: 164,
    finalSourceInitializedCount: 29
  },
  concurrency: 8,
  runtimeBoundary: '六条规则只启动当前已有cast过程；不产生普通攻击、实际命中、伤害、治疗、控制、地形或状态，Wasm组装、宿主技能使用事件和真实战斗尚未验证。',
  reviewBoundary: '独立批准只覆盖冻结的六个主动使用入口；不批准各技能剩余攻击、命中、伤害、治疗、控制、地形、状态或阶段分支。',
  writeBoundary: '仅创建独立批准散列覆盖的六条启动cast过程规则并即时回读；其余技能组成和运行边界不变。',
  readbackBoundary: '独立检查器只发GET；既有158条规则的完整事件明细与更新时间、六项目标非规则组成均不变，六条新增规则精确匹配冻结请求。',
  pageTargetBoundary: '只包含已写入且独立回读通过的六项过程入口；未接攻击、伤害、治疗、控制、地形和状态分支不进入页面目标。',
  manifestBoundary: '六条过程入口、独立批准、两路完整GET回读和真实页面通过；普通攻击、实际命中、伤害、治疗、控制、地形、状态、Wasm组装、宿主事件及真实战斗未执行。',
  targets: [
    {
      id: 'trundle_q_start_cast', ownerKind: 'character', ownerKey: 'champion_trundle', skillKey: 'trundle_q', skillName: '特朗德尔·利齿撕咬', sourceFile: source5,
      sourceSha256: '45a9e350cee18e57166d7de166dbcc44035e32b4a224da749e7d2189f96f6fef',
      rule: startProcessRule('trundle_q', '主动使用启动利齿撕咬施法过程', '接收trundle_q主动使用并启动已有cast过程，处理已保存的法力消耗、基础冷却和7秒内等待下一次真实普攻命中的步骤；额外伤害、暴击组合、攻击力转移、减速与法术护盾边界继续暂缓。管理保存不证明宿主已生产该事件或普攻命中。', '启动利齿撕咬施法过程')
    },
    {
      id: 'trundle_e_start_cast', ownerKind: 'character', ownerKey: 'champion_trundle', skillKey: 'trundle_e', skillName: '特朗德尔·寒冰之柱', sourceFile: source5,
      sourceSha256: '45a9e350cee18e57166d7de166dbcc44035e32b4a224da749e7d2189f96f6fef',
      rule: startProcessRule('trundle_e', '主动使用启动寒冰之柱施法过程', '接收trundle_e主动使用并启动已有cast过程，只处理已保存的法力消耗、基础冷却和施法延迟；冰柱生成、初始击退、不可通行地形、邻近减速和范围边界继续暂缓。管理保存不证明宿主已生产该事件。', '启动寒冰之柱施法过程')
    },
    {
      id: 'trundle_r_start_cast', ownerKind: 'character', ownerKey: 'champion_trundle', skillKey: 'trundle_r', skillName: '特朗德尔·强权至上', sourceFile: source5,
      sourceSha256: '45a9e350cee18e57166d7de166dbcc44035e32b4a224da749e7d2189f96f6fef',
      rule: startProcessRule('trundle_r', '主动使用启动强权至上施法过程', '接收trundle_r主动使用并启动已有cast过程，只处理已保存的法力消耗、基础冷却和施法延迟；吸取周期、伤害与治疗时点、目标双抗快照、偷取累积及返还继续暂缓。管理保存不证明宿主已生产该事件。', '启动强权至上施法过程')
    },
    {
      id: 'warwick_r_start_cast', ownerKind: 'character', ownerKey: 'champion_warwick', skillKey: 'warwick_r', skillName: '沃里克·无尽束缚', sourceFile: source5,
      sourceSha256: '45a9e350cee18e57166d7de166dbcc44035e32b4a224da749e7d2189f96f6fef',
      rule: startProcessRule('warwick_r', '主动使用启动无尽束缚施法过程', '接收warwick_r主动使用并启动已有cast过程，只处理已保存的法力消耗、基础冷却和立即步骤；碰撞资格、引导中断、三次伤害分配、治疗、压制、攻击特效和施法时间冲突继续暂缓。管理保存不证明宿主已生产该事件。', '启动无尽束缚施法过程')
    },
    {
      id: 'jax_w_start_cast', ownerKind: 'character', ownerKey: 'champion_jax', skillKey: 'jax_w', skillName: '贾克斯·蓄力一击', sourceFile: source6,
      sourceSha256: 'a593bd1f49c1ab6f424bd76b7ad4dbef1e0e7154f00d0347dc90c7c1e39126ac',
      rule: startProcessRule('jax_w', '主动使用启动蓄力一击施法过程', '接收jax_w主动使用并启动已有cast过程，只处理已保存的法力消耗、基础冷却和立即步骤；下次普攻或跳斩的互斥消费、强化窗口、额外伤害和普攻重置继续暂缓。管理保存不证明宿主已生产该事件。', '启动蓄力一击施法过程')
    },
    {
      id: 'nocturne_e_start_cast', ownerKind: 'character', ownerKey: 'champion_nocturne', skillKey: 'nocturne_e', skillName: '魔腾·无言恐惧', sourceFile: source7,
      sourceSha256: 'b3908f6740ea02c32828e52044b78f4c6ed080fea7d7a3e6188641fcf3766b35',
      rule: startProcessRule('nocturne_e', '主动使用启动无言恐惧施法过程', '接收nocturne_e主动使用并启动已有cast过程，只处理已保存的法力消耗、基础冷却和立即步骤；伤害跳频、灵链持续资格、恐惧状态、行动限制与朝目标移动速度继续暂缓。管理保存不证明宿主已生产该事件。', '启动无言恐惧施法过程')
    }
  ]
};
