import { batchConfig as revisionOne } from '../修订一/批次配置.mjs';

export const batchConfig = {
  ...structuredClone(revisionOne),
  schemaVersion: 3,
  scope: '救赎实际命中、水银弯刀移速与中娅沙漏伤害免疫三个主动装备分支修订二',
  correction: '公式更新稳定键只用于路径与响应校验，不进入PUT请求体。'
};
