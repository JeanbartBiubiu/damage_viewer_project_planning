先核对工作树与方案哈希，再只读该节契约和指定源码，不写任何文件。工作树与 HEAD 已对齐。接下来只读方案末节并核对指定源码。末节已定位。接着核对该节哈希，并定点读结果校验、循环保护与前端表单相关源码。**VERDICT: READY**

**REVIEWED_PLAN_REV:** `attack-reset-v1-61b9aba029e8f0fc21815d39381ca9c5a5e2e98c76145349a73498683e529f62`

已核对工作树 `C:\project\damage_viewer_project_planning` / `master`，后端 `0062ddaa`，前端 `f904e5dc`。所给哈希等于该说明全文 SHA256，不是末节单独摘要；评审范围仍只覆盖末节「普攻计时重置增量」。无阻塞点。

抽象管理契约可以按现有结果数组落地：`ATTACK_TIMER_RESET`、空明细 `{}`、`valueRule=null`、`spellShieldBlockScope=null`、标准 `SOURCE`/`TARGET`、仅离散时点、不扩 Wasm/宿主、不新建表或约束。当前 `skill_effects.results` 只有数组形状检查，新种类可直接写入 JSONB。未核完的具体技能只挡住业务首录，不挡住类型与校验实现。

---

## 有证据的结论

共享字段与拒绝规则足够实施。后端 `SkillEffectService` 已能承接这组约束：明细为 `null` 会 `REQUIRED`；额外字段走 `foreignFields`/`unknownFields` 的 `FIELD_MUTEX`/`UNKNOWN_FIELD`；`forbidValueRule` 拒绝非空数值；`spellShieldBlockScope` 非空时只有既有白名单可通过，新种类默认拒绝；`PERSISTENT` 只允许护盾/修正/保护等白名单，新种类会 `COMBINATION_INVALID`；无数值时禁止读取方式，非持续时禁止层数/重施值；周期次数仍只在 `PERIODIC` 按现有规则填写。结果种类仍不可原地更换。

空明细应仿法术护盾，而不是直接治疗或攻击联动。`DIRECT_HEAL` 与 `HIT_LINK_APPLICATION`/`ATTACK_LINK_APPLICATION` 都是空明细但 **必填** `valueRule`；联动还在护盾阻挡白名单里，并会产出 `HIT_LINK_APPLIED`/`ATTACK_LINK_APPLIED`。本节要求无数值、无阻挡粒度、不产攻击/命中/伤害/联动事件。

无生命周期时，`SkillTriggerCycleValidator` 仍按结果键产出 `RESULT_AVAILABLE`，与种类无关；`RESULT_AVAILABLE` 本身没有事件数值。有父生命周期时既有规则禁止用 `RESULT_AVAILABLE` 引用该效果，离散时点循环走既有 `LIFECYCLE_MOMENT`。前序输出与额外倍率也已由现约推出空集：`SkillTriggerPriorResultOutputs` / 前端 `listAvailablePriorResultOutputs` 只在 `hasValueRule` 时给 `CONFIGURED_VALUE`，`BLOCKABLE_*` 不含新种类；`canModifyResultValue` 在 `valueRule===null` 时返回「没有可修正的数值」。不必新增输出种类或事件。

引用提取对未知 `resultType` 会抛「未知效果结果类型」。空明细无字典/子项边，应与 `SPELL_SHIELD`/`HIT_LINK_APPLICATION` 一样加空分支。`SkillObjectReferencesTest` 要求夹具覆盖全部枚举；历史迁移测试会遍历枚举并跳过后加的聚合类型，新种类需像 `SHIELD_RECEIVED_MODIFIER` 一样跳过，且不改 breaking SQL。

前端 `assertResult` 在专项分支之后默认 `assertValueRule`；联合类型、标签表、结果表单的 `never` 分支都会强制补上 `ATTACK_TIMER_RESET`。`listAllowedLifecycleMoments` 默认不把未列入持续白名单的种类标成可 `PERSISTENT`。切换种类已清空护盾粒度与无关明细。

验收清单与代码边界对齐：即时/离散往返、多余明细与非空数值/持续/护盾粒度/非法行为字段拒绝、来源目标映射、`RESULT_AVAILABLE` 自循环与已引用保护、页面切换清理/错误恢复/保存重开/独立回读。管理验收不能写成攻击计时已跑通。

## 业务录入门槛

本节已写明来源未证前不录入。诺提勒斯 W、瑟提 Q、贾克斯 W 只有 16.17 固定标签、未证明时点，不能写近似规则。泰隆官方 13.24「远程施放也重置、与近战一致」可作补证，不能代替 16.17 当前根核完；核完前业务行保持零写。抽象类型与校验可以先做。首次真页首录仍须至少一个来源充分的同类返回。

## 非阻塞建议

实现时走法术护盾的 `forbidValueRule` 加未知/互斥字段捕获，不要复用直接治疗的必填数值空明细，也不要把该种类并入护盾阻挡、联动事件或持续修正白名单。`skillEffectClient.assertResult` 必须在默认 `assertValueRule` 之前对无数值种类早退，否则合法回读会被前端协议拒绝。保存路径还要给 `SkillObjectReferences` 加空分支，并更新全枚举引用夹具与历史迁移跳过。前序绑定补一条 `OUTPUT_KIND_NOT_AVAILABLE` 即可，不必改 `SkillTriggerPriorResultOutputs`。有父生命周期的离散循环继续用既有生命周期事件，不要发明新事件。
