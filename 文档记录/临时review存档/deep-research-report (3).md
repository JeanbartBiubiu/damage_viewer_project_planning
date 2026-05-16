TASK_KEY: planning-validation-milestones
DOC_TYPE: 其他
WORKSTREAM: planning
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-05-16 15:41:39

# 单攻击方 DPS V2 方案评审

## 总体结论

**结论：Conditional Go。**

这个方向**可以做**，而且与项目现有路线并不冲突：现有项目已经把 M1-M4 收口为“逐字段证据链”，明确反对在当前阶段直接做完整 1v1、敌方动作调度、AI 或完整模拟页面；同时，TinyGo V2 也已经具备单次运行、状态、tick、trigger、history、counter、mode augment 等结构化输出能力，说明工程底座不是空白。当前 M4 四个批次的机制验证记录也都给出了“通过”的 checkpoint 结论。问题不在“能不能做”，而在于 **V2 方案一旦进入“平A 持续时间线 + 被动 + 装备联动 + 曲线输出”这个组合区间，正好踩在项目当前最薄的边界带上：自动攻击节奏、时间窗定义、被动挂载入口、曲线协议归属**。这些地方如果文档写得不够硬，很容易从“单攻击方 DPS 工具”滑向“完整战斗模拟器”。（《验证里程碑》L10-L12, L24-L30, L41-L43, L445-L459；《WASM需求澄清》L23-L29, L35-L44；《M4B1 测试记录》L92-L96；《M4B2 测试记录》L100-L105；《M4B3 测试记录》L89-L94；《M4B4 测试记录》L100-L107）

我给 **Conditional Go** 而不是直接 Go，核心前提只有四个：  
其一，V2 必须继续坚持“固定攻击方 + 固定标靶 + 无敌方动作 + 无主动技能轮转 + 无自由编辑器”；  
其二，`simulationRules / curves / curveResults / scenarioStates` 必须明确谁归 wasm、谁归 web、谁只是派生结果，不能混成一个“万能协议”；  
其三，平A 时间线必须写死最小规则，尤其是**时间截止、同刻事件顺序、动态攻速重算、攻速上限 3.0 与暴击期望值**；  
其四，英雄被动、装备被动、装备 on-hit、DoT/触发链要统一到一套 effect/trigger/status 挂载模型里，而不是再开一套 V2 特有的“DPS 专用机制描述”。（《前端场景交互规划》L49-L71, L297-L365, L426-L445；《WASM详细设计》L312-L327, L328-L360, L474-L513；`internal/model/types.go` L115-L127, L308-L345, L457-L588）

## 评审依据与判断前提

以下判断主要基于项目中现有的近邻文档和当前实现，而不是重写你要评审的两份文档正文：包括《验证里程碑》《WASM需求澄清》《WASM详细设计》《前端场景交互规划》《M4 机制扩展分批 Goal 提示词》《M4 闭环验证页开发计划》，以及当前 TinyGo/Web/Backend 的实现与测试记录。它们足以判断**项目既有边界、现有契约、现阶段可承接能力、以及 V2 最容易踩到的架构坑位**。（《验证里程碑》L172-L185, L461-L470；《WASM详细设计》L47-L69, L558-L573；《前端场景交互规划》L12-L21, L47-L71；《M4 闭环验证页开发计划》L20-L30, L39-L47）

从这些材料看，**wasm / web / backend 的正确大分工其实已经很清楚**：  
Wasm 负责单次运行内的确定性结算、事件流、状态/tick/trigger/counter/history/crit 等数值执行，并保证同 bundle、同输入、同 seed 可复现；Web 负责场景模板、批量运行、枚举/扫点/二分、图表和结果解释；Backend 负责静态资源、类型网络、发布快照和引用校验，而不是运行中曲线结果存储。这个分工在未来场景模拟规划里已经写得很明确，在发布快照链里也已经落了地。V2 只要沿着这条分工做收口，方向就是对的。相反，如果把 scenario/curve 逻辑下压到 Wasm、或者把 `curveResults` 当成发布 bundle 的一部分，就会直接与现有架构冲突。 （《前端场景交互规划》L49-L71, L344-L365, L426-L435；`db/game_manage/schema.sql` L39-L54；`PostgresReadStore.java` L353-L455；`PostgresWriteStore.java` L1455-L1589）

## P0 问题

### 方案边界还不够硬，存在隐性滑向完整战斗模拟器的风险

**风险：**  
“单攻击方平A DPS + 技能被动效果 + 装备联动”这三个关键词放在一起，本质上已经不再是 M3/M4 那种单次 action 证据页，而是在接近“场景工作台”的入口。如果文档没有把**敌方不动作、主动技能不轮转、只允许固定标靶、只允许平A主循环、被动只允许由平A/装备触发、无自由编排器**写成强约束，很快就会出现这些失控路径：  
一是为了表达更真实 DPS，把主动技能轮转也塞进来；  
二是为了支持更多英雄，把“技能池增删”与“自由动作序列”拉进来；  
三是为了让曲线更丰富，把 V2 做成场景编辑器。  
项目现有里程碑文档和前端场景规划都反复强调：**当前阶段不是完整 1v1，不是自由模拟器，场景工作台是后续页面，不应回流污染当前验证链**。如果 V2 文档没有把这些非目标明确写死，后续实现会天然漂移。 （《验证里程碑》L10-L12, L24-L30, L172-L185, L445-L459；《前端场景交互规划》L14-L21, L31-L44, L187-L194）

**建议修改：**  
在《验证里程碑V2》和《V2-单攻击方DPS协议与开发计划》里都补一段**硬边界**，不要只写在背景里，建议直接写成验收门槛：

- 只允许 **self 攻击方 + fixed dummy 标靶**。  
- **enemy 不产生任何主动事件**。  
- 主循环只允许 **平A cadence**；不支持主动技能轮转，不支持通用 rotation DSL。  
- 被动/装备联动只允许由 **平A命中、on-hit、on-attack、持续效果 tick、已定义 trigger** 触发。  
- 不做自由战斗编辑器，不做本地“隐藏 debug skill”，published bundle 缺项时必须 `blocked`，不能本地私造。  

这不是“写得更谨慎”这么简单，而是为了把 V2 严格锁在**最小可验证 DPS 工具**，而不是让它脉冲式扩张成模拟器。`M4` 闭环页已经把“缺数据就 blocked，不私造 skill/action”写成了规则，V2 应直接复用这个原则。 （《M4 闭环验证页开发计划》L39-L47, L48-L60, L91-L99, L117-L122）

**涉及文档位置：**  
目标文档中的**方案目标、非目标、边界说明、blocked 规则**章节。近邻参照位置：  
《验证里程碑》L172-L185, L445-L459；《前端场景交互规划》L31-L44, L187-L194；《M4 闭环验证页开发计划》L91-L99, L117-L122。

### `simulationRules / curves / curveResults / scenarioStates` 与当前引擎契约脱节，且对象归属未锁死

**风险：**  
当前 TinyGo V2 的正式契约非常明确：`EngineBundleV2` 描述静态执行资源；`EngineRunInputV2` 描述本次 run 的 self/enemy、initialActions、stopCondition、trace、modeAugments；`DonePayloadV2` 输出 actors、actionResults、tickResults、triggerResults、rng 等结构化证据。现有正式契约里**根本没有** `simulationRules / curves / curveResults / scenarioStates` 这四个对象。也就是说，如果 V2 文档引入这四个名字，但不明确它们**是 Web 编排对象、Wasm 运行对象、还是 Backend 发布对象**，后续必然出现三种问题：

- Adapter 要不要把它们翻译成现有 `EngineRunInputV2`？  
- Wasm 是否要为它们扩 ABI / DTO？  
- Backend 是否要把它们放进 published bundle snapshot？  

这不是命名问题，而是**协议层级问题**。如果四个对象同时承担“场景模板 + batch sweep + 执行配置 + 运行结果 + UI 展示元数据”，那它们会变成一个耦合怪兽。项目现有场景规划已经把这些层次拆开成 `ScenarioTemplate / SimulationDraft / VariantSpec / ScenarioOrchestrator / ResultInterpreter`，说明正确方向是**分层**，而不是把所有语义塞进一个 DTO。 （`internal/model/types.go` L115-L127, L308-L345, L574-L588；《前端场景交互规划》L297-L365）

**建议修改：**  
我建议只做**最小分层**，不要重写全套协议，但一定要在文档里补一张“对象归属表”：

- `simulationRules`：**Web 持有的执行规则**，只描述 duration/seedMode/采样口径/目标 fixture/攻速规则 等“如何跑”。不放 UI 图表字段，不进 published bundle。  
- `scenarioStates`：**Web 持有的输入状态 patch 集**，只描述“开局状态/装备集合/等级/属性覆盖/初始 HP/资源/启用 passive/模式开关”。不要混入运行后快照。  
- `curves`：**Web 持有的 sweep 定义**，描述 x 轴维度、点集、比较指标、排序方式。不要混入执行结果。  
- `curveResults`：**派生结果对象**，只从 `DonePayloadV2` 和稳定 evidence 字段计算出来；默认不进 backend 发布快照，只在 Web/导出层消费。  

另外，必须补一张**映射表**：说明这四个对象最终如何投影到现有 `EngineBundleV2 / EngineRunInputV2 / DonePayloadV2`，否则团队会在 adapter 和 runtime 之间来回试错。 （《前端场景交互规划》L346-L365, L369-L410；《M4 闭环验证页开发计划》L76-L89；`internal/model/types.go` L457-L588）

**涉及文档位置：**  
目标文档中的**协议章节、对象定义章节、序列化/归属说明章节**。近邻参照位置：  
`internal/model/types.go` L115-L127, L308-L345, L457-L588；《前端场景交互规划》L303-L365；《M4 闭环验证页开发计划》L76-L89。

### DPS 核心规则存在硬缺口：当前正式 run 契约没有时间截止与时间采样语义

**风险：**  
DPS 是“单位时间伤害”。但当前正式 `StopConditionV2` 只有 `MaxEvents`，没有 `DurationMs/MaxTimeMs`；`TraceOptionsV2.SampleEvery` 也是**按事件数采样**，不是按时间间隔采样。`ActionRequestV2` 也只是一组显式 `initialActions`，它并不表达“在 10 秒内自动平A”。这意味着如果 V2 文档不显式补上时间边界，团队会出现几种互相不兼容的实现：

- 有人用 `maxEvents` 当“模拟 10 秒”；  
- 有人让 Web 预生成 N 次平A action；  
- 有人让 Wasm 内部自己重排 auto-repeat；  
- 有人按事件采样画曲线，有人按时间采样画曲线。  

这些口径一旦分叉，`curveResults` 就不可比较，也不可回归。当前 `M4` 闭环页其实已经在用“把 `stopCondition.maxEvents` 放大以保证事件跑完”的方式规避这个问题，但那只是闭环页的临时技巧，不足以成为 DPS 协议。 （`internal/model/types.go` L330-L345；`internal/runtime/runtime.go` L1855-L1864；《M4 闭环验证页开发计划》L52-L59）

**建议修改：**  
V2 文档里至少补这四个字段级约束：

- `durationMs` 或 `maxTimeMs`：这是 DPS 的正式分母，不允许继续只靠 `maxEvents`。  
- `warmupMs`：如果你不想引入该字段，就明确写 **固定为 0**，避免不同人是否排除起手前摇。  
- `sampleBy`：明确是 `none / by_time / by_event`，默认建议 `none`；曲线点优先理解为**多次完整 run 的 sweep**，不要先引入 run 内时间序列。  
- `autoAttackPlan` 或等价最小原语：只描述“从 t=0 开始自动平A”，**不是通用 rotation editor**。  

我的判断是：**单攻击方 DPS** 需要一个**最小的 Wasm 内部平A cadence 原语**，而不是让 Web 生成几十上百个 `initialActions`。因为只要存在动态攻速、buff 失效、被动叠层，Web 预展开 action 列表就会立刻失真。这个建议并不是在扩展到完整轮转系统，而是在给 V2 的最小目标补上唯一必需的执行原语。 （《WASM详细设计》L429-L450, L558-L573；`internal/model/types.go` L330-L345；《前端场景交互规划》L53-L71, L351-L357）

**涉及文档位置：**  
目标文档中的**simulationRules、时间线规则、停止条件、曲线定义**章节。近邻参照位置：  
`internal/model/types.go` L330-L345；`internal/runtime/runtime.go` L1855-L1864；《WASM详细设计》L429-L450。

### 事件时间线、动态攻速、攻速上限 3.0 与暴击期望值必须再写实，否则实现会分叉

**风险：**  
当前引擎在“同刻事件”上已经有确定性顺序：heap 按 `(timeMs, priority, seq)` 排序；status tick 用 priority 0，status expire 用 priority 1，intent recheck 用 2，action complete 用 5，cast intent 用 10；heap 还有专门的顺序测试。这说明**项目有能力保证同刻顺序确定**。但对 V2 来说，光有“确定性”还不够，必须补“**语义**”：

- **DoT tick 在 expireAt 当刻是否生效**？当前实现是 `tick <= expireAt`，且 tick 优先级高于 expire，所以最后一跳会先于过期执行。  
- **buff 恰好在下一次平A时刻失效**，是先掉 buff 再结算这次平A，还是相反？  
- **动态攻速** 是“每次攻击后重算下一次间隔”，还是“中途 buff 改变剩余前摇进度”？  
- **攻速上限 3.0** 之前和之后，overflow-to-AD 等规则在什么时点计算？  
- **暴击期望值** 如果用于 DPS，为状态型 proc、叠层、on-crit 触发时是否仍合法？当前 expected policy 实现会把 `CritResult=false` 但仍应用期望 scalar，这在 UI 或曲线聚合里非常容易被误读。  

尤其是最后一点，如果 passive/装备联动里有“第 N 次命中触发”“暴击触发”“on-hit 叠层”，那么把暴击直接做成 expected scalar 就不再是纯线性问题，这是我根据当前已存在的 mark/history/counter/trigger/mode 机制作出的工程推断。 （`internal/scheduler/heap.go` L24-L27, L96-L103；`internal/scheduler/heap_test.go` L1-L29；`internal/runtime/runtime.go` L420-L485, L1381-L1394, L1467-L1552；《WASM详细设计》L312-L327, L474-L513；`internal/crit/crit.go` L24-L35；`internal/runtime/runtime.go` L1185-L1218；`internal/model/types.go` L457-L588）

**建议修改：**  
把下面这几条直接写进 V2 规则，不要留给实现者脑补：

- **同刻顺序表**：建议至少写出 `status_tick -> status_expire -> intent_recheck -> action_complete -> attack_intent` 或你们想要的另一种顺序，但一定要写。  
- **动态攻速规则**：建议先采用最小规则——“每次命中/攻击完成后，用当下 resolved AS 计算下一次 attack interval；不追求中途改写已过去的部分前摇”。这是合理近似，且不会滑向完整动作模拟。  
- **攻速上限规则**：明确区分 `rawAttackSpeed / effectiveAttackSpeed / overflowAttackSpeed` 三个值；cap 3.0 只作用于 cadence，用于 overflow 的 surplus 取 `raw - cap`。  
- **暴击策略边界**：  
  - 线性纯伤害可允许 `expected`；  
  - 任何影响状态、叠层、触发链、on-crit 分支的效果，一律改用 `seeded_random` 或显式 deterministic fixture；  
  - 输出里补一个 `critPolicy` 或 `expectedCritApplied` 标记，避免 `critResult=false` 被误解成“未参与暴击处理”。  

**涉及文档位置：**  
目标文档中的**事件驱动时间线、同时间点顺序、DoT/攻速/暴击规则**章节。近邻参照位置：  
`internal/scheduler/heap.go` L96-L103；`internal/scheduler/heap_test.go` L1-L29；`internal/runtime/runtime.go` L1381-L1394, L1467-L1552；`internal/runtime/runtime.go` L1185-L1218；`internal/crit/crit.go` L24-L35。

### 英雄被动、装备被动、装备联动当前没有统一挂载入口，是会直接阻塞 V2 的

**风险：**  
V2 目标明确包含“技能被动效果 + 装备联动”，但当前 Web adapter 在收集 action skill 时，**会把 `P/PASSIVE` 直接过滤掉**；item 目前主要通过 `statModifiers` 和 `skillRefs` 进入 bundle，而 adapter 最终仍以“可施放 action”为核心去编译。也就是说，现有工程能很好处理**主动效果**，但对“常驻被动 / on-hit passive / item passive / passive trigger”并没有一个你可以直接复用的统一入口。如果 V2 文档不主动补这个定义，后续实现非常容易退化为：

- 英雄被动走一套特殊 JSON；  
- 装备被动走另一套 item 专有字段；  
- on-hit 再来一套 DPS 专用规则；  
- 最后在 runtime 里堆 if/else。  

这会直接破坏目前 TinyGo V2 强调的“通用 effect/trigger/status/attribute policy”方向。 （`web/src/engine/tinygoV2BundleAdapter.ts` L768-L781, L784-L846, L1113-L1269；`PostgresWriteStore.java` L264-L304, L309-L337；`PostgresReadStore.java` L395-L418；《WASM需求澄清》L25-L29；《WASM详细设计》L328-L360）

**建议修改：**  
V2 文档里必须补一条统一原则：

- **“可手动施放的东西”** 继续进 `ActionTemplate`；  
- **“常驻被动 / 入场即生效 passive / on-hit / on-attack / on-crit / periodic passive”** 一律编译成 **initial statuses / triggers / attribute modifiers / effect definitions**；  
- 所有 passive/equipment source 都带 `ownerType / ownerId / sourceCategory / sourceId / typeRefs`，保证可以回溯来源而不需要写 runtime 特例。  

换句话说，V2 不应该发明“`skillPassive` 特殊结构”和“`equipmentSynergy` 特殊结构”两套新世界；它应该只是把 hero/item/passive 这些不同内容源，**统一投影到已有 effect/trigger/status 模型**。 （《WASM详细设计》L47-L69, L71-L246, L328-L360；`PostgresWriteStore.java` L264-L304；`web/src/engine/tinygoV2BundleAdapter.ts` L768-L781）

**涉及文档位置：**  
目标文档中的**技能被动/effect 统一结构、装备联动结构、数据来源说明**章节。近邻参照位置：  
`web/src/engine/tinygoV2BundleAdapter.ts` L768-L781, L1113-L1269；`PostgresWriteStore.java` L264-L304；《WASM详细设计》L328-L360。

## P1 问题

### wasm / web / backend 分工总体方向是对的，但文档必须写成强约束，而不是叙述性建议

**风险：**  
当前项目文档已经把分工写得比较清楚：Web 负责场景模板、批量运行、曲线和解释；Wasm 负责固定结构的确定性 run；Backend 负责 published bundle snapshot 与引用校验。如果 V2 文档只是“默认遵循现有分工”而没有写成强约束，后续实现仍可能出现两个坏倾向：  
一是 Web 只做展示，逼 Wasm 理解 `curve` 和 `scenario`；  
二是 Backend 过早承担“ADC 装备池 / curveResults / scenarioStates”这种运行时或展示态对象。  
这两种做法都会让未来演进非常痛苦。 （《前端场景交互规划》L49-L71, L344-L365, L426-L435；`db/game_manage/schema.sql` L39-L54；`PostgresReadStore.java` L353-L455）

**建议修改：**  
把职责表写死成下面这个级别：

- **Wasm：** 只负责单 run 的 deterministic execution 与 evidence，不认“曲线名/场景名/推荐出装池”。  
- **Web：** 负责 `scenarioStates` 组装、`curves` 枚举/扫点、`curveResults` 聚合和展示。  
- **Backend：** 只负责静态内容、类型网络、版本快照与校验；除非未来要“保存预设”，否则不承诺持久化 `curveResults`。  

如果你们确实想让前端可复用 preset，可以把 preset 存在 Web 本地导出包或者后续新增一个**独立的 preset 资源**，但不要把执行结果反灌进 bundle。 （《M4 闭环验证页开发计划》L39-L47, L76-L89；`PostgresWriteStore.java` L1455-L1589）

**涉及文档位置：**  
目标文档中的**系统分工、协议归属、backend 接入说明**章节。近邻参照位置：  
《前端场景交互规划》L49-L71, L426-L435；`db/game_manage/schema.sql` L39-L54。

### Batch A-E 如果没有按“引擎语义→曲线→内容”的依赖链排，就容易顺序错误

**风险：**  
现有 M4 的批次拆分其实很有借鉴意义：先做低风险调度和 gate，再做数值承载，再做判定/随机，最后才做复杂运行时。WASM 详细设计里的开发顺序也强调 runtime/scheduler、attribute/resource/formula、trigger/pipeline、cadence、history/counter/mark、crit、augment 是有硬依赖关系的。V2 若要拆成 Batch A-E，最大的风险不是“分几批”，而是**把 curves/UI/内容池前置到了 cadence 与 passive 语义之前**。一旦这么排，前端和 backend 会先围着不稳定协议转，后面每一轮都会返工。 （《M4 机制扩展分批 Goal 提示词》L47-L109, L111-L179, L181-L248, L250-L340；《WASM详细设计》L558-L573）

**建议修改：**  
如果 A-E 目前不是这个依赖方向，建议调整为：

- **A：协议冻结**——只冻结 V2 边界、对象归属、时间口径、输出指标。  
- **B：AA cadence 最小闭环**——固定标靶、固定 duration、平A loop、同刻顺序、攻速规则。  
- **C：passive / equipment source 统一挂载**——只做平A相关的被动与装备联动。  
- **D：curves / batch / UI**——在 B/C 都稳定后，才做 sweep、图表、curveResults 导出。  
- **E：内容录入/装备池/回归**——最后才扩大 ADC 装备池与 preset 集。  

一句话：**先把“一个点”跑准，再把“一条曲线”画出来，最后才扩内容池。**

**涉及文档位置：**  
目标文档中的**Batch A-E 开发计划、依赖说明、验收节点**章节。近邻参照位置：  
《M4 机制扩展分批 Goal 提示词》L331-L340；《WASM详细设计》L558-L573。

### 标靶 actor、装备 type、ADC 装备池的治理应该借现有类型系统，不要另起炉灶

**风险：**  
Backend 当前已经有 `types`、`typeRelations`、`ownerType/ownerId`、`skillRefs`、status/profile/modifier/effect 等完整引用校验链；publish 时还会校验 attr/type/hero/skill/item/formula/status/controlProfile 等引用合法性。这说明项目已经有一套**内容治理骨架**。如果 V2 文档再发明一个“装备 type 枚举”“ADC 装备池 DSL”“标靶 actor 专用类别”，而不复用现有类型网络，数据治理会立刻分叉，之后你会同时维护 bundle 类型系统和 V2 自己的池子定义。 （`PostgresReadStore.java` L377-L455；`PostgresWriteStore.java` L1455-L1589；《WASM详细设计》L71-L246）

**建议修改：**  
建议把三类对象区分开：

- **标靶 actor**：只是 V2 preset 的固定目标模板，不是新的 runtime actor 类别。继续利用当前 self/enemy 双 actor 结构即可。  
- **装备 type**：优先复用已有 `types / typeRelations`，不要再造一套 `equipmentType` 真正参与 runtime。  
- **ADC 装备池**：如果只是 V2 的对比候选集，应视为**preset 级筛选条件**或后续内容资源，不应进入 Wasm 协议。  

如果 V2 目标只是“指定一小组 ADC 装备做曲线比较”，那份池子最多是 Web/Backend 的 preset 元数据，而不是引擎概念。 （`internal/runtime/runtime.go` L80-L88；`internal/model/types.go` L308-L316；`PostgresReadStore.java` L377-L418；《前端场景交互规划》L303-L357）

**涉及文档位置：**  
目标文档中的**标靶 actor 定义、装备 type、ADC 装备池、数据治理**章节。近邻参照位置：  
`PostgresWriteStore.java` L1455-L1589；《WASM详细设计》L71-L246。

## P2 问题

### 验收字段还需要补几项，否则曲线结果很难真正回归

**风险：**  
现有 M4 闭环页已经说明，真正稳定的证据面主要来自 `done.actionResults`、`done.tickResults`、`done.actors`、`done.rng` 以及必要时的 `triggerResults`，而不是 `ValueTraceV2`。如果 V2 文档的验收字段只写“总 DPS / 曲线图 / 最终伤害”，那它只能做演示，不能做回归。因为一旦有 diff，你根本不知道问题在攻速、暴击、被动 proc、DoT tick 还是 stop boundary。 （《M4 闭环验证页开发计划》L14-L18, L76-L89；`internal/model/types.go` L457-L588；《wasm README》L7-L12）

**建议修改：**  
至少补以下验收字段，不需要很多，但都很关键：

- `durationMs`、`finalTimeMs`、`stopReason`  
- `attackCount`、`totalDamage`、`averageDps`  
- `rawAttackSpeed`、`effectiveAttackSpeed`、`attackIntervalMs`  
- `critPolicy`、`seed`、`expectedMode` 或等价标记  
- `procSourceCategory/sourceId`，至少能区分 hero passive / item passive / trigger effect  
- `processedEvents`、`queuePeak`，用于发现 runaway / 规则异常  
- 每个 curve point 的 `bundleVersion/versionCode/caseId`，保证可追溯  

不要把这些都塞进 Wasm 顶层公共 DTO；其中一部分可以是 `curveResults` 的派生字段，但文档里必须先定义“验什么”。 （《验证里程碑》L47-L56, L67-L71；《M4 闭环验证页开发计划》L76-L89）

**涉及文档位置：**  
目标文档中的**验收口径、curveResults 字段、导出包字段**章节。近邻参照位置：  
《验证里程碑》L47-L71；《M4 闭环验证页开发计划》L76-L89。

### 文档与代码之间需要补几组专门的回归 case

**风险：**  
当前 M4 回归已经覆盖了 shield/heal/DoT/HoT/crit/RNG/control/interrupt/history/counter/mode 等单机制证明，但它们还不是“单攻击方 DPS”语义下的专门 case。V2 如果不补这些 case，最后最容易出错的地方会长期无证据：同刻 buff 失效、攻速 cap 临界值、被动+装备+DoT 的顺序、expected crit 与 stateful proc 的耦合。 （《M4B2 测试记录》L102-L105；《M4B3 测试记录》L91-L94；《M4B4 测试记录》L102-L107）

**建议修改：**  
我建议把下面几组 case 写进 V2 验收，不需要很多英雄覆盖，**每类一个 canonical case 就够**：

- **同刻 case**：攻速 buff 在下一次平A时刻恰好结束。  
- **cap case**：`2.99 / 3.0 / 3.01` 三个点，验证 effective AS、interval 与 overflow 规则。  
- **tick case**：DoT tick 恰好落在 `expireAt`。  
- **source case**：同一次平A同时触发 hero passive + item on-hit + DoT apply，验证 effect/source 顺序。  
- **crit case**：同装备同状态下，`expected` 与 `seeded_random` 的导出字段是否可区分。  
- **blocked case**：published bundle 缺少某 passive/item skill 时 preset 必须 `blocked`，不能本地私造。  

这样你们后续加 ADC 装备池时，才不会把“内容 diff”误判成“引擎 diff”。 （《M4 闭环验证页开发计划》L91-L99, L109-L122；《验证里程碑》L62-L65, L178-L185）

**涉及文档位置：**  
目标文档中的**测试 case、回归策略、blocked 规则**章节。近邻参照位置：  
《M4 闭环验证页开发计划》L91-L99, L109-L122；《验证里程碑》L178-L185。

## 建议补充的验收与非目标

### 建议补充的验收字段与测试 case

如果只允许我补最必要的内容，我会建议你们在目标文档里最少补下面两块。

**验收字段最小集：**  
`durationMs`、`stopReason`、`processedEvents`、`attackCount`、`totalDamage`、`averageDps`、`rawAttackSpeed`、`effectiveAttackSpeed`、`attackIntervalMs`、`critPolicy/seed`、`procSourceCategory/sourceId`、每个 curve point 的 `versionCode/caseId`。这些字段都能用现有稳定输出或其派生值来承载，不需要靠 `ValueTraceV2`。 （`internal/model/types.go` L457-L588；《wasm README》L7-L12；《M4 闭环验证页开发计划》L76-L89）

**测试 case 最小集：**  
同刻 buff 失效、DoT tick=expireAt、攻速 cap 临界值、hero passive + item on-hit 同击触发、expected crit 与 seeded_random 对照、缺 bundle 数据时 blocked。每类一个 canonical case 即可，不要扩大英雄覆盖。 （《验证里程碑》L178-L185, L463-L469；《M4 闭环验证页开发计划》L91-L99）

### 建议继续坚持的非目标

我强烈建议在文档里继续把以下内容写成**非目标**，避免 V2 被“顺手做大”：

- 不是完整 1v1。  
- 不做敌方动作。  
- 不做主动技能轮转。  
- 不做自由战斗编辑器。  
- 不做全英雄、全装备覆盖。  
- 不做 Monte Carlo 分布验收。  
- 不把曲线结果写回 published bundle。  
- 不用本地隐藏 action/skill 替代 bundle 缺项。  

这些限制并不会削弱 V2，反而会保护它。项目现有文档已经反复证明：**最小证据链一旦写硬，系统就能快；边界一旦写软，系统就会自然长成另一个项目。** （《验证里程碑》L445-L459；《前端场景交互规划》L175-L194, L426-L445；《M4 闭环验证页开发计划》L117-L122）

## Open questions 与局限

本次评审是基于项目中现有近邻文档与当前实现做出的架构评审；因此我能对**边界、分工、协议归属、时间线规则、批次依赖、数据治理和验收口径**给出较高置信度结论，但对你点名的两份 V2 文档中**具体字段名、具体 Batch A-E 列表、以及文中是否已经写了某些约束**，无法逐段逐句做“原文对照式”批注。基于现有证据，我的建议是：**不要重写方案，只把上述 P0 先补硬，再把 P1/P2 作为实现前的文档收口项。**