# 波比 W 主动移速效果补录

本目录只补录 `poppy_w/active_move_speed` 效果定义：波比主动使用坚定风采后，自身获得 40% 移动速度，持续 2000 毫秒。

本批不新增触发规则，不表达反突进领域、缚地、减速、伤害、被动双抗或低生命翻倍。管理数据保存、页面可见、Wasm 组装、宿主事件和真实战斗分别记账。

执行顺序：

1. 临时生成非空 `DAMAGE_ENTRY_TOKEN`，运行 `node 批次执行.mjs prepare`。
2. 主负责人复核 `02-冻结请求.json`、来源散列和 `05-只读准备报告.json`。
3. 将冻结批次散列放入 `DAMAGE_APPROVED_BATCH_SHA256`，显式设置 `DAMAGE_ALLOW_WRITE=YES`，只运行一次 `node 批次执行.mjs write`。
4. 由新的 Luna Max 或独立检查器运行 `node 独立GET回读.mjs`。
5. 前后端服务可用时运行 `node 只读页面验收.mjs`。

脚本不会输出或保存令牌。写入响应不确定时先读取稳定键 `poppy_w/active_move_speed`，禁止盲目重放。
