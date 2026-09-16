# 修订一

本修订承接父目录首次写入零落地的只读回查。救赎不再要求技能命中事件提供目标最大生命，而是改用现有公式模型已经验证的目标 `hp` 总值；更新公式后删除唯一引用已解除的 `actual_target_max_health` 参数，再创建实际命中规则。水银弯刀和中娅沙漏的冻结过程、规则与说明保持不变。

按 `freeze`、`prepare`、`review`、`write`、`readback`、`targets`、真实浏览器验收、`manifest` 顺序执行。`write` 必须提供与独立评审相同的 `DAMAGE_APPROVED_BATCH_SHA`；所有接口阶段仍只使用进程内任意非空临时令牌。
