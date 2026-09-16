# 三项装备主动分支过程与触发补录

先在当前进程设置任意非空 `DAMAGE_ENTRY_TOKEN`，依次执行：

```text
node 批次执行.mjs freeze
node 批次执行.mjs prepare
node 批次执行.mjs review
node 批次执行.mjs write
node 批次执行.mjs readback
node 批次执行.mjs targets
```

`write` 还要求 `DAMAGE_APPROVED_BATCH_SHA` 与独立评审文件中的批准散列完全一致。完成真实浏览器只读验收并保存页面证据后，执行 `node 批次执行.mjs manifest`。令牌和批准环境变量都不写入证据或日志；生成文件拒绝覆盖。
