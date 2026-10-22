# TinyGo Engine V2

有限目标标记的消费操作`consume_target_mark`只允许在实际角色父来源的单操作命中监听内使用。它重新核对原生接触与当前目标字段，在既有提交帧内清标、独立判盾、结算附伤和可选非生命资源恢复；失败不发布半组事实。新增消费统计只在启用本功能的会话输出。字段、准入、期限、死亡和提交约束以[有限目标标记消费共享契约](../../outputs/skill-adaptation-20261022-ezreal/有限目标标记消费共享契约.md)为唯一来源。

本来源有限目标整数计数可在自身监听条件中读取活动余时；`state_duration_change / ensure_remaining`（确保最低余时）只延长仍活动的自身目标计数，不改值或复活计数，且拒绝修改真实周期锚字段。金额由宿主静态核定为正安全整数常量；旧减时策略不变。详细授权、失效与回滚边界见[目标标记余时契约](../../outputs/skill-adaptation-20261022-lux/通用目标标记余时与拉克丝适配契约.md)，固定回归为`web/tests/mechanisms/cases/target_state_remaining_*.json`。

TinyGo编译的浏览器内计算引擎。正式业务入口为 `engine_compile`、`engine_run`、`engine_release_session`；浏览器工作线程是正式宿主，Node脚本用于本地验证。当前约束与完成门槛见[模块规则](AGENTS.md)，结构与调用关系见[架构图](ARCHITECTURE.md)。

## 阅读入口

| 内容 | 入口 |
| --- | --- |
| 当前场景范围与未完成项 | [单攻击方六阶段方案](../../文档记录/详细设计/项目/单攻击方计算六阶段推进方案.md) |
| 自动调度与共同冷却 | [共享设计](../../文档记录/详细设计/项目/主动技能自动调度与连招约束详细设计.md) |
| 共同公式与执行计划 | [公式定义](../../文档记录/详细设计/项目/共同公式定义与校验详细设计.md)、[纯公式与执行计划](../../文档记录/详细设计/项目/纯公式编译求值与执行计划拆分详细设计.md) |
| 作者绑定与属性派生 | [暴击与攻速设计](../../文档记录/详细设计/项目/暴击与攻速作者绑定和属性派生详细设计.md)、[分类与成本用途](../../文档记录/详细设计/项目/技能分类与施法成本用途绑定详细设计.md) |
| 验证范围与真实场景 | 从[规划入口](../../README.md)进入验收摘要；原生测试、正式Wasm与浏览器结论分别说明 |
| 当前性能结论 | [单次专项收尾](../../outputs/wasm-performance-plan-2026-10-14/单次性能专项收尾验收-2026-10-15.md)，后续目标见[网格优化](后续网格优化.md) |

初始和最大内存维持256MiB，正式构建参数以脚本为准。历史性能数字、逐轮优化和旧产物身份不在本页累积；需要还原时查看对应验收及Git历史。

真实逐笔伤害冻结`event.damage.killed`（本笔击杀，0或1），只供实际`damage_instance/damage_taken`监听条件读取；帧聚合伤害、未结算事件、金额表达式和伪造发送均不授权。后台普攻的自然自身回复只接实际挂载、真实事件和有限静态非负金额，沿该真实监听能力的参数求值；存活接收者、子帧原子性及完整恢复归属另行核对。非生命资源恢复事实沿原有延迟证据提交，不补造原使用。共享边界见[科加斯当前方案](../../outputs/skill-adaptation-20261021-chogath/科加斯数值适配方案.md)，固定数值用例为`web/tests/mechanisms/cases/kill_restore_*.json`。

自身计数可在严格声明的 `onExpire`（状态到期操作）中恢复本来源完整关联普通盾。开场初始化、真实状态写入与回调分别核对拥有者、字段、期限和世代；同刻战斗先执行。已有有效待执行回调的字段仅在精确期限保留等待值，直至回调原子清理，避免仅盾伤误重启；实际生命损失读取 `event.damage.actualHpLoss`，合法0不等于缺少事实。带静态属性的关联盾在施加、重施与耗尽时使用同一暂存事务，防御仍沿原子帧入口快照。

受伤监听条件可读取本笔指定自身关联普通盾的实际吸收额。编译时核对完整盾定义、同来源唯一父挂载和创建闭包；运行时保留耗尽前的逐盾事实，缺事实报错，明确没有该盾吸收才返回0。只在含该读取的会话采集，并把伤害身份与逐盾行加入真实受伤证据；无读取的调用入口避开新增闭包捕获。有读取会话拒绝当前不能派发受伤事件的复制附伤操作。没有到期状态的纯初始化普通关联盾另走完整自身静态金额窄门，不扩大通用命中监听。唯一共享边界与固定场景见[首次自身损盾契约](../../outputs/skill-adaptation-20261021-malphite/P首次损盾实施契约.md)及`web/tests/mechanisms/cases/defense_linked_shield_*.json`。

真实命中的有限双端纯属性组可声明 `APPLICATION_SNAPSHOT`（施加时快照），先读取完整双方属性，再一同安装目标乘数与来源固定增量；按实例保留严格完整的 `modifierSnapshots`。重施会读取仍有效的旧状态，后续属性变化不追随旧快照。管理依赖、准入与数值边界见[墨菲特数值适配契约](../../outputs/skill-adaptation-20261021-malphite/墨菲特数值适配契约.md)；该通用能力不自动开放整英雄。

有限目标计数窗口可在真实挂窗、普攻或指定兄弟命中后累计，并在满层或自然终点结算。实际已排队的有效终点先于同刻过程计时，旧世代清理与结算原子提交，不清理回调新建的窗口。后台普攻只接纳完整永久角色或构筑伴随来源的唯一目标锚定周期，装备原固定周期限制保留。管理与宿主共享边界见[现行契约](../../outputs/skill-adaptation-20261021-next/有限目标计数窗口契约.md)，数值与拒绝回归见`web/tests/mechanisms/cases/target_counter_*.json`及原生`generic_anchored_tick_boundary_test.go`、`generic_target_window_admission_test.go`。

永久生命驱动的平加只接受真实来源初始化到自身，作者公式和缓存均读取该拥有者当前生命及上限；不占用派生输出额度。普攻减少主动剩余冷却绑定同实际来源的真实首次能力。`provider_duration_change`（效果实例续时操作）仅接受同挂载、同技能、有限单层纯自身非生命属性组，`ensure_remaining`策略把到期时刻取原期限与当前时刻加保留金额的较大值，经过原队列预检和事务提交，不重建或复活实例。管理语义见[后端说明](../../server/data_manage/README.md#至少保留效果剩余时长)，固定数值回归见仓库根目录`web/tests/mechanisms/`。

上述续时会话在未启用资源上限和冷却时长倍率时，可以把纯生命周期关联盾与有限属性一同投影；保持原施加顺序、新盾成对替换、耗尽及双向移除、旧到期失效和队列预算回滚。带属性、状态、监听、周期等行为的复杂盾及原资源／冷却复杂混批仍拒绝，不扩大通用恢复协议。

普通数值盾可通过 `shieldLifecycleProviderDefinitionRef` 绑定显式声明 `linkedShieldDefinitionRef` 的动态供值器；实际盾保留独立盾身份及关联供值器身份。同来源、承受者和盾定义重施会建立全新一对实例，耗尽、到期和显式移除会双向结束。未绑定盾仍追加。恢复要求完整、唯一且同期限的配对。原技能可在合法供值器上下文读取 `provider.linked_shield[静态盾定义].present`；未施加的已声明定义返回0，缺定义或上下文报错。

属性比例的剩余量连乘使用 `valuePolicy=complement_multiply` 与 `stage=total`，不依赖属性名称。所有既有加算、乘算等修正先保持原序完成，再计算 `1-(1-原修正结果)×各项(1-比例)`；原修正结果及每项比例必须有限且在[0,1]。例如0.4与0.1合成为0.46，再加一项0.1为0.514。未使用该策略的属性继续按既有顺序计算。

有限、单层、覆盖刷新且明确 `source_target` 实例范围的动态属性修正，以及显式声明当前时点求值的普通减速，可读取 `provider.elapsed_ms`。真正依赖该值或明确声明该减速模式的实例快照保存可空 `appliedAtMs`（0合法），新施加及覆盖刷新重置时间；恢复拒绝缺失、负值和未来时间。不开放普通伤害、初始挂载或持续时间自身。时间依赖使对应属性计划保守不复用缓存，不使其他计划失效，不新增中间计时事件。专项原生回归入口：`go test -count=1 ./internal/compile ./internal/runtime -run 'Test(Compile.*Shield|LinkedShield|CompileProviderElapsed|ProviderElapsed|CompileMomentSlow|MomentSlow)'`；最终Wasm与宿主验证仍单独执行。

同刻的其他到期事件可能先触发属性重算。此时只排除已经达到真实到期时间、且应用时间完整有效的实例时间修正；原清理事件继续负责实例移除、证据及预算。缺失、未来或非法应用时间仍报错，不借过期判断补0或隐藏错误。回归另覆盖0和非0时刻施加、双方同时到期的先后顺序及重施旧到期事件。

普攻等待的生命周期预检独立保存操作投影标记，不能把私有预检中的移除标成父帧已经执行。资源上限与普通控制同场时，真实到期队列仍在精确期限移除实例并保留到期事实；重施后的旧期限、汇总模式和零明细预算不改变这一结果。定向回归：`go test -count=1 ./internal/runtime -run 'Test(BasicAttackWaitPreviewKeepsParentLifecycleMutations|ResourceMaxMomentQueued)'`。

根命中内的有序结果候选各自提交后，在实际声明伤害事件且该候选产生正伤害时，派发一笔 `event/damage_dealt`（已造成伤害事件）。候选保留原施放和使用身份，普通攻击仍只有一次父命中；资格仅由本次根 `resolve_skill_hit`（命中结算）建立，不由旧事件或法术护盾缓存恢复，不降低真实调用深度，也不扩到监听、复制、周期或强化待击尾部。未声明规则组的候选保留原提交和同步派生顺序。

可选 `ruleGroups`（命中规则组）将同一真实技能命中规则的连续候选绑定到已有同次使用额度；省略或空列表沿原逐候选路径。宿主从完整作者规则核定全部动作，原生只验证所给成员存在、稳定顺序、连续且不交叉，以及共同参与条件、事件条件和真实供值来源一致，不能重建未提供的作者动作。组仅支持实际 `SKILL_HIT`（技能命中）、原始静态父挂载和真实使用；不支持首次接触比较、普攻或强化普攻负载，操作沿已有额度直接执行门禁。规则共同谓词独立冻结，护盾消费保留候选不能充当规则匹配；匹配后即使全部写入被阻挡，成功提交仍占额，显式要求未阻挡而失败的规则不占额。

同组候选在一个暂存帧中按原顺序执行，逐候选隔离 `operation.output`，各自保留伤害事件口径；全部操作及原队列预检通过后与额度一起提交，再派发暂存事件。提交前失败释放预留，保留此前已提交的其它组和父命中；提交后派生失败保留已提交额度。组与监听器共用同一拥有者、真实挂载、共享键、范围及真实使用账，编译统一拒绝同键范围冲突，恢复仍核真实挂载、来源、技能和旧预算。组完成后再进入普通命中监听分发，二者没有新增作者全序。原生入口：`go test -count=1 ./internal/compile ./internal/runtime -run 'Test(CompileSkillHitRuleGroup|SkillHitRuleGroup|CompileOncePerUse|ExecutionBudgetUseLedger)'`；正式Wasm、分配及浏览器由最终集成另行验证。

弹药在原有整匣回充 `all_at_once/when_empty` 之外，支持逐枚回充 `one_by_one/after_consume`，可绑定真实主动 `INITIAL` 首次控制。库存大于零时可以继续施放，继续扣弹不会重置正在运行的充能。逐枚模式欠弹时须在 `ammoRecovery.initialRemainingMs` 明确提供首枚余时（数字或同技能严格静态引用，0有效）；满弹及整匣模式禁止提供。余时为非负安全整数，不超过初始化时完整间隔；不从库存或技能学习时库存推测。

等待按拥有者、实际供值器引用和状态字段分别保存，目标方未被驱动的主动来源不启动回充。`state_duration_change/subtract` 可在同供值器的逐枚弹药上缩短下一枚等待；超出部分钳到当前时刻且丢弃，仍由独立到期事件补一枚，不改变单发冷却。无等待时不求减时金额。旧事件、重复事件、移除实例和队列预算失败均不能多补弹或留下部分写入；同供值器的普通整数状态继续使用既有过程时点操作，不扩大 `use.ammo.before` 的读取范围。仅支持时间零的新运行，不恢复运行中充能。

原生定向入口：`go test -count=1 ./internal/runtime -run 'ActiveAmmo|AmmoAttack|AmmoCompilation|AmmoRecovery|AmmoCapture|AutomaticSkill'`。这些检查只证明通用原生机制；正式 Wasm、浏览器宿主和真实作者来源的验证由集成时另行完成，不能据此开放英雄目录。

`ATTRIBUTE_CHANGE/PERSISTENT/TARGET`（目标有期属性变化）可以映射为一次严格纯属性实例施加：有限正期限、单层、覆盖刷新、明确来源与目标范围、无能力、监听、状态、过程、周期、护盾和状态贡献，仅自身非生命属性的有限静态平加或[0,1]整体乘数。全部定义编译后再次检查真实完整定义，防止后置能力或监听绕过；执行候选前核对实际命中目标的全部对应属性槽，缺失报错且该候选不挂实例，明确的0值合法。实例、到期、属性失效及伤害继续使用原运行路径；即时属性及来源方持久属性范围不扩大。局部回归：`go test -count=1 ./internal/compile ./internal/runtime -run 'Test(CompileSkillHitFinite|SkillHitFiniteTarget|RootSkillHitCandidate|SkillHitOldContext)'`；正式产物与旧请求对照见 `target/corki-semantics-2026-10-18/slot-fix/`，真实作者和浏览器验证另行记录。

## 普攻主体替换

显式 `attackDamageRole=PRIMARY` 标记真实普攻主体；`REPLACE_PRIMARY` 标记自身首次启动的单步骤强化待击负载。主体自身及整个父命中的法术护盾范围必须为 `null`，替换负载可独立声明阻挡资格。两类角色都是单个无条件即时目标伤害，替换负载不得带第二个结果、重复或周期；其它父候选保留原位置。多份替换定义可以同时挂载，真正同刻有多个有效待击才按通用一致性错误拒绝。没有有效替换时保留原伤害；零伤害和合法阻挡也消费一次并抑制原主体。

替换伤害、待击完成、盾消费及可靠累计同帧暂存，预算或错误不提交组内写入；此前候选已经提交的结果保留。`ProcessEmpoweredAttack.replacedPrimary` 保存真实普攻完整静态身份，激活使用与实际攻击仍分别保留。`basicAttack.primaryReplacements` 按编译绑定和目标累计次数、阻挡与三种伤害口径，独立于明细数量和输出模式；没有实际替换则省略新输出。仅替换负载继承本次根候选的正伤害事件资格，事件按真实普攻分类、按实际替换作者与激活使用归属；时点操作、盾监听及旧附加不继承。

定向验证为 `go test -count=1 ./internal/runtime -run TestPrimaryReplacement`，覆盖顺序、旧附加、盾与错误回滚、精确期限、来源变化、同刻冲突、两种挂载身份、记录模式、致死、会话重复及普通入口绕过。该测试是通用原生机制证据，真实三牌作者与浏览器工作线程另外验收。过程快照恢复仍明确拒绝强化待击，超时仍按现行 `EVENT_ABORTED` 失败，不改变公开恢复及冷却时点语义。

## 剖析与分配复现入口

强化待击的共同参数可声明 `runtimeSource.kind=process_start_state` 和 `stateKey`。宿主先核对作者的技能范围整数计数和真实 START 唯一 SET；Native 按现行降阶后的自身 INTEGER、非弹药/冷却、同过程无条件唯一 SET 及实际待击负载核对。协议未编码作者的 COUNTER 枚举，不声称 Native 能另行区分它。START 成功后从暂存状态捕获每次使用的只读 float64 切片；后续写同名状态不会改旧快照，累计值不转32位整数，命中读取其它属性仍按实际帧。

有限目标属性支持静态 `multiply + stage=total`，范围[0,1]；整体比例在固定/百分比和派生输入之后、剩余比例规则之前结算，不靠乘区名称排序。新有期整体修正的到期状态参与缓存命中检查，精确到期后不复用旧值。

有限 `resource_max`（资源上限修正）授权单层、覆盖、自身 hp 的静态非负加算，策略必须为 `grant_positive_delta_clamp`。锚点为场景已含等级与静态装备的 hp.max；连续供值器变更段按最终净差结算，首次数值读取、伤害、治疗或提交前使结果可见。上限增加仅给存活且正生命对象相同净增量，上限下降只夹取；同值刷新不回血。一个供值器刷新没有可见移除中态，多个可见段仍在同帧预检/回滚内。提交直接发布已经校验的纯供值器最终列表和属性，逐项保留真实生命周期证据和到期队列，不再重放移除中态的数值重算。同帧混有尚未接入暂存投影的非纯供值器生命周期操作时，在提交前明确拒绝并回滚；该首版边界不改变旧无授权路径，也不禁止分开的独立事务。新初态拒绝已有本类实例，不增加战斗存档恢复协议。

永久生命初始化使用 `preserve_initial_current`（保留场景显式当前值），只接受实际已挂载自然角色的唯一来源初始化监听、自身静态非负生命平加、无期限单层效果。该角色父来源可保留同技能完整主动过程，永久效果不得被能力、过程时点或其它监听引用。原生先独立验证自然基础生命与所选装备静态生命，再核对真实永久贡献和输入上限，原子安装效果实例及贡献；当前生命保留且不加满、不夹取。原来源初始化只跳过已消费的精确操作，其它合法初始化照常执行。初始化证据 `resource_max_initialized` 保存容量锚点、永久贡献、上限、当前值和完整原挂载、监听、操作与新效果归属；永久贡献不计战斗增量记录和汇总。后续有限容量从真实永久实例重建，不能重复增加或丢失这部分容量。只接全新0毫秒状态，同会话重复运行各自初始化；既有实例和非零快照续跑仍拒绝。生命最大值减基础值沿现有 `MAX−BASE` 表达，不改变总值或额外值映射。

资源上限会话通过冷初始化后，存活属性重建的普通与派生成功出口均保持 `hp.Resolved=hp.Current`（生命解析值等于当前生命）；状态施加、刷新、移除、到期及当前时点减速的安静终点观察也遵守同一不变量。它不改当前值、上限、天然基础、战斗增量或输入准入前的上限校验；无资源上限授权的旧会话保持原语义。回归入口：`go test -count=1 ./internal/runtime -run 'Test(ResourceMaxMoment|PermanentResourceMax|MomentSlow)'`。

只有编译会话包含 `resource_max` 时，结果返回 `resourceChangeRecords`、`resourceChangeSummary` 和对应 recording 四字段，伤害/直接治疗记录共用 `healthOrder`；无授权旧场景全部省略。资源变化独立于治疗/吸血，累计不受明细预算影响。预算 `maxResourceChangeRecords` 缺省1000、范围0—10000；仅汇总返回空数组和 returned=0，预算内虚拟保留不算 dropped，truncated 只表示预算溢出，沿既有记录口径。完整明细可按 healthOrder 合并核对当前值与上限两条守恒；失败帧不发布事实，顺序允许空号。

`cooldown_duration` 只接有限自身正倍率和明确 `affectedAbilityRefs`（空数组是无匹配），引用编译为实际 INITIAL 拥有者、挂载及能力编号。倍率只在新的过程冷却提交时乘原公式结果，再统一取整；旧 readyAt 不追溯修改，有效期严格为施加时刻至到期时刻之前。

本轮定向检查：`go test -count=1 ./internal/model ./internal/formula ./internal/compile ./internal/pipeline ./internal/runtime -run 'ProcessStartState|ResourceMax|CooldownDuration|DynamicModifier|TotalAttribute|AttributeTotal'`。原生通用能力通过不等于真实英雄开放；正式 Wasm、工作线程、真实作者和目录证明由集成验收另行给出。单次1ms专项继续暂停，不改变256MiB内存、出口回收或计算精度。

在本模块目录运行；将`input-1.json`换成`input-0.json`即为无装备场景。正式采样报告的往返包含宿主和GC，不能当纯计算。

```powershell
node --cpu-prof --cpu-prof-interval=100 --cpu-prof-dir=target --cpu-prof-name=gear.cpuprofile scripts/profile-run-node.mjs --wasm dist/tinygo_engine_v2.wasm --input ../../web/output/kill-latency-2026-10-11/input-1.json --mode summary --warmup 10 --iterations 200 --output target/gear-run.json
node scripts/profile-run-node.mjs --profile target/gear.cpuprofile --output target/gear-cpu.json
node scripts/allocation-run-node.mjs --wasm target/perf-next-2026-10-14/closeout-metadata/allocation.wasm --input ../../web/output/kill-latency-2026-10-11/input-1.json --mode summary --warmup 5 --iterations 20 --output target/gear-allocation.json
```

CPU报告仅筛选实际栈中含`runLoop`的样本，按叶函数汇总自身耗时。本机正式优化基线71050样本命中0，没有保留可命中的`runLoop`，明确无法归因；不能改用`RunGeneric`或全部Wasm样本冒充循环样本。本轮采用依据是浏览器阶段计时与真实Wasm分配对照。

分配入口需要独立诊断产物的`engine_memory_read`与`engine_profile_memory`；正式产物没有诊断导出。沿用`target/perf-next-2026-10-14/`本地诊断工具，`prepare-stage.mjs`冻结源、`configure-closeout.mjs`接入当前输出编码锚点、`build-closeout.mjs`按正式参数构建正式／时标／分配三份Wasm，使用独立`closeout-...`阶段名，拒绝覆盖既有档案。分配副本在`RunGeneric`前后及宿主指定窗口读取TinyGo内存统计，`ReadMemStats`会扫描元数据，不作计时或单独证明存活内存。当前基线、账本及缓存档案为`closeout-base/`、`closeout-ledger-final/`、`closeout-metadata/`；新检出若没有本地档案，先恢复诊断工具及冻结输入，不能将缺失导出当零分配。完整证据与提交边界见[专项收尾验收](../../outputs/wasm-performance-plan-2026-10-14/单次性能专项收尾验收-2026-10-15.md)。

## 模块职责

```text
cmd/engine_wasm/          TinyGo 导出：alloc/dealloc + engine_compile/run/release_session + outbox_*
cmd/bench/                原生 Go benchmark（generic|generic-run；不支持/未知参数非零退出）
internal/abi/             frame header、outbox、内存桥接
internal/model/           generic*.go 为 canonical DTO；types.go 仅保留仍被引用的共享基础类型
internal/compile/         CompileGeneric → CompiledSession
internal/runtime/         Session registry + RunGeneric / generic execution
internal/scheduler/       generic 稳定事件堆
internal/formula/         generic formula compile/eval
internal/typeset/         flat type catalog/matcher
internal/pipeline/        数值变更统一 resolver
internal/{attribute,resource,command,status,shield,...}/  支撑子系统
internal/testkit/         fixture、ABI helper（含 generic_p0_*）
scripts/                  构建、generic ABI smoke、Node benchmark
targets/wasm-256m.json    256 MiB TinyGo wasm target
```

## 核心数据流

```text
宿主 alloc → 写入 compile frame (kind=200, CompileRequest JSON)
  → engine_compile → CompileGeneric → register session
  → outbox: compile_result{ok, sessionId, schemaHash, rulesHash} | error

宿主写入 run frame (kind=201, RunRequest: sessionId + expectedRulesHash + snapshot/driver/stop/sampling)
  → engine_run → hash/session 校验 → RunGeneric
  → outbox: generic done{summary, finalSnapshot, series, evidence...} | error

宿主写入 release frame (kind=202, sessionId + expectedRulesHash?)
  → engine_release_session → 删除 registry 项
  → outbox: release_result{ok, sessionId, released:true} | error

宿主 engine_outbox_ptr/len → 读帧 → engine_outbox_clear
```

## 常用命令

运行时单测使用固定构造输入，验证通用机制的数值、事件顺序、时序和错误边界；不校验已录入角色配置，也不冻结英雄资料的字节数、摘要或描述措辞。部分历史用例仍沿用英雄名称，但只保留独立构造样例的机制检查。新增或修改机制时补充对应计算用例，复用已有机制的角色适配不新增逐角色回归。构造样例通过只证明原生通用机制，真实配置首次验收与浏览器工作线程验证分别留证。

在 `wasm/tinygo_engine_v2/` 目录执行：

```powershell
go test -count=1 ./...
go run ./cmd/bench
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
node .\scripts\smoke-node.mjs
node .\scripts\bench-node.mjs --mode generic-run --iterations 10 --warmup 2
```

TinyGo 不在 `PATH` 时：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1 -TinyGo "<tinygo.exe 路径>"
```

### TinyGo 工具链定位

`Get-Command tinygo` 或 `where.exe tinygo` 未命中只表示当前终端的 `PATH` 没有 TinyGo，不代表机器上未安装。构建脚本未命中 `PATH` 时，依次查找仓库根目录下被忽略的 `.tools/` 和仓库根目录的上一级目录：

```text
.tools/tinygo0.40.1/tinygo/bin/tinygo(.exe)        ../tinygo0.40.1/tinygo/bin/tinygo(.exe)
.tools/binaryen-version_129/bin/wasm-opt(.exe)     ../binaryen-version_129/bin/wasm-opt(.exe)
```

工具放在其它位置时显式指定：PowerShell 用 `-TinyGo`，bash 用 `TINYGO=<路径>`，`wasm-opt` 用环境变量 `WASMOPT`。正式构建固定使用Go 1.25.2、TinyGo 0.40.1与Wasm优化工具Binaryen 129，两份构建脚本实际检查版本，不再回退到124。版本不符直接退出，避免不同工具链生成的字节混入正式身份。

前端目录运行`npm run check:wasm-build`会将当前源码和目标配置按正式参数重建到被忽略的`web/output/`，再与分发Wasm逐字节比较；成功后删除本次临时产物，失败保留排查。该入口不修改分发文件、身份常量或正式证明，完整证明刷新和持续集成均强制使用它。

Node 宿主必须加载与编译器同版本的 `wasm_exec.js`；仓库脚本同样会查找上述工具目录，也可用 `TINYGO_WASM_EXEC` 显式指定。

## 构建

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1   # Windows
bash scripts/build-wasm.sh                                         # macOS / Linux
```

等价于：

```powershell
tinygo build -scheduler=none -no-debug -opt=2 -target .\targets\wasm-256m.json -o .\dist\tinygo_engine_v2.wasm .\cmd\engine_wasm
```

## ABI 摘要（canonical）

```text
alloc(size) -> ptr
dealloc(ptr, size)
engine_compile(ptr, size) -> 0/-1
engine_run(ptr, size) -> 0/-1
engine_release_session(ptr, size) -> 0/-1
engine_outbox_ptr() -> ptr
engine_outbox_len() -> len
engine_outbox_clear()
```

## 约束

- `targets/wasm-256m.json` 固定 256 MiB initial/max memory。
- 构建默认 `-scheduler=none -no-debug -opt=2`。
- 网络、缓存、版本协商、文件加载留在 JS/Worker；TinyGo 只接收准备好的 frame payload。
- 勿修改或复制原固定样例；当前smoke与基准显式选择独立作者输入，旧档案用 `--legacy-fixture` 复核。通用加载器不补公式或缺失属性值。

## Generic runtime 精度契约（事件快照 / 抗性 / expected crit）

内部通用公式允许 `op:"if"`（按条件取值）的固定三个 `args`：条件非零求第二项，否则求第三项。编译会完整校验两支的引用、读取路径、循环和深度，并生成只向前跳转的指令；运行只读取选中的分支，未选中的金额公式不会触发缺值或除零错误。宿主可先判身份与自伤，再在合格分支读取生命比例，按同乘区的各条件结果求和。此运算不增加管理作者公式节点。

### Event snapshot formula reads

Listener / child ability 公式可读：

- `event.entry_source|entry_target.attr.<key>[.base|.current|.max|.resolved]`
- `event.entry_source|entry_target.resource.<key>[.current|.max]`
- `event.source|target.attr.<key>[.base|.current|.max|.resolved]`
- `event.source|target.resource.<key>[.current|.max]`

语义：`entry_*` 为父 execution frame 创建时（cost/CD/ops 前）深拷贝；`event.source/target` 为 `emit_event` 当点 staged 深拷贝。参与者始终是原始 emittedEvent source/target，不随 owner-relative listener 重映射。无 event context（driver cast / provider tick）读取 `event.*` 返回结构化 formula error。

Resource 路径（含 `source/target/event`）支持 `.current`/`.max`；无 suffix 默认 current。

### Damage resistance

Pipeline：`raw → (optional expected crit) → target resistance（含 source penetration）→ shields → HP clipping`。

- `physical` / `damage/physical` → `armor.resolved`
- `magic` / `damage/magic` / `magical` / `damage/magical` → `magic_resist.resolved`
- `true` / `damage/true` → 跳过抗性与穿透

Source-side 穿透（读 source `*.resolved`，first finite wins）：

- physical percent：`armor_pen_percent` → `armor_pen_pct` → `physical_pen_percent` → `physical_pen_pct`
- physical flat：`armor_pen_flat` → `physical_pen` → `physical_pen_flat` → `lethality`
- magic percent：`magic_pen_percent` → `magic_pen_pct`
- magic flat：`magic_pen_flat` → `magic_pen`

顺序与钳制：percent clamp 到 `[0,1]`，忽略负 flat；先 percent 后 flat。正基础抗性穿透后 floor 到 `0`；非正基础抗性不应用穿透，沿用既有负抗性公式。`MitigateRawDamage` / `ResolveCommand` 仍为无 source 兼容包装；generic 真实伤害与 phantom replay 走 source-aware 路径（phantom 使用冻结的 event-entry source attrs + entry target 抗性）。旧 `single_attacker_dps` 抗性路径已随 legacy lane 删除。

公式：`R>=0: amount*100/(100+R)`；`R<0: amount*(2-100/(100-R))`（R 为穿透后有效抗性）。未知 damage type 在 compile collect-all 拒绝。`Result.Amount` / summary `damageDealt` 使用 mitigated（抗性后、护盾前）；HP clipping 不反向改 summary。成功 settlement 的 damage evidence 额外暴露 `resistanceBeforePenetration` / `penetrationPercent` / `penetrationFlat` / `effectiveResistance` / `resistanceFactor`（true/zero 为稳定 0 / factor 1）；fail-closed 与 phantom 省略。

### Expected crit（`critEligible`）

仅当 damage operation 显式 `critEligible=true` 时，在抗性前做固定确定性 `expected` 结算（无 RNG、无 run-input 策略）：

```text
chanceEffective = clamp(source.attr.crit_chance.resolved, 0, 1)
multiplier      = max(source.attr.crit_damage.resolved, 1)
critAdjustedRaw = baseRaw*(1-chanceEffective) + baseRaw*chanceEffective*multiplier
```

缺省 / 非 finite 的 `crit_chance` / `crit_damage` 结构化失败，不静默造值。非 eligible damage 跳过整段。Canonical Infinity Edge：chance `0.25`、multiplier `2.3`、标量 `1.325`。

Evidence kind 仍为 `damage`：eligible 行含 `policy=expected`、chance*/multiplier、base/parts/`critAdjustedRawAmount`；`rawAmount` = post-crit raw。Phantom replay 冻结真实命中的 post-crit raw 与 crit 证据，不二次结算、不额外 emit、不增加 crit 专用 command budget。复制逐笔重走伤害修正与抗性、护盾、扣血数值段，条件和金额读取当笔真实双方及当前生命；抗性与穿透仍用原事件入场快照。原笔和复制共享 `first_per_cast` 的已消费记录，复制证据的 `modifiers` 只记录本笔重新执行的伤害修正；原笔暴击乘区的数值结果由冻结的暴击字段承接，不伪作复制当笔修正。复制证据还保存修正前、防御后金额。

### Provider tick / TickSpec（含 target-state-anchored）

Tick ability 的 `TickSpec`：

- `intervalMs` / `onTick` / 可选 `startDelayMs`（非锚定且省略时默认 = `intervalMs`）。
- 可选成对 `anchorScope` + `anchorStateKey`：同省略 = 既有 mount/run provider tick；同存在 = target-state-anchored（当前仅 `state_scope/provider_target`）；半对 collect-all 拒绝。
- 锚定配对校验在 start-delay 默认化**之前**；锚定要求 `startDelayMs` 省略或 0（不默认成 interval）。
- 锚定不在 mount/seed 启动；首次合格 `provider_target` 写入启动；触顶钳制 refresh 重启 cadence。
- 调度类别 `GenericCategoryAnchoredTick` 在 expire cleanup 之前；活跃绑定使用 `bag.targetKey`。
- inclusive-at-expiry：仅在公式/pipeline 求值窗口内保持可见；不改全局 expiry 语义。

### Cast origin / cast instance / per-cast throttle

ABI（向后兼容，字段均可省略）：

- Ability `castOrigin`：可选枚举 `champion|item|pet|innate`（非空非法值 collect-all 拒绝）。
- Listener `perCastThrottleMs`：可选非负整数；省略/`0` 保持旧行为。`>0` 时要求 `eventMatcher.all` 含 `event/damage_instance`（需要 cast-instance 事件上下文）。
- Operation `repeatDelayMs`：可选非负整数毫秒；仅 `operation=repeat` 允许非零。省略/`0` 保持即时 phantom replay；`>0` 时在原事件时刻冻结合格 provenance，并入队 `GenericCategoryTriggeredContinuation` 事件于 `nowMs+repeatDelayMs`（独立 `MaxCommandsPerEvent` 计数，不继承原 hit collector 余额）。

运行时：

- 每次成功顶层 cast（driver / TickSpec / Listener `AbilityRef` 完整 child ability）mint 单调 `uint64` cast instance ID（从 1 起）；同 cast 多 op / listener Operations 子伤害继承 ID+origin。
- Event TypeSet 附加恰好一个已知 `cast_origin/<origin>`；damage evidence / emitted event data 暴露 `castInstanceId`（float64）与 `castOrigin`（非公式输入）。
- Pipeline damage context 可读：`damage.cast_origin.<key>`、`damage.ability_type.<key>`（catalog 校验；未知 compile 拒绝；运行时不匹配返回 0）。casting ability TypeSet 在 pipeline 前可用。
- 延迟 repeat：listener flush 先完成全部 delay=0 即时回放；再评估正延迟触发并 enqueue。continuation handler 消费 run-local payload、按冻结 raw/crit/entry 抗性施加 phantom，不重收集、不二次 repeat。超出 duration 或原 hit 已 death-stop 时不执行；堆 push 失败为 run error。若本次输出仍有待执行复制，`warnings` 以 `pending_continuations_not_in_snapshot` 明示待执行份数；`finalSnapshot` 不含延迟队列，从它恢复不会补放这些复制。该警告只披露既有恢复缺口，不提供恢复能力。

Per-cast throttle 安全边界：

- 表键：`listenerIndex + ownerCombatantKey + ownerProviderRef + castInstanceId → lastTriggerMs`；缺表项或 `now-last >= PerCastThrottleMs` 允许触发；重叠 cast 独立。
- 容量 `min(4096, max(256, MaxEvents))`。溢出按最小 `castInstanceId` 驱逐（并列 listenerIndex → combatantKey → providerRef）；每次 run 至多一条 `per_cast_throttle_overflow` 警告。表在 run 结束丢弃。

### 通用吸血与治疗修正

方案唯一来源为规划工作树的《管理页面与共性机制迭代计划》第3项。本模块负责通用编译与结算，不承担任意管理技能的完整装配。

- `rules.vampRules`（游戏吸血规则）每种类型至多一条，类型顺序为生命偷取、全能吸血、物理吸血、法术吸血。比例读取规则指定的来源属性，不由伤害操作重复保存。
- `targetMatcher`、`abilityMatcher`、`damageMatcher`（目标、能力、伤害匹配器）分别只引用 `combatant`、`ability`、`damage_trait` 类型域，三者同时成立。必须有正向约束；类型来自 `Types`，不使用 `Tags`。
- 有规则时，伤害必须声明 `vampQualification=RESOLVED`（已核定）；`UNRESOLVED`（未核定）拒绝编译。伤害产生方式与来源性质各声明一个类型，所属能力和两侧对象也必须明确分类。未使用吸血的原通用请求保持原样。
- `vampOverrides`（技能例外）支持 `DISABLED`（禁止，不带数值）或 `OVERRIDE`（覆盖，必须有明确基数及通用效率公式）；例外要求对应游戏规则。覆盖可以越过默认能力、伤害资格，但不能越过目标范围和死亡、自身伤害保护。
- 吸血比例与效率在每次扣血后读取；严格读取保留有效属性的真实零值，缺少属性或参数、负效率和非有限结果报具体路径。复制伤害保留原能力分类和例外，比例仍读取本次有效值。
- 每次伤害的贡献求和后治疗一次。现有 `kind=pipeline, command=heal` 修正新增 `healDirection=DONE/RECEIVED`（造成/受到）、`healCategory=ANY/VAMP/DIRECT`（全部/吸血/直接治疗）及 `healGroupKey`（乘区标识），数值策略为 `add_percent`（有符号比例）。同区比例加总后乘 `max(0,1+净比例)`，各区按既有修正排序的首次出现顺序相乘；先造成再受到，最后裁剪生命上限。伤害修正已有的 `channel/stage/bucket` 不用于治疗。
- 普通与复制伤害的末尾共同结算吸血，不监听伤害事件补治疗。来源死亡、自身伤害和目标受击前已死均不吸血；击杀仍能吸血。治疗与单独斩杀不产生吸血。

`done.evidence.items` 中的 `vamp`（吸血明细）通过 `damageId` 关联 `damage`（伤害明细）。逐次保存防御后伤害、护盾吸收、实际扣血、过量伤害，各种吸血的基数/比例/效率/贡献，以及 `healingBeforeModifiers`（修正前）、`healingAfterDone`（造成修正后）、`healingAfterModifiers`（全部修正后）、`actualHealing`（实际回复）、`overheal`（过量回复）。已核定但禁止或不匹配的伤害仍保存明确零值及跳过原因。

专项验证使用独立构造的 `internal/testkit/fixtures/generic_vamp_damage.json`，不修改或复制原基准样例。最终构建后运行：

```powershell
go test -count=1 ./internal/compile ./internal/runtime -run '^TestVamp'
node .\scripts\vamp-smoke-node.mjs
```

该样例明确提供两侧英雄、100原始伤害、100护甲、20护盾及20剩余生命等运行输入。原生与Node结果证明通用机制；实库来源、管理适配及浏览器Worker验证由相应模块独立提供证据。

### 跨来源状态合并与重伤取强

方案唯一来源为规划工作树的《管理页面与共性机制迭代计划》第7项。本模块负责通用编译与结算，不实现移速软上限、几何、控制抗性或按英雄名分支。

- `ProviderLifecycle.instanceScope=source_target` 仅在显式 `maxStacks=1`、`refreshPolicy=replace` 且有正期限时进入按 `definitionRef+source+owner` 复用实例；未指定范围仍每次新建。
- `statusContributions` 在 apply/refresh 当时用真实来源/目标、能力参数求值并保存快照；强度有限且在 `[0,1]`，JSON 0 与缺失分开；失败不挂实例。
- `statusContributions[].valueReadMode`（数值读取方式）省略或为 `APPLICATION_SNAPSHOT` 时保留上述快照；显式 `MOMENT_EVALUATION` 才按当前时点重算。空值、空串、错误类型和未知枚举拒绝。新模式仅接受有限单层、`source_target/replace` 的纯 `status` 供值器，只有一个普通减速贡献，没有属性修正、能力、过程、监听、内部状态或周期跳动；常量公式也经过相同真实实例门禁。命名和条件全部分支的依赖只允许自身经过时间及冻结静态值，不向公式提供属性、事件、使用或能力实时上下文。
- 当前时点模式在真实施加/刷新时以经过时间0求值，最终观察以实例真实 `appliedAtMs` 和有效期限求值；静默终点也重算。输出的供值器贡献及 `effectiveStatuses` 消费同一次当前值，运行中的施加快照不改写。求值错误、非有限和越界值通过正式运行错误返回；作者显式 `clamp`（夹取）运算仍按公式本义执行。没有落地事件、额外命中或逐时跳动。
- 最终 `effectiveStatuses` 只读输出普通减速有效 max 及全部有效贡献；弱实例保留并独立到期。到期守卫使用实例 `ExpireAt>nowMs`，不使用 `expectedExpireAt`。
- `healGroupCalculationMode=ratio_max` 对同组 received+`add_percent` 取最小带符号比例，组间仍按 `max(0,1+ratio)` 连乘；非法值报错不夹取。同组模式冲突 collect-all 列出双方路径。

专项验证使用独立构造的 `internal/testkit/fixtures/generic_status_merge_slow.json` 与 `generic_heal_ratio_max.json`，不修改或复制原基准样例。最终构建后运行：

```powershell
go test -count=1 ./internal/compile ./internal/runtime -run 'Status|HealRatioMax|Slow'
node .\scripts\status-merge-smoke-node.mjs
```

原生与 Node 结果证明通用机制；浏览器 Worker 真实验证由主负责人独立提供，不能拿 Node 代替。

### 命中供值与法术护盾

方案唯一来源为规划工作树的《管理页面与共性机制迭代计划》第5项 `authoring-p5-r2`。本模块负责通用编译与结算，不实现完整过程、弹道、tick，也不按英雄或装备名分支。

- `resolve_skill_hit` 只能作为一次 active 命中能力的唯一操作；运行时要求单次 driver 事实，禁止 Repeat/WhileReady。
- `skillUses` / `skillHitFacts` 在 run 入口做严格校验：完整历史、同刻堆序（时间→类别→priority→entries 下标），缺值、重复事实和非法来源报明确路径。
- 每次实际 resolve 铸造独立发生身份；首次接触与阻挡在当时冻结。四档范围为 `SKILL` / `EFFECT` / `RESULT` / `DAMAGE_INSTANCE`；null 永不连带，首个非 null 单元不能被后项放大。
- 首次接触核对全部已确认合格历史，包含场外单位，不按当前目标重算。只有 null 候选的后续命中不会复用技能级阻挡标记；只有被挡的实际护盾实例接收其所属格挡监听。命中数值读取缺失会明确失败，不补零。
- 本期候选没有经过验证的状态移除、伤害/治疗修正、伤害免疫和生命下限操作映射，编译会拒绝这些候选；不能用这些名称包住普通伤害来绕过阻挡资格。护盾成功后的显式生命周期移除仍由对应实例事件监听执行。
- `provider/spell_shield` 是类型身份；普通数值护盾操作不参与。控制按封闭 `provider/status_*` 身份，第7项普通减速复用既有贡献。
- 候选在父成本/CD commit 后分发，逐候选 commit 再派派生事件，最后才发 `event/spell_shield_blocked`。`emit_event` 不能伪造引擎事件。
- `providerRefFromEvent` 仅所属 listener、`eventMatcher.all` 含 `event/spell_shield_blocked`、target=self；锁冻结 owner/ref/definition，缺失或不符硬错误。自疗 self 是监听 owner。动态实例必须实际 bind/unbind，不能只靠静态挂载。

专项验证使用独立构造的 `internal/testkit/fixtures/generic_skill_hit.json`，不修改或复制原基准样例。最终构建后运行：

```powershell
go test -count=1 ./internal/compile ./internal/runtime ./internal/formula ./internal/model -run 'SkillHit'
node .\scripts\skill-hit-smoke-node.mjs
```

原生与 Node 结果证明通用机制；Web 复制最终 dist 与浏览器 Worker 验证由父任务或后续 Web 负责。

### 同次使用限制、固定时间窗与前序伤害供值

方案唯一来源为规划工作树的《管理页面与共性机制迭代计划》第6项 `authoring-p6-r3`。本模块不实现 DELAY/EMPOWERED 过程执行器，也不按英雄或装备名分支。

- 分发任何监听动作前，先按 `nowMs` 惰性到期相关状态，再用 owner-relative 上下文和原事件快照冻结全部匹配规则的 `listener.condition`。
- `oncePerUse` 只接受 `skill_hit` / `basic_attack_hit` / `basic_attack_start` 三种真实 use 事件；组键含 owner、provider、group、useSource、useKey 及可选 target，全组共享，不含 listenerIndex。
- `Snapshot.useTriggerLedger` 是专用额度账本，与第5项 SKILL 账本和 `MaxEvents` 分开；空起始快照不继承上次 run。
- `start_on_first_write` 只在默认值变为非默认且无活动期限时开窗，后续写含封顶不续期；快照逐键保存 `expireAt`。
- `operation.outputRef` 只导出同帧真实 `pipeline.DamageOutcome` 的 `POST_DEFENSE_DAMAGE` / `SHIELD_ABSORBED` / `ACTUAL_HP_LOSS`。
- 普通攻击 `resolve_skill_hit` 只发 `event/basic_attack_hit`；空 operations 的 `attackStartFacts` 开始 driver 只发 `event/basic_attack_start`。`emit_event` 不能伪造这两种原生事件。

入口中的 `source`、`target` 是实际快照角色标识，只有 `self`、`opponent` 按来源解释；操作中的目标仍按当前执行帧解释。反向施法的资源门禁、命中和原生攻击开始与使用记录保持同一实际来源。恢复状态先检查原始对象和数值，不能丢弃非法字段后当默认值；额度账本核对来源、目标并按完整身份稳定排序。动态供值器不支持同次使用限制，不能静默忽略。内联被动能力的操作与直接监听操作遵守相同的冻结条件限制，施放门禁及其他非操作位置不能借用尚未生成的伤害输出。

专项验证使用独立构造的 `internal/testkit/fixtures/generic_p6.json`，不修改或复制原基准样例。最终构建后运行：

```powershell
go test -count=1 ./internal/compile ./internal/runtime ./internal/formula ./internal/model -run 'P6|OncePerUse|BasicAttack|OutputRef|StartOnFirstWrite'
node .\scripts\p6-smoke-node.mjs
```

原生与 Node 结果证明通用机制；浏览器 Worker 真实验证由父任务结合最终产物提供，不能拿 Node 代替。

### 有期限的普通护盾

方案唯一来源为规划工作树的《管理页面与共性机制迭代计划》第6项必要增量 `authoring-p6-shield-r2`。该项只补通用 `shield` 操作的可选期限，不实现普通护盾重施、衰减或伤害类型筛选；后续4B增加的普通护盾接收链见[阶段4契约](../../文档记录/详细设计/项目/阶段4装备接入与机制验收详细设计.md)。

- `operation.shieldDurationMs` 仅 `shield` 允许；其它操作携带时编译拒绝。省略字段仍表示无期限（`expireAt=0`）。
- 编译对可折叠常量拒绝非有限、非整数、非正数及 `>=2^63` 的值。运行在施加帧严格读取，转换为 `int64` 前做相同校验，再拒绝 `nowMs+duration` 溢出或到期时刻不晚于当前时刻。缺失输入不能补零。
- 有期限实例使用原 `shieldRef` 作为定义前缀，分配确定且不与恢复实例、本 run 已用编号冲突的运行引用。仅成功提交的新有期限实例入队到期清理。
- 清理按完整引用匹配，且只移除已经到期的实例；旧事件不能删刷新后或新实例。快照保存/恢复 `expireAt`。到期采用左闭右开：到期同刻不能再吸收，施加同帧仍可吸收。

专项验证覆盖期限内吸收、到期同刻、同帧吸收、引用冲突、恢复清理、非法期限与失败帧。2026-09-23最终产物895683字节，SHA256为`620763fce922e91e3a33f6b8a1597ff528ffcf7a53200cabecf50f548ee3415b`；真实浏览器Worker第6项13项通过，另第5项10项、第7项8项及通用吸血8项通过。第6项包含原库星蚀护盾公式与期限，不代表原装备全部触发资格已核定。分层证据由唯一计划及其《命中与触发运行》验收记录维护。

### 主动过程与阶段时点

方案唯一来源为规划工作树《管理页面与共性机制迭代计划》第4项 `casting-runtime-r2`。过程定义位于 `ProviderDefinition.processes`，能力继续使用 `kind=active`，由 `processControl.action` 声明首次施放、重施、蓄力释放、取消或中断。过程控制只接受单次驱动与明确 `processCommandFacts`，绑定已有真实 `skillUses`。

普通攻击计时重置沿用 `cooldown_change / set_remaining`：仅过程开始时、同一实际拥有者、目标为自身、完整真实普攻首次控制引用、金额可静态折叠为0时，允许该项跨过程重置。原过程自身冷却及其它跨引用限制保留；不直接生成攻击，也不越过行动占用、弹药与版本校验。`go test -count=1 ./internal/runtime -run '^TestBasicAttackReset'` 覆盖两套异名身份、真实等待、同帧先后、失败原子性及负例；该原语不代表强化待击消费或整套英雄Q已经接入。正式构建及逐字节回归、分配对照记录在本模块 `target/priority-adaptation-2026-10-18/`，摘要收录于规划工作树同日期验收记录。

- 首期支持顺序 `IMMEDIATE`（即时）、`DELAY`（延时），末尾一个 `CHARGE`（蓄力）或 `RECAST`（单次重施）。步骤时长在进入时严格求值并冻结，不接旧分步引擎，也不按英雄名判断。
- 所有成本逐笔求值并检查有限非负，同资源聚合后统一检查、原子扣款。实例 `actualCosts` 记录扣前扣后差额；完成或失败时点可读取 `process.actual_cost.<资源键>`，属性后来变化不重算历史账。
- 时点先启动至多一次普通冷却，再按原数组顺序执行匹配操作。`set_remaining`（设置剩余冷却）只接受有限非负整数毫秒及安全时间相加，在过程内锁定首次能力的真实完整引用；0 表示立即可用。
- 到期先于同刻推进；多个过程同刻计时按拥有者、挂载、过程、使用身份稳定排序，恢复沿用相同顺序。即时/延时步骤自动推进，重施到期只走超时和完成；蓄力最大值是否执行步骤由明确布尔决定。统一终结防止旧事件、重复取消或阶段推进重复结算。
- 伤害提交后、死亡停机前，先冻结该次死亡涉及的活动过程集合，稳定执行 `SOURCE_DIED`（来源死亡）失败时点。其它中断依赖明确控制能力与事实。阶段伤害和治疗累计到首次能力统计；首次事件仅成功开始时产生，同真实使用的后续第5项命中保留命中身份而不再产生首次事件。
- `Snapshot.processInstances` 保存活动及终结实例；两者均计入独立预算，默认10000、上限100000。恢复验证归属、成本键、步骤版本、冻结时间及终结标记。到期等于快照时间会补本刻计时，过去活动期限或含过程运行中的过去驱动明确失败；历史使用可不重复输入，出现时必须匹配。新对象拒绝未知字段和缺失必需字段。

专项输入全部为明确合成机制样例，不代表任意管理过程或整英雄已装配。原生与真实 Node Wasm 验证入口：

```powershell
go test -count=1 ./internal/compile ./internal/runtime ./internal/model ./internal/formula ./internal/scheduler -run 'Process|P6|SkillHit|Cooldown'
node .\scripts\p4-runtime-smoke.mjs
```

真实浏览器 Worker 与原管理对象返回验证由宿主集成任务独立记录；Node 与原生测试不替代浏览器证据。

### 开技能后强化下一次普通攻击

新增单步 `EMPOWERED_BASIC_ATTACK`（强化下一次普通攻击）执行：明确正整数 `windowMs`（等待窗口毫秒）、`consumeMoment=ATTACK_HIT`（实际命中时消费）和 `occupiesAction=false`（不占行动）。只接受该单步骤；手动首次可在普通冷却与费用成立时刷新，自动首次仍等活动过程结束。本轮不接受任何强化过程快照恢复，包括活动和已结束历史；原恢复输入不足以核实历史命中身份，正常导出不变。

`generic_empowered_attack.go` 维护仅含活动等待的列表。真实普攻命中入口冻结已有窗口，完成原普攻主体、原候选及其尾事件后，才将仍有效的全部强化负载作为同一暂存组预检和提交。失败保留此前已经成立的普攻，但不发布部分强化效果、消费、过程进度或后项资格。新窗口不能反向附着当前这一刀；到期同刻先过期。合法刷新建立新使用，旧使用失败终结；旧计时器不结束新实例。

负载保留激活技能自己的身份与分类，通过可选 `empoweredAttack`（触发普攻关联）记录真实普攻 `useRef`、`hitRef` 与实际目标；不新增一次对外普通攻击或技能命中。作者步骤执行效果由同一有序负载完整装配，该时点的额外时点操作和依赖独立技能命中的被动组合明确拒绝，避免重排或伪命中。其它步骤、无等待的原普攻路径及原结果字节形状保持原规则。

自动后项若实际消费强化因果链中的资格，完整过程另以可选 `empoweredPredecessorUseRef`（直接资格前项使用）保留每次真实前项；只有成功开始才提交，不依赖可截断日志或最后一次汇总。普通旧资格链省略该字段，任何携该新事实的快照恢复均拒绝。宿主可据完整链核对同刻发生的“普攻先命中，后项才开始占用”，不能仅因毫秒相同忽略行动占用。

该机制不等于任意英雄完整技能可用。当前共享语义以规划工作树 `outputs/priority-adaptation-2026-10-18/强化下一次普攻运行现行契约.md` 为准；两套异名用例位于 `internal/runtime/generic_empowered_attack_test.go`，正式产物与浏览器证据另行验收。

### 有限多次普攻强化窗口

同一等待步骤可选 `maximumAttackCount`（最多消费次数公式），静态整数范围1至64；声明后必须明确 `consumeMoment=ATTACK_START`（实际发动消费），冷却若存在只从 `PROCESS_COMPLETE`（窗口过程完成）开始。缺省仍按上一节单次命中消费，旧超时失败不变。新窗口活动时不接受刷新或同时叠加含糊窗口，负载只附加到真实普攻，不能替换主体。

每次已成立的原生普攻开始，消费与真实普攻使用身份一起提交；最后消费、过程完成和冷却同帧原子提交，到期同刻先结束窗口。消费序号独立于原步骤版本、执行序号和命中序号，原定时器始终有效。可选过程事实 `empoweredAttackWindow`（强化窗口事实）完整保存最多次数、消费数、未结算数及每次真实使用、发动时间、命中身份、命中序号、结算时间，最多64笔且不受展示预算截断。未命中不退次数；到期不把飞行中的普攻猜成未命中。窗口已完成或已到期后，原使用仍可结算已预留的负载，不能借给新窗口。

新模式的 `stepExecutionIndex` 保持0、`lastExecutionAtMs` 保持空值，分笔时刻读取窗口事实。每次实际命中仍通过 `empoweredAttack` 关联伤害和技能使用明细；最终过程只保存完整窗口事实。普通完成资格在窗口结束时产生，`PROCESS_RESOLVED`（过程已结算）只在全部真实预留结算后发布一次，不扩大旧命中因果链的行动占用豁免。当前公开普通攻击驱动仍同步发动与命中，不新增飞行调度或1毫秒延迟；分离后的真实原生发动和命中接点覆盖延迟、未命中及跨窗口身份反例。实施契约为根目录 `outputs/skill-adaptation-20261021-chogath/E与R通用机制实施契约.md`。

### 场景参数与有限引导

具名技能公式的 `RUNTIME_INPUT` 参数可显式声明 `runtimeSource.kind=ability_parameter`（实际能力参数来源），沿原 `parameterKey` 读取同技能实际能力的 `params`。禁止声明 `resourceKey` 或默认 `value`；缺值、非有限数、整数声明的小数或超安全整数均在真正读取时拒绝，合法0及未选择分支保持原语义。无来源运行输入不借用同名能力参数，条件、静态位置和外技能供值器继续拒绝此来源。宿主负责采集已经验证的场景属性，不由原生猜测名称或补值。

场景显式初值仍保留作者的 `valueMode=RUNTIME_INPUT`，由宿主提供 `runtimeSource: {kind: "scene_parameter", value: <明确有限数>}`。该来源只含 `kind/value`，不接受缺值、null、其它类型或 `resourceKey`；其它来源禁止携带 `value`，参数顶层仍禁止运行输入默认值。原生在编译时独立检查有限数，`INTEGER` 另需安全整数，0及负数合法；业务上下界由声明与宿主核验。编译时深拷贝来源和数值，静态折叠、元数据及实际读取使用同一冻结值，不依赖能力上下文、不增加状态或事件；原技能归属检查和其它来源限制保持原规则。专项原生入口为 `go test -count=1 ./internal/model ./internal/formula ./internal/compile ./internal/runtime -run SceneParameter`，正式Wasm与宿主验证由集成任务执行。

自动技能额外接受单步骤有限 `CHANNEL`（引导），仍要求显式行动占用、正冷却及有限次数。时间和次数沿真实首次能力在进入时求值、冻结；每段均产生真实命中，末段提前结束也保持完整引导期限，完成后才按作者时点开始冷却及授予后项资格。恢复使用已有冻结进度，不重新读取次数或首末偏移。其它多步骤和手动重施、蓄力的自动准入保持关闭。共享语义以规划工作树 `outputs/priority-adaptation-2026-10-18/有限引导与场景属性快照现行契约.md` 为准；原生专项入口为 `go test -count=1 ./internal/model ./internal/inputbinding ./internal/formula ./internal/compile ./internal/runtime -run 'AbilityParameter|AutomaticFiniteChannel|SafeInteger'`，正式产物及浏览器证据由宿主集成另行验收。

主动技能在首次普攻之前修改共同冷却时，已有等待版本变化也会进入通用唤醒准备和提交；没有攻速、弹药或行动占用路径负责时，更新唯一排程节点并保留序号，缺节点先检查队列预算。不会直接制造攻击或绕过存活检查。原生回归可运行 `go test -count=1 ./internal/runtime -run 'BasicAttack.*Reset|FirstBasicAttack'`；正式产物、旧版异名复现及整英雄验证见规划工作树 `outputs/priority-adaptation-2026-10-18/首次普攻等待唤醒修补.md`。
