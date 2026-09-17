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
  scope: '阿狸W、黛安娜R、卢锡安E、图奇W、沃里克Q和赵信Q六项已有主动施法过程入口规则',
  expectedCurrent: {
    skillCount: 1062,
    ruleCount: 146,
    sourceInitializedCount: 29,
    finalRuleCount: 152,
    finalSourceInitializedCount: 29
  },
  concurrency: 8,
  runtimeBoundary: '六条规则只启动当前已有cast过程；不产生实际命中、伤害、治疗、控制、叠层或位移，Wasm组装、宿主技能使用事件和真实战斗尚未验证。',
  reviewBoundary: '独立批准只覆盖冻结的六个主动使用入口；不批准各技能剩余命中、伤害、治疗、控制、叠层、位移或阶段分支。',
  writeBoundary: '仅创建独立批准散列覆盖的六条启动cast过程规则并即时回读；其余技能组成和运行边界不变。',
  readbackBoundary: '独立检查器只发GET；既有146条规则的完整事件明细与更新时间、六项目标非规则组成均不变，六条新增规则精确匹配冻结请求。',
  pageTargetBoundary: '只包含已写入且独立回读通过的六项过程入口；未接伤害、控制和阶段分支不进入页面目标。',
  manifestBoundary: '六条过程入口、独立批准、两路完整GET回读和真实页面通过；实际命中、伤害、治疗、控制、叠层、位移、Wasm组装、宿主事件及真实战斗未执行。',
  targets: [
    {
      id: 'ahri_w_start_cast', ownerKind: 'character', ownerKey: 'champion_ahri', skillKey: 'ahri_w', skillName: '阿狸·妖异狐火', sourceFile: source4,
      sourceSha256: '4d79b512033733cb164cc20a02030fb17b0bf8bdecd4124c0b3162a664282034',
      rule: startProcessRule('ahri_w', '主动使用启动妖异狐火施法过程', '接收ahri_w主动使用并启动已有cast过程，只处理已保存的法力消耗、基础冷却和施法延迟；狐火实际命中、首个/后续命中计数与移动速度衰减继续暂缓。管理保存不证明宿主已生产该事件。', '启动妖异狐火施法过程')
    },
    {
      id: 'diana_r_start_cast', ownerKind: 'character', ownerKey: 'champion_diana', skillKey: 'diana_r', skillName: '黛安娜·月之降临', sourceFile: source4,
      sourceSha256: '4d79b512033733cb164cc20a02030fb17b0bf8bdecd4124c0b3162a664282034',
      rule: startProcessRule('diana_r', '主动使用启动月之降临施法过程', '接收diana_r主动使用并启动已有cast过程，只处理已保存的法力消耗、基础冷却和施法延迟；初始拉入、至少命中一名英雄资格、延迟爆炸、伤害、拖拽与减速继续暂缓。管理保存不证明宿主已生产该事件。', '启动月之降临施法过程')
    },
    {
      id: 'lucian_e_start_cast', ownerKind: 'character', ownerKey: 'champion_lucian', skillKey: 'lucian_e', skillName: '卢锡安·冷酷追击', sourceFile: source3,
      sourceSha256: 'c867ac7248907472d59dc39c3b19ed9f3d7d4e78e8a5ea19e98ba68606d4fd90',
      rule: startProcessRule('lucian_e', '主动使用启动冷酷追击施法过程', '接收lucian_e主动使用并启动已有cast过程，只处理已保存的法力消耗、基础冷却和施法延迟；冲刺路径、圣光银弹两发命中资格与冷却返还继续暂缓。管理保存不证明宿主已生产该事件。', '启动冷酷追击施法过程')
    },
    {
      id: 'twitch_w_start_cast', ownerKind: 'character', ownerKey: 'champion_twitch', skillKey: 'twitch_w', skillName: '图奇·剧毒之桶', sourceFile: source3,
      sourceSha256: 'c867ac7248907472d59dc39c3b19ed9f3d7d4e78e8a5ea19e98ba68606d4fd90',
      rule: startProcessRule('twitch_w', '主动使用启动剧毒之桶施法过程', '接收twitch_w主动使用并启动已有cast过程，只处理已保存的法力消耗、基础冷却和施法延迟；桶实际命中、停留周期叠毒、减速与毒层统一继续暂缓。管理保存不证明宿主已生产该事件。', '启动剧毒之桶施法过程')
    },
    {
      id: 'warwick_q_start_cast', ownerKind: 'character', ownerKey: 'champion_warwick', skillKey: 'warwick_q', skillName: '沃里克·野兽之口', sourceFile: source5,
      sourceSha256: '45a9e350cee18e57166d7de166dbcc44035e32b4a224da749e7d2189f96f6fef',
      rule: startProcessRule('warwick_q', '主动使用启动野兽之口施法过程', '接收warwick_q主动使用并启动已有cast过程，只处理已保存的法力消耗和基础冷却；秒放/蓄力释放、一次性实际撕咬、攻击特效、治疗实际伤害口径与强制位移免疫继续暂缓。管理保存不证明宿主已生产该事件。', '启动野兽之口施法过程')
    },
    {
      id: 'xinzhao_q_start_cast', ownerKind: 'character', ownerKey: 'champion_xinzhao', skillKey: 'xinzhao_q', skillName: '赵信·三重爪击', sourceFile: source5,
      sourceSha256: '45a9e350cee18e57166d7de166dbcc44035e32b4a224da749e7d2189f96f6fef',
      rule: startProcessRule('xinzhao_q', '主动使用启动三重爪击施法过程', '接收xinzhao_q主动使用并启动已有cast过程，只处理已保存的法力消耗、基础冷却和施法延迟；三次强化攻击消费、额外伤害、其他技能冷却减少、第三击飞与被动计数继续暂缓。管理保存不证明宿主已生产该事件。', '启动三重爪击施法过程')
    }
  ]
};
