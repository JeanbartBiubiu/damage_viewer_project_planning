import { batchConfig as original } from '../批次配置.mjs';

const targets = structuredClone(original.targets);
const redemption = targets.find(item => item.skillKey === 'item_3107_active');
redemption.expectedParameters = redemption.expectedParameters.filter(key => key !== 'actual_target_max_health');
redemption.formulaUpdate = {
  formulaKey: 'enemy_true_damage',
  name: '干涉敌方真实伤害值',
  description: '0.1乘目标生命值属性的总值，得到当前敌方英雄最大生命值真实伤害；不再依赖技能命中事件无法提供的目标生命运行时参数。区域命中、2.5秒延迟、重复衰减和主动冷却仍未接线。',
  expression: {
    nodeType: 'OPERATION',
    operation: 'MULTIPLY',
    operands: [
      { nodeType: 'PARAMETER', parameterKey: 'enemy_true_damage_ratio' },
      { nodeType: 'ATTRIBUTE', attributeOwner: 'TARGET', attributeKey: 'hp', attributeValueKind: 'TOTAL' }
    ]
  },
  sortOrder: 10
};
redemption.expectedCurrentFormula = {
  formulaKey: 'enemy_true_damage',
  name: '干涉敌方真实伤害值',
  description: '0.1×当前敌方英雄最大生命值输入；独立真实伤害结果已组成，2.5秒延迟、范围、重复衰减和目标输入供值仍未接线。',
  expression: {
    nodeType: 'OPERATION',
    operation: 'MULTIPLY',
    operands: [
      { nodeType: 'PARAMETER', parameterKey: 'enemy_true_damage_ratio' },
      { nodeType: 'PARAMETER', parameterKey: 'actual_target_max_health' }
    ]
  },
  sortOrder: 10
};
redemption.deleteParameterKey = 'actual_target_max_health';
redemption.remaining = '区域命中生产、2.5秒延迟、90秒主动冷却、死亡期间使用、友方治疗及8秒内重复衰减仍待来源或系统接线；目标最大生命已改为当前公式模型直接读取。';

export const batchConfig = {
  ...structuredClone(original),
  schemaVersion: 2,
  scope: '救赎实际命中、水银弯刀移速与中娅沙漏伤害免疫三个主动装备分支修订一',
  targets,
  writeBoundary: '唯一写入窗口仅更新救赎一条公式、删除其失去引用的一项运行时参数、创建两个activate过程、三条冻结规则并更新两项说明；不改其他参数、效果、关系、图片或技能。',
  runtimeBoundary: '救赎目标最大生命改用既有TARGET hp TOTAL公式节点；本批仍只证明管理配置可表达且实库已保存，宿主事件生产、过程冷却执行、Wasm组装和真实战斗均未验证。'
};
