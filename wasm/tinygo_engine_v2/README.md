# TinyGo Engine V2

`wasm/tinygo_engine_v2` 是 Damage Viewer 的 TinyGo Wasm 计算引擎正式落点。

当前 canonical 路径是 generic compile / session / run / release：

```text
CompileRequest -> engine_compile -> CompiledSession (sessionId + rulesHash)
RunRequest + sessionId/expectedRulesHash -> engine_run -> DoneResult
ReleaseSessionRequest -> engine_release_session -> release_result
```

更细的模块依赖与时序见 [`ARCHITECTURE.md`](ARCHITECTURE.md)。协作规则见 [`AGENTS.md`](AGENTS.md)。

无调用残留清理后，`internal/crit` 仅保留正式暴击结算使用的概率边界和数值夹取工具。未接入的 `internal/augment` 强化开关骨架，以及旧暴击策略、倍率0补1和旧期望拆分函数已删除。正式暴击三分支仍由运行层执行，下面的当前产物与既有机制验收口径保持。

本次全量Go测试通过，重新构建的 `target/unused-residue-cleanup/tinygo_engine_v2.wasm` 与前批最终产物、Web源产物的字节完全相等：1,385,770字节，SHA256 `0967cb717dfa16c64f7b3e397400b73a7f7fdcc15a86ee59850fbaf784e297a2`。

## 当前产物与静态光环统一准入

当前正式产物 `target/category-cost-bindings/tinygo_engine_v2.wasm` 为1,385,770字节，SHA256 `0967cb717dfa16c64f7b3e397400b73a7f7fdcc15a86ee59850fbaf784e297a2`，初始与最大内存仍固定256MiB。连续普攻不再按 `opponent.attr.attack_speed` 限制同拥有方只能挂一份光环；多个独立、完整静态来源沿现有属性修正规则叠加。来源唯一性、非生命对手属性槽、显式总值乘算、有限非负常量和事件命令预算保持。

原生专项分别核对同一／不同属性、速度完全改名、两份独立效果挂载，以及同一编译会话三次完整结果相等。`.8×.5` 速度为`.4`，攻击时点为0／2500毫秒；`.8`速度与`.5`护甲光环分别作用，攻击时点为0／1250／2500毫秒。全量Go、原生基准、标准Node往返、作者绑定及伤害聚合专项、Node基准与200次会话复用通过。技能分类与施法成本用途绑定由后端和Web消费，唯一契约在规划真源《技能分类与施法成本用途绑定详细设计》。

此前30秒完整失败档案在最终Node与实际浏览器Worker分别重复200次，完整结果与原成功档案一致；浏览器只建立一条Worker并正常释放。完整输出616,617字节，保留29条攻击、103条伤害、700条证据及301个采样点，未缩减记录或采样预算。本批作者分类改名与双光环的页面装配验收由规划真源的本批测试记录独立维护。

```powershell
go test -count=1 ./...
go run ./cmd/bench
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1 -Out target/category-cost-bindings/tinygo_engine_v2.wasm
node .\scripts\smoke-node.mjs --wasm target/category-cost-bindings/tinygo_engine_v2.wasm
node .\scripts\calculation-rules-smoke-node.mjs target/category-cost-bindings/tinygo_engine_v2.wasm
node .\scripts\formula-phase5-smoke-node.mjs target/category-cost-bindings/tinygo_engine_v2.wasm
node .\scripts\session-reuse-smoke-node.mjs --wasm target/category-cost-bindings/tinygo_engine_v2.wasm --iterations 200
node .\scripts\bench-node.mjs --wasm target/category-cost-bindings/tinygo_engine_v2.wasm --mode generic-run --iterations 10 --warmup 2
```

以下暴击与攻速作者绑定、内存修复及各阶段产物数字保留对应历史验收口径，当前产物以上节为准。

## 暴击与攻速作者绑定当前产物

具名公式必填 `scope`（归属）：技能保留真实技能标识和私参；游戏公式不允许技能标识及私参。派生明确 `set/multiply`（修正前替换／修正后乘算）及目录数值类型，不按攻击力或攻速属性名称限制输出。完整游戏配置由后端快照运输、Web映射到同一共同编译器；原生不补概率属性、收益系数或攻速公式。倍率下限可明确为0或省略；暴击伤害必须成对声明概率和倍率，确定性三分支权重保持。

实际速度在首次等待及后续提交前核对正数、上界。已有计划过程时点或即时属性命中只准入真实普通属性槽、明确加算和本次行动目标；生命周期、监听器和普攻原门槛保持。暴击合成金额及属性新基础值在证据、裁剪和提交前检查有限值，失败帧不提交。

当前正式产物 `target/outbox-memory-fix/tinygo_engine_v2.wasm` 为1,386,371字节，SHA256 `4ed40c234cefce6aa54442e8520ba3add7fdd910ae6b6443167d1396ba4c5b4e`，固定256MiB。作者绑定开发收尾的前一产物是1,384,822字节、SHA256 `e5ad0845d1e3a9d95e461da3916cb78c7dbcb4df270030cf0aeb3b203174a755`。本次修复完整30秒重复输出的内存不足：JSON编码借用编码池缓冲，正文及帧头直接写入固定容量出箱，消除每次整份JSON副本与临时帧；协议字节、优先帧、丢弃计数、编码失败保留及容量错误保持。重叠正文先移动再写头，编码器终止换行不进入协议正文。

当前全量Go、ABI边界检查、标准Node往返及作者绑定12项专项通过。正式Wasm在同一Node会话200次完整结果相等，并验证变化输出、错误恢复、释放重编；回收后堆占用稳定约5.9MB。真实服务的原100次同Worker压力用例通过，冻结失败档案另经实际浏览器Worker200次完整相等并释放。TinyGo的全局保守扫描本身未改，诊断地址名单不进入产品。共享契约与完整分层证据由规划真源《暴击与攻速作者绑定和属性派生详细设计》及2026-10-11验收记录维护。

```powershell
go test -count=1 ./...
go run ./cmd/bench
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1 -Out target/outbox-memory-fix/tinygo_engine_v2.wasm
node .\scripts\calculation-rules-smoke-node.mjs target/outbox-memory-fix/tinygo_engine_v2.wasm
node .\scripts\smoke-node.mjs --wasm target/outbox-memory-fix/tinygo_engine_v2.wasm
node .\scripts\session-reuse-smoke-node.mjs --wasm target/outbox-memory-fix/tinygo_engine_v2.wasm --iterations 200
```

以下各阶段产物与数字保留历史验收口径，当前产物以上节为准。

## 伤害聚合与常驻装备通用装配

根能力与过程时点仍沿原提交位置派发 `event/damage_dealt`（伤害造成聚合事件），现在收集所有防御后金额为正的作者伤害原键。同帧只派发一次，类型分类排序去重，重复同键的实际金额与操作引用均保留。证据提供 `damageTypes`（实际类型集合）及 `damageBreakdown`（按原键贡献明细）；单类型保留 `damageType`，混合类型省略。物理限定监听由作者明确匹配通用事件、`damage/physical` 与拥有方分类，不再依赖物理专用事件分类。

累计总额及分类额在原帧提交前检查有限值；单笔有限但相加溢出返回 `runtime_invariant_failed`（运行约束失败），不提交本帧暂存写入，也不让序列化导致线程崩溃。没有声明通用事件目录时不启用聚合。零贡献、监听子帧、复制及周期不会增加本批聚合次数；逐笔伤害、受伤、吸血、冻结视图和扣盾扣血仍走原路径。

静态初始化的对手光环准入按真实非生命属性槽检查，不再固定对手攻速。明确总值阶段、乘算策略及有限非负静态值后，沿原拥有方挂载向对手投送修正；缺槽、生命上限、动态值或其他策略仍拒绝。Web的装备来源、永久结果及范围确认采用通用作者闭包装配，完整边界以规划真源《伤害聚合事件与常驻装备通用装配详细设计》为准。

本阶段历史产物 `target/formula-phase5/tinygo_engine_v2.wasm` 为1,378,093字节，SHA256 `f510e11b7c02246c0b46e6d5e8b116d055c1ee3e2f9afb60309f16efcbef4e5f`，固定256MiB。全量Go、原生基准、标准Node往返、第三A／B及第四阶段专项、Node基准和同会话200次通过。新增专项验证任意原键、混合贡献、同会话101次／释放重编，以及同键／跨键溢出拒绝后同会话恢复；它不代替真实作者数据及浏览器证据。

```powershell
go test -count=1 ./...
go run ./cmd/bench
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1 -Out target/formula-phase5/tinygo_engine_v2.wasm
node .\scripts\formula-phase5-smoke-node.mjs target/formula-phase5/tinygo_engine_v2.wasm
node .\scripts\smoke-node.mjs --wasm target/formula-phase5/tinygo_engine_v2.wasm
node .\scripts\session-reuse-smoke-node.mjs --wasm target/formula-phase5/tinygo_engine_v2.wasm --iterations 200
```

以下各阶段产物与数值保留对应历史验收口径，当前产物以上节为准。

## 共同公式默认分支清理第四阶段

当前协议要求每个实际编入计划的伤害操作原键都具有成功注册的作者共同公式。已知目录缺定义返回编译错误 `missing_damage_type_formula`（缺少伤害类型作者公式），保留原操作 `damageType` 路径与原键；未知目录仍返回 `unknown_type_key`。未使用目录及无伤害预检允许缺定义。零金额也必须声明公式，明确常量0与1都合法。

运行的数值结算入口先核对原键、绑定、程序索引和共同程序种类，再处理金额。损坏计划及绕过专用伤害入口的通用命令返回 `runtime_invariant_failed`（运行计划约束失败），不消费默认程序0、不提交本帧暂存写入。普通防御保持帧入口只读视图；复制通过完整冻结的双方属性视图求同一程序，提交仍使用当前护盾与生命。原生物理／魔法／真实白名单、默认抗性和穿透别名算法、复制固定属性覆盖及四个旧防御证据字段已经删除。治疗、护盾和斩杀继续使用通用数值管道；已求得的伤害金额统一由 `ApplyMitigatedDamage` 扣盾和生命。

标准输入由 `scripts/formula-phase4-input.mjs` 从零构造，Go显式读取独立的 `internal/testkit/fixtures/formula_phase4_explicit_basic_damage.json`。它明确100原金额及常量1防御，目标生命1000→900；文件加载器只读取，不注入公式。原 `generic_p0_basic_damage.json` SHA256保持 `cf597916d5200bc4f5c4328fd15bb2dd0eb5c8c521a77fc815a4dfd4704fda05`，当前协议明确拒绝其缺定义。第三B原产物与旧900记录冻结于 `target/formula-phase4-baseline`，以下前三阶段章节是历史范围与证据。

苍穹场景按已确认的帧入口口径运行：同帧穿透状态仍按原顺序10→22，伤害共同公式读取入口10，当前附伤为366.4819944598338；旧默认分支读取同帧暂存22，对应391.18864577173275。原生测试独立比较两份算术结果，并保留状态、费用、时点及下一帧读取22的断言；其他机制原金额和顺序断言保持。

最终产物 `target/formula-phase4/tinygo_engine_v2.wasm` 为1,375,850字节，SHA256 `9ca312c719e5a7f2f7d1294a0f1135f6ecf81cb05cd9b6c2e65d06518851cd8c`，固定256MiB。全量Go、原生基准、标准Node往返、第三A／B及第四阶段专项、Node基准及同会话200次重复通过；计划损坏、程序0保护与帧回滚由原生故障注入专项证明。Node证据不替代真实服务或浏览器工作线程验收。

```powershell
go test -count=1 ./...
go run ./cmd/bench
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1 -Out target/formula-phase4/tinygo_engine_v2.wasm
node .\scripts\smoke-node.mjs --wasm target/formula-phase4/tinygo_engine_v2.wasm
node .\scripts\formula-phase3-smoke-node.mjs target/formula-phase4/tinygo_engine_v2.wasm
node .\scripts\formula-phase3b-smoke-node.mjs target/formula-phase4/tinygo_engine_v2.wasm
node .\scripts\formula-phase4-smoke-node.mjs target/formula-phase4/tinygo_engine_v2.wasm
node .\scripts\bench-node.mjs --wasm target/formula-phase4/tinygo_engine_v2.wasm --mode generic-run --iterations 10 --warmup 2
node .\scripts\session-reuse-smoke-node.mjs --wasm target/formula-phase4/tinygo_engine_v2.wasm --iterations 200
# 旧协议档案明确选择原固定输入，仍得到900：
node .\scripts\smoke-node.mjs --legacy-fixture --wasm target/formula-phase4-baseline/tinygo_engine_v2.wasm
```

## 共同公式定义第一阶段

`internal/expression/contract.go` 提供 `ValidateDefinition` 纯校验入口，检查共同定义结构、声明授权、全部结果依赖及整份预算，返回确定性的错误码和JSON字段定位路径。常量保留十进制字符串，合法0不补值；第一阶段只验结构，不替换现行正式编译输入。该入口在第二阶段迁入独立纯表达式包，不保留旧包转发。

结构规范及共同样例由规划主分支的 `contracts/formula` 维护，模块常量由 `tools/formula-contract/generate.mjs` 明确生成并检查。定向检查为 `go test -count=1 ./internal/expression -run Contract`；设计和验收以规划工作树《共同公式定义与校验详细设计》为准。

## 纯公式、输入绑定和执行计划第二阶段

`internal/expression`（纯表达式）提供共同定义编译、惰性程序求值和数学原语，仅依赖基础库；`internal/inputbinding`（输入绑定）按原身份、对象、视图和口径绑定明确数值，不读写战斗状态。共享结果及输入每次求值各读取一次，缺值、除0、非有限与错误限制边界明确失败。现行公式执行器复用纯数学原语，原管理结构及默认类型分支尚未切换。

`internal/plan`（执行计划）拥有31个编译后结构及完整能力引用解析；compile生产计划，runtime及pipeline消费。运行态独立持有公式表，驱动条件和重复间隔仅追加到本次表，失败或重跑不修改共享会话。公式注册在生成16位编号前检查65536程序、每程序512指令、累计262144指令及32MiB逻辑计费；失败不设置可消费标记。

最终正式验证产物为 `target/formula-phase2/tinygo_engine_v2.wasm`，1,302,969字节，SHA256 `546de175f6a14d8a3e5996575334efc6718259768fc29e31f041f65587de7c3f`。独立纯核心验证产物为同目录 `formula_probe.wasm`，分别执行 `node scripts/formula-phase2-smoke-node.mjs target/formula-phase2/tinygo_engine_v2.wasm` 和 `node scripts/formula-probe-node.mjs target/formula-phase2/formula_probe.wasm`。两者固定256MiB，前者验证正式固定样例与同会话20次，后者验证新纯公式的11项、同一程序20次变化输入及20次独立重复；新协议仍未接正式战斗ABI、真实管理数据或浏览器工作线程。设计与分层证据由规划真源《纯公式编译求值与执行计划拆分详细设计》及第二阶段验收记录维护。

## 伤害类型共同公式第三阶段A

伤害类型的 `rules.damageTypeFormulas[].formula` 直接消费共同 `inputs/stages/outputStageKey`，不再识别五字段。可信属性目录以 `domain: attribute` 与原键授权来源／目标、当前帧、基础／加成／总值；目录身份以声明作用域与原键组合保存，不从前缀猜类型。同键在本使用点存在多个允许身份时拒绝歧义，原伤害条件按完整原键比较。

原生事件、普攻能力、法术护盾供值器和施放来源的明确读取均按其已知作用域查询。属性与这些原键同名仍正常触发真实事件、普攻乘区及护盾消费；无域关系和通用匹配遇到多个可用身份继续拒绝歧义。

共同纯程序以 `GenericProgram.Authored` 进入原公式注册表，与技能旧指令共享65536程序、单程序512指令、累计262144指令、32MiB计费；共同输入累计262144、结果累计65536，绑定和读值描述一并收费。运行复制描述与索引，只共享只读内容。JSON属性缺字段保持缺失，null或非数字拒绝，合法0保留；复制属性视图保留存在标记。

正式防御位置一次求得有限非负倍率，共用于普通和暴击部分。当前帧使用入口只读视图，复制使用原事件入口冻结视图；暴击专属修正、整体修正、护盾、生命顺序保持。新定义诊断只输出实际倍率与防御后两部分，不伪造五个固定步骤。动态共同错误码及JSON字段路径保留到正式错误载荷，负倍率使用 `FORMULA_INVALID_OUTPUT`。内部用途表达式和未配置类型的默认抗性分支继续按本批范围保留。

## 技能共同公式第三阶段B

方案唯一来源为规划工作树《技能共同公式闭环详细设计》。`CompileRequest.formulas[]`（具名公式表）只接受 `key/skillKey/expression/parameters`：完整共同定义、作者技能归属和私有已选参数目录一起进入原生注册表，旧作者树不再运输。固定／技能等级／角色等级参数必须有明确有限值；计算时参数禁止默认值，实际蓄力及已提交过程成本只在原有合法使用时点开放。供值器新增可选 `skillKey`（技能归属），共同引用按真实使用点独立核对，不能借能力参数、程序名称或同名外国参数换绑。

内部用途包装通过已声明程序编号调用共同程序，不展开作者树；临时包装键不能成为宿主外部引用。每次调用创建独立输入读取器，来源／目标属性沿现有求值入口的当前视图，前序操作可影响后续求值。全部声明用于授权，输出可达读取及条件两支并集用于供值和限制；实际求值仍惰性。第三A的入口与复制冻结视图独立保留。注册预算统一计入参数、绑定、定位和依赖，调用最多32层，单次组合最多262144条指令，编译和运行分别检查。

现有属性派生项新增可选 `skillKey`（作者技能归属）；引用共同程序时必须明确并匹配，内部字面值与既有读取不新增身份要求。派生以 `combatantKey` 所属拥有方作为共同读取的来源，以另一方作为目标，原定义不重写；内部用途读取保留原战斗侧语义。编译按相同映射核对真实属性目录、输出回读及计算时参数禁令。运行的共同错误附实际拥有方，归属、定位及依赖描述计入同一注册预算。

状态默认值／上限／保持期限及生命周期最大层数／固定间隔接受数字或严格外部引用，原生检查固定／已选等级依赖后求值，按原范围冻结成计划数字。常驻与静态装备按静态依赖准入。成功编译的 `metadata.approvedStaticValues`（已核定静态输出）仅含已声明具名程序，不含临时键或动态输出；共同错误保留错误码、原定义字段定位、程序身份和实际使用引用，资源预检直接返回公式错误。

独立输入可注入真实HTTP定义和参数目录；它们不读取或复制原固定样例。以下是第三B当时的历史命令和范围；当前源脚本在第四阶段产物上单列原输入拒绝及新独立基准900，重验命令见第四阶段。

```powershell
go test -count=1 ./...
go run ./cmd/bench
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1 -Out target/formula-phase3b/tinygo_engine_v2.wasm
node .\scripts\smoke-node.mjs --wasm target/formula-phase3b/tinygo_engine_v2.wasm
node .\scripts\formula-phase3-smoke-node.mjs target/formula-phase3b/tinygo_engine_v2.wasm
node .\scripts\formula-phase3b-smoke-node.mjs
node .\scripts\bench-node.mjs --wasm target/formula-phase3b/tinygo_engine_v2.wasm --mode generic-run --iterations 10 --warmup 2
```

独立构造在 `scripts/formula-phase3-input.mjs`，不读取或复制原固定样例。最终产物 `target/formula-phase3/tinygo_engine_v2.wasm` 为1,332,322字节，SHA256 `ff7178b1fcf40eb748755edd0dbf55ec6d57bb3500e4698b93529860cb6b7cfd`；全量Go、原生基准、TinyGo构建、标准冒烟、18组共同公式正式入口专项及Node基准通过。专项入口：`node scripts/formula-phase3-smoke-node.mjs target/formula-phase3/tinygo_engine_v2.wasm`。原固定样例保持900，独立heat为原伤害120、防御50、护盾30、生命1000→950。这些原生／Node构造证据不代替真实HTTP、数据库或浏览器工作线程验收，跨端证据由规划真源独立保存。

## 阶段5A自身常驻

连续普攻准入接受角色或构筑的独立常驻来源挂载，沿同一拥有方初始化事件建立永久常量修正，不按英雄、装备或符文标识分支。首批开放完整自身非生命属性加算／比例加算及已有受到治疗／护盾修正；不接生命上限、条件、周期、动态状态或额外自主普攻。来源开关与等级由Web按完整作者数据翻译，原生不解释构筑布局，也不补默认技能等级。

额外攻速进入原属性派生，双方初始化尾部完成后才开放首刀；一个会话重复运行不残留前次常驻。`generic_permanent_skill_sources_test.go` 验证角色／构筑共同初始化和非生命边界，真实克格莫Q与攻速碎片由最终Wasm及Web工作线程补证。最终产物1,154,180字节、SHA256 `87b9d2e89898018b32d4e37df34d379f1038e8cad5d01600d78716a051f03cfa`，固定256MiB及输出清理回收契约不变；证据见规划真源《阶段5A默认技能来源与常驻初始化验收-2026-10-04》。后续章节保留各前段历史能力与产物，不将其当作当前总准入。

## 阶段5B开始与命中通用来源

连续普攻接受完整角色／构筑开始、命中、接收及明确联动，不占装备槽、不按英雄编号分支。显式 `integer`（离散整数）状态在编译、初态／恢复、写入操作数及封顶前结果检查非负安全整数，消费不可透支；普通数值声明不改义。目标计数沿实际来源与对手状态，保持刷新、旧期限守卫及精确到期复用既有实现。

实际首次过程求冷却时捕获属性／状态基线，开始结果变更后纯求值完整周期，以0完成进度预检、提交唯一等待，不重启过程或重复消费。封顶公式、非攻速依赖、同刻改期及预算失败原子性见 `generic_triggered_skill_sources_test.go`。来源有期叠层按完整声明整体到期，未新增逐层衰减或弹药恢复。

来源与承受者的单层有期普通属性实例可修正承受者自身，初值与恢复不改基础模板。总属性削减必须由明确的乘算声明编译为 `multiply`（乘算），在装备加算后执行；既有比例加算仍使用固有基数，不能偷换。25点装备加算与100点固有护甲经0.8乘数为100，到期恢复125，已作独立原生检查。

5B产物1,168,861字节、SHA256 `8a636006deed81d247bc4c1035fa2479985cc7371aa0922644a4d3d2ba7bc12b`。真实贾克斯及蔚W已按确认配置进入同一通用链；蔚W附伤后削甲、额外命中计数及仅全能吸血通过最终工作线程及两组同会话压力，不新增英雄专用代码或为此次配置重新构建相同原生产物。分层证据由规划真源《阶段5B开始命中通用链路与首批组合验收-2026-10-05》记录。前述5A／5B二进制为历史版本。

## 阶段5C特殊主体与弹药恢复

连续普攻支持保存的条件命中主体、状态存在判定、有限攻速覆盖／攻击力乘算，以及明确弹药声明。编译期核对同一拥有方和来源的唯一弹药、开始链唯一消费1和恢复方式；仅开放耗尽时一次恢复全部。真实攻击开始前检查许可并冻结消费前库存，沿原使用身份供命中条件读取。恢复与普通冷却共同约束唯一下一刀，不相加、不轮询、不生成空弹攻击；初值0先恢复，死亡和旧恢复代号不能再次唤醒攻击。

`mechanicRecords`（有限机制记录）与完整汇总独立；记录关闭、截断及采样变化均不改变结算。`summary.basicAttack.initialMechanicReadyAtMs`（初次实际机制就绪时刻）仅在零弹恢复帧成功提交后记录，允许观察终点早于恢复时返回完整的零刀结果，不依赖有限记录反推。计数与弹药即使同名也按实际拥有方、来源和状态键隔离。

属性派生按每侧最多一条攻速和一条攻击力转换执行；先完成普通依赖属性，再转换。固定攻速只消费明确静态声明，攻击力乘算不能回读自身或其他转换总值。真实艾希和烬按规划真源阶段5设计第6.4节的有限配置执行，不含随机暴击状态、强化减速、暴击移速或主动提前装填。弹药闭环仅开放连续入口，不把单次外部开始事件当作完整恢复场景。

状态存在读取只消费类型目录中明确的 `status/<key>`、`domain: status` 声明，不依赖产生该状态的效果是否开启；原生未声明拒绝，已声明但未施加为不存在。贡献不能反推目录或为关闭来源补造状态。

5C产物1,210,941字节、SHA256 `6f74674aa9c374dc8daac55a4f70b1e895633a3e352845af60718b8baaca0303`，固定256MiB。定向测试位于 `generic_basic_attack_ammo_test.go`、`generic_special_attack_test.go`；最终Wasm冒烟通过，真实组合复验由本轮记录独立列明。配置保存、HTTP、工作线程与页面证据见规划真源《阶段5C特殊普攻与弹药恢复组合验收-2026-10-05》。

## 阶段6A单次主动施放

共享契约唯一来源为规划工作树《阶段6主动技能接入与混合时间线详细设计》。本版只接一条首次尝试，不接背景普攻、重复施放或蓄力／重施。仍使用原编译、会话、运行和释放入口，不生成宿主定时伤害。

`rules.skillActionBindings`（编译期技能行动绑定）锁定拥有方、实际挂载、定义、技能、首次能力及成功完成命中能力；`driverPlan.skillActions`（本次行动计划）只选择其绑定、尝试时刻、顺序、目标及明确命中／未命中预设。6A仅一个即时或有限延时步骤；引用、阶段、过程及命中时点不符在运行前拒绝，输入事实数组必须为空。

只有真实开始帧提交后才发布接受与使用身份；开始监听条件沿已有先冻结再执行链路，自身治疗不进入过程完成尾部重治。实际过程成功完成后，在同一转移同步尾部派生命中事实并经过原命中、防御、法术护盾与吸血链，不以提前编造的命中事实替代成功施放。不需要普攻分类目录来触发纯技能的成功使用事件。

`summary.skillActions`（完整指令累计）与 `summary.skillUses`（完整使用累计）独立于有限记录；直接治疗及吸血分别计入生命账。新增行动、使用、治疗明细各有独立记录预算，显式0及采样关闭不改变结算。纯技能返回公共执行完整性；开始提交前预算失败不造使用，提交后失败保留已提交事实。观察结束可保留仍在途的过程，不提前完成或命中。

原生定向验证入口为 `go test -count=1 ./internal/runtime -run SingleSkill`，包含释放边界、未命中、真实法术护盾、冻结治疗阈值与溢出、必要消费拒绝、冷却边界、死亡未到达、接受前后预算失败、独立截断及同会话重跑。三项管理对象、最终工作线程和页面证据由阶段6A验收记录分别证明，不以这些独立构造代替真实对象。

本轮原生产物1,241,773字节，SHA256 `2ac117eb91141d81e4eb5dcc209ec7f270d57dcb1c5fff4e9dbe33231fead7b5`，固定256MiB。全量Go、原生基准、最终产物冒烟及Node通用样例基准通过；前端源码和生产副本摘要相同，真实对象以规划真源《阶段6A单次主动施放与首批真实技能验收-2026-10-05》所列最后请求与分层证据为准。

## 阶段6B有限混合行动

`driverPlan.skillActions`（显式技能计划）支持1～64条首次尝试及可选连续普攻，同一攻击方的绑定仍最多16份。按请求时刻、完整同刻顺序及稳定指令键排序；冷却未好、行动忙或同来源过程仍在途时只拒绝一次，不自动延期。初始化、过程及已有周期／到期／弹药事件先提交，同刻显式技能先于自然普攻。

计划的即时或单段延时步骤必须明确 `occupiesAction`（行动占用）；管理缺声明不能成为运行默认值。许可由真实活动过程的当前步骤和版本决定，进入／退出与过程计时、唯一普攻等待共同预检和提交；已有下一刀仅改期，不重复入队。普通冷却、真实占用及弹药恢复取最大期限，初始空弹的恢复起点不被施法锁推迟。新增首刀许可和每刀后续许可的可靠空值字段，关闭记录也保留完整统计。

成功使用、释放、命中及直接治疗沿实际使用引用关联到原指令；多条交错完成不串到最后一次施放。技能急速只消费作者表达式与明确原生取整声明，普攻继续走自己的攻速冷却。死亡一经帧提交不因失败治疗尾部恢复新行动。仍不开放多步骤、取消／重施或蓄力控制。

定向入口为 `go test -count=1 ./internal/runtime -run MixedAction`，覆盖占用释放、唯一下一刀、初始空弹重叠、同刻顺序／死亡、非零急速冷却边界、动态攻速与已有冷却改期、共同队列预检、完整使用身份、失败后治疗、命令预算、独立记录及同会话重复。当前产物1,254,720字节、SHA256 `9c5268698a4f7d20de40b21b1257179fe4751a375b0d67f497ceef583c266b14`；最终真实对象与页面证明由规划验收记录单列，不将本节独立构造当真实数据验收。

## 阶段6C有限复杂过程

在同一原生计划内开放关联已接受首次使用的蓄力释放、单次重施和主动取消。后续控制消费真实阶段能力，仅转移提交后接受，不重复首次使用、成本或成功开始事件；非法父引用在运行前拒绝，父普通拒绝、过早或窗口失效在实际时刻记录普通拒绝。最大自动释放必须明确，禁止自动释放或未重施到期以失败结束，不派生成功命中。

有限多段与引导按真实步骤进入时冻结次数和时序，在事件堆内逐段提交；每段有独立命中身份，但属于原使用。复杂过程命中只开放唯一末尾复杂步骤的实际执行，不能在完成时追加第N＋1次命中。步骤累计和有限事实分开，完整快照保存分段进度与行动占用历史；提前释放或取消实际唤醒唯一下一刀，连续占用无中间行动窗口。恢复检查已提交段不得来自未来、占用历史不能缺少已进入步骤。

引导的 `CUSTOM_WINDOW`（指定首末执行窗口）只接受成对的 `firstExecutionOffsetMs`、`lastExecutionOffsetMs`（首末执行偏移表达式），与完整时长、次数一起在实际进入时冻结。末段结束后仍占用至完整时长，不提前成功完成；单段与1毫秒两段沿共享设计第7.1节的独立范围约束。原即时／间隔后首段仍按完整时长的原公式绝对舍入，15毫秒4段即时首段保持0、4、8、11，不用舍入后的首末偏移重新插值。

`repeat`（冻结分段快照）的两项偏移均为JSON整数，Go使用 `int64` 保留Wasm中的完整安全毫秒范围；固定多段保存0及最后间隔偏移，旧引导保存真实首末整数偏移，仅作为恢复证明。恢复核对实际步骤口径、冻结次数／范围、已提交最后时刻、下一段及完整占用期限，不重读后来变化的作者参数。定向入口为 `go test -count=1 ./internal/model ./internal/compile ./internal/runtime -run 'ProcessChannelWindow|ComplexSkillChannelWindow'`，构造证据不代表真实管理技能已经录入或完成浏览器联调。

`use.charge_duration_ms`（原使用充能毫秒）只在真实蓄力执行或其关联命中上下文供值，普通命中不能补零。蔚Q的0／1250／6000毫秒暂定口径属于经负责人确认的作者配置，不放入原生英雄分支。具体字段与组成边界唯一来源为规划真源阶段6设计第7.1节。

定向验证入口为 `go test -count=1 ./internal/runtime -run ComplexSkill`，窗口扩展前20项测试覆盖分段时刻、父控制、原冷却、观察截断、取消／死亡、占用、共同队列预算、旧计时、严格恢复、指定自然命中来源和重复运行。真实提交进度另以执行序号、最后执行及完成时刻保存；预算中断同刻恢复不重复付款、开始或旧执行，不宣称完整续接未完成命中尾部。通用机制与最终产物证明不等于蔚Q或女枪R的真实管理数据联调；业务对象尚需真实录入、只读回查及页面验收。窗口扩展前产物1,289,935字节，SHA256 `07f48a12d5e8a999769c9cb25c6038127b3bf224bde140a59f15a67a919c93a3`，256MiB固定内存不变。

本次窗口扩展新增20项原生测试，受影响检查、全量Go、原生基准、最终TinyGo构建、Node冒烟及通用基准10次／预热2次通过；同一最终Wasm的23项构造专项及20次同会话重复通过。最终产物位于忽略目录 `target/6c-channel-window/tinygo_engine_v2.wasm`，1,296,076字节，SHA256 `2673db53f6b21d4ac6b95c77f45859e76b479cdc465e142c5c62c0b99652bc6c`，内存仍为256MiB。精确输入、摘要、命令、结果与26项原脏改保护核对见该目录《证据记录.md》；未同步Web产物，不包含真实管理对象或浏览器验收。

## Review 顺序

| 阶段 | 阅读目标 | 关键文件 |
| --- | --- | --- |
| 1. 契约与 ABI | generic DTO、frame kind `200..214`、错误码、outbox 优先级 | `internal/model/generic*.go`、`internal/abi/frame.go`、`internal/abi/outbox.go` |
| 2. Wasm 入口 | 导出是否只做装配；session 是否唯一状态持有者 | `cmd/engine_wasm/main.go` |
| 3. 生命周期 | compile → registry → run → release | `internal/runtime/session.go` |
| 4. 编译层 | `CompileGeneric` → `CompiledSession`，collect-all | `internal/compile/generic.go`、`generic_validate.go` |
| 5. 运行主循环 | `RunGeneric`、gate、provider、execution、scheduler | `internal/runtime/generic_run.go`、`generic_execution.go`、`generic_gate.go`、`generic_provider*.go` |
| 6. 公式 / 类型集 / pipeline | 只读编译结果的消费边界 | `internal/formula/generic*.go`、`internal/typeset/generic.go`、`internal/pipeline/**` |
| 7. 验证契约 | 显式作者输入 + Node/Go基准 | `scripts/formula-phase4-input.mjs`、`internal/testkit/fixtures/formula_phase4_explicit_basic_damage.json`、`scripts/smoke-node.mjs`、`cmd/bench`；旧输入单列拒绝 |

历史说明：旧 `engine_init` / `engine_begin_run` / `engine_step` 与 `dps_*.go` 单攻 DPS 曾作为 compat lane；现已从本模块源码与导出中移除。当前唯一业务 ABI 是 compile/run/release。

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

## 当前已接入能力

### 阶段2无装备连续普攻

运行请求的 `driverPlan.basicAttack`（原生连续普攻计划）由 `internal/model/generic_basic_attack.go`定义，通过同一编译／会话／运行／释放入口使用；`driverPlan.entries`必须是空数组，不能同时传入外部使用、开始、命中或过程控制事实。基础阶段2从0毫秒开始、A所选一份静态共享普攻、双方当前生命为正；4A接入核定固定装备与静态攻速派生，4B接入下述封闭的常驻初始化与静态光环。仍不开放动态攻速、费用、触发被动、其它监听、前摇或弹道。基础字段、预算及退出口径的唯一详细来源是规划工作树《阶段2无装备连续普攻详细设计》，既有最终产物与浏览器证据见《阶段2无装备连续普攻验收-2026-10-02》。

- `generic_basic_attack.go`（连续攻击组织）每刀生成新使用身份，执行真实开始、首次即时过程、命中与全部原结果，只排下一刀；攻击间隔只读取实际首次过程控制能力下已提交的绝对冷却就绪时刻。`roundPositiveMs`（正值冷却毫秒转换）先校验原式有限且为正，再取整且最低1毫秒，不重新求值或另等一次间隔。
- `generic_basic_attack_admission.go`（初始场景准入）核对原始快照与本次编译的属性、资源、挂载一致；未知挂载、临时状态或不支持的原技能结构整体拒绝，不能先归一化后静默丢弃。攻速上界来自属性目录或显式场景输入，仅是准入范围，不是游戏封顶。
- `generic_frame_commit*.go`与`generic_execution_budget*.go`（执行提交及预算）统一相关生命、过程、冷却、历史、证据和统计的提交，真正使用编译队列容量。同刀命令跨候选和监听累计，已知预算停止返回一致的已提交部分；非连续运行仍沿既有错误返回。
- `generic_basic_attack_output.go`（可靠结果）在提交时累计`summary.basicAttack`（开始／命中／完成次数）、`summary.execution`（击杀／完整性／预算原因）、实际扣血及`damageBreakdown`（来源与类型汇总）；有限`attackRecords/damageRecords`（逐刀／伤害记录）与`recording`（保留及丢弃计数）独立于完整汇总和调试证据。已经致死但尾部未完成时，击杀为真且完整性为假。
- `generic_sampling_cursor.go`（只读采样游标）在同刻战斗提交后观察，不进入事件堆、不消费执行预算；`sampling.disabled`关闭时返回空序列和采样说明。记录预算为0、截断或改变采样均不改变战斗。

既有单次入口保留原生事实限制；阶段2不是宿主循环提交单次请求。`generic_p0_basic_damage.json`基准输入未改动，采样专项构造用例只调整观察结束口径。原生检查之外，最终Wasm已由Node往返和实际浏览器工作线程验证，真实页面共享普攻连续击杀证据不推广为任意普攻或后续阶段支持。

### 阶段4A固定装备与攻速派生

共享契约见规划真源《阶段4装备接入与机制验收详细设计》第4～6节。宿主按拥有方选择装备，一件装备的固定属性仅挂载一个 `kind:item`（装备供值器）；基础值保留角色固有值或显式补填值，装备贡献通过无条件属性加算求得总值。真实零基础值不再回退到当前值；求值失败明确终止，不丢弃修正后继续成功。

`rules.attributeDerivations`（属性派生规则）每侧最多一条、合计最多两条，本轮目标仅限 `attack_speed`（攻速）。每条包含 `combatantKey`（拥有方）、`attributeKey`（目标属性）和 `value`（既有通用数值表达式），读取的属性必须存在，派生目标仅能读冻结基础值，不允许读取其总值、运行事件、资源或供值器状态。额外攻速派生保留已有自然成长，不把固有额外比例再次叠加；收益系数缺失、非正或非有限明确拒绝。先完成双方普通属性，再求派生，最后施加目标攻速修正，不新增公式执行器。

连续入口按实际完整能力引用定位普攻，不再依赖挂载数组首项。双方装备挂载集合严格等于编译输入，每侧最多六份固定装备，全部单层、持久、拥有方与来源方一致且没有旧运行状态；固定属性来源仍不允许夹带能力、监听、生命周期或非平加贡献，4B初始化及4C首批触发来源分别核对。单次与连续均由原生核对含装备生命上限，当前生命只能保持在合法范围内，不自动满血。等待安排唯一使用原普攻过程同冷却键；4A／4B静态范围不变，动态改期见4C首批。

定向检查：`go test -count=1 ./internal/model ./internal/compile ./internal/pipeline ./internal/runtime -run 'AttributeDerivation|AttributeResolver|Equipment|ContinuousAttack'`。功能收尾继续全量Go测试、原生基准、最终Wasm构建、Node编译／运行／释放及实际浏览器验证；构造测试不替代真实管理配置证据。

### 阶段4B常驻初始化与静态光环

共享契约见规划真源《阶段4装备接入与机制验收详细设计》第5～6节。宿主只开放振奋盔甲完整受到治疗／收到普通护盾修正与冰霜之心静态总攻速光环；内核按通用事件及修正结构执行，不按装备名或固定百分比结算。

- 编译类型目录声明 `event/source_initialized`（来源对象初始化完成）时，原生在0毫秒为双方各发一次自身初始化事件；事件来源与当前目标均是自己。初始化及其同步尾部优先于首刀，不由宿主伪造开始事件触发；初始化共享命令与事件预算，未全部完成不得开始攻击。
- 连续准入只接受单层永久装备初始化、仅匹配自身初始化且每条触发一次的监听及静态结果；其 `stableId`（稳定来源标识）必须对应同方唯一固定装备，初始化挂载不重复占固定装备槽。拒绝无父来源、重复初始化、全局未选修正、动态状态和其它触发。
- 收到普通护盾修正采用 `shield/normal_shield/received`（普通护盾接收链）及独立比例加算组，只改变新护盾施加量。现有护盾剩余量、到期时间和法术护盾不受影响；受到治疗复用既有接收链。
- 光环由拥有方常驻来源对 `opponent.attr.attack_speed`（对手总攻速）施加常量倍率，位于固有与装备额外攻速派生之后；每受量方只准入一份光环。宿主必须事先验证明确的范围假设并编译目标投影；`runtimeOptions.equipmentAssumptions` 只冻结审计输入，不由内核解释为动态范围事件。

定向入口为 `go test -count=1 ./internal/runtime -run 'SourceInitialized|PermanentEquipment|PermanentAura|ReceivedShield|ContinuousAttackRejects'`。构造中100单位治疗／普通护盾变为125，旧护盾与到期保持；真实完整作者树、最终二进制、工作线程重复运行与释放另见规划真源《阶段4B常驻装备与静态光环验收-2026-10-03》。构造盾能力不是完整触发装备实装，4C首批另见下一节。

### 阶段4C首批命中附伤与动态等待

共享契约见规划真源《阶段4装备接入与机制验收详细设计》第7～9节；当前只准入拥有方固定装备下的真实命中监听、即时对手伤害、来源范围数值状态及自身额外攻速修正。宿主首批真实装备只开放完整反曲之弓；鬼索、周期、延迟再次命中、受击反应及目标范围动态状态仍未开放。

`generic_basic_attack_wait.go`保存原生同冷却键的进度，不增加第二只等待时钟。执行帧在提交前求新周期、消费改期命令、核对队列容量，再共同发布属性、冷却和等待；堆内唯一节点原地改期并保留本运行代号守卫。来源范围状态在连续路径安排精确到期，旧期限不能清除刷新状态，到期清理与派生重算沿同帧提交。整数邻域精度及原始／最终就绪口径以共享设计为准。

同步普攻波的附伤关联实际当前刀，非同步事件不挂到最近一刀，刀额只累计A到B；受量总计独立于可靠明细截断。停止后清空最后有效下一刀，原始 `readyAtMs`不被变速覆写，新增 `finalReadyAtMs`保存调整后就绪。

定向入口为 `go test -count=1 ./internal/runtime -run 'ContinuousEquipment|ContinuousWaiting|ContinuousTimed|SourceStateExpiry'`。通用400毫秒到期例实际三刀0、600、1200，并经最终浏览器工作线程证明；它不是鬼索实装。真实反曲、吸血例外和全部分层证据见规划真源《阶段4C首批附伤与动态等待验收-2026-10-03》，4C整体保持部分完成。

### 阶段4C后续计数、内部冷却与持久周期

共享契约见规划真源《阶段4装备接入与机制验收详细设计》第8.1及9.2节。已选固定装备下的持久来源可有一项非锚定 `kind=tick`（周期能力），也可与既有拥有方命中监听共存；仍拒绝临时周期来源、额外主动能力、过程、费用、目标状态及自由事件。来源计数与内部冷却复用既有状态、期限及单个操作条件，不把附伤或周期当作新一次普攻命中。

`generic_periodic_equipment_admission.go`完整校验上述范围；`generic_provider_tick.go`按拥有方和挂载标识稳定播种，以真实挂载引用和唯一对手执行。连续周期采用严格读取以保留作者默认状态，起始及下一跳时间先检查剩余观察范围再相加，避免溢出；下一跳与状态到期、数值共同预检提交，状态刷新不重新播种。0或省略延迟沿现行首个完整间隔定义，负数编译拒绝。观察终点包含，死亡后不继续排程。

可靠伤害记录新增实际来源生命前后，逐笔冻结本笔伤害及其吸血，不在整帧提交时借最终生命；来源没有生命属性时明确为空。连续汇总保存双方实际自身吸血入账，不随记录或调试证据截断；本期无其他生命修改，因此双方起末收支保持可严格核对。周期伤害保持无刀号，两方周期致死与最后一刀后的生命变化沿真实提交时刻解释。

定向入口为 `go test -count=1 ./internal/runtime -run 'ContinuousEquipment(Counter|Cooldown)|ContinuousPeriodicEquipment'`。最终产物、全量原生检查、7项新增通用构造、真实反曲回归和浏览器证据见同一4C验收记录的2026-10-04补充；它们不代表真实鬼索、荆棘或日炎整件已开放。

### 阶段4C配置驱动的接收反应与有期周期

共享契约见规划真源《阶段4装备接入与机制验收详细设计》8.2。新增 `event/basic_attack_received`（真实普攻结果前接收）及 `event/damage_taken`（逐笔伤害、吸血提交后通知），原攻击者、接收者和使用身份保持冻结；`event/target_owner` 仅允许真实接收方匹配。合法零伤和普通盾吸收仍有成功事实，结构失败不发成功通知。联动沿原使用身份，不再产生普攻开始／命中；是否响应由配置决定。

连续门禁按已选装备的实际拥有方、稳定来源与完整节点开放条件、同次额度、来源状态、命中联动、单源收到治疗取强及有期伤害周期，不按装备名求值。临时周期保持真实实例引用，另输出来源定义和首次激活时点；刷新只改期限、保留唯一下一跳，执行读取当前期限、到期刻不跳。首次播种、续跳、死亡与队列预检同口径，修复初始或旧期限剪裁造成的刷新断链。

定向入口：`go test -count=1 ./internal/runtime -run 'ContinuousReceived|ContinuousDamageTaken|ReceivedEquipment|ContinuousConfiguredHitLink|ContinuousTemporary'`。全量原生、基准、最终Wasm与真实浏览器证据见4C验收记录2026-10-04第9节；鬼索／荆棘／日炎时序是用户授权的项目默认版，不是固定游戏版本已全部核实。

组合补验只扩充已选装备下完整普通移动减速状态的连续准入：单个按来源与承受者的有期单层实例，必须投向真实对手，不得混合能力、修正或生命周期周期。沿既有状态快照、取强、重施及到期执行，不改变攻速、不模拟移动。当前生命附伤、近远属性条件、计数与内部冷却沿已有通用公式和状态操作，不按破败、智慧末刃标识增加算法。共享契约见阶段4详细设计8.3，定向入口为 `go test -count=1 ./internal/runtime -run 'ContinuousMovementEquipment'`；真实组合证据见4C验收记录第10节。

同一会话重复运行的内存回收契约见阶段4详细设计8.4。宿主复制输出并解除输入引用后，`engine_outbox_clear`先清空输出长度，再进行标准垃圾回收；编译会话仍存活，固定256MiB、TinyGo版本及原回收方式不变，不在战斗执行帧中回收。该安排避免大量短命对象积累到堆满，晚回收后仍因连续空闲块太小而无法编码输出。`node scripts/session-reuse-smoke-node.mjs`显式使用第四阶段独立作者基准，验证同会话重复、错误后恢复、释放重编及记录截断；`--fixture <文件>`可读相同结构的真实请求和可选 `runVariants`（不同观察请求），不是另一个业务宿主。内存诊断导出只存在于忽略目录的诊断构建，不进入正式接口；回收固定耗时和最终真实压力证据见4C验收记录第11节。

### 现行数据的结果公式与单次攻击入口

接入范围与分阶段验收的唯一来源是规划工作树《单攻击方计算六阶段推进方案》第3.2～4.3节。本模块新增以下可编译且有实际运行消费路径的声明；构造测试证明通用机制，真实管理数据的编译与释放仍由前置任务验收，真实单次运行归阶段1，连续攻击时钟归阶段2。

- 伤害操作的 `critChance/critMultiplier`（当前结果暴击率及倍率公式）必须成对且配合 `critEligible=true`（可暴击）。期望伤害沿既有确定性暴击乘区结算，严格读取两项公式；专用倍率不写回全局属性。复制伤害保留原笔暴击结果，防御仍仅结算一次。
- `rules.damageTypeFormulas`（伤害类型五阶段公式）按完整类型身份精确匹配，每项保存 `damageType` 和 `formula`。五阶段依次为基础抗性、百分比穿透、固定穿透、有效抗性、抗性倍率。表达式只接受固定值、双方属性或资源、六种双值运算和 `damage.stage.<固定大写阶段码>`（前序阶段读取），拒绝同阶段、后序、技能参数、缺阶段或其他公式语言。开启此规则集后，所有已使用伤害类型都必须有对应公式；该防御位置替代固定抗性处理，不叠加处理两次。
- `apply_attack_link/apply_hit_link`（攻击及命中联动应用操作）严格读取非负整数次数，不取整。每次应用消耗一条命令预算，操作本身也计入预算；巨大次数在创建事件前失败。零次仍有应用证据但不发事件。实际应用产生 `event/attack_link_applied` 或 `event/hit_link_applied`（两类原生联动事件），记录同次使用身份及从1开始的 `LINK_INDEX/LINK_COUNT`（本次序号及总次数），监听公式通过 `event.link.index/count` 读取。两类联动不会再次产生普攻开始或命中事件，也不能用自由发事件操作伪造。
- `processControl.useRefFromEvent=true`（从原生事件复用使用身份）仅用于 `INITIAL`（首次开始）的主动普攻过程控制能力。过程须有且只有一个首次控制；来源拥有者的监听须明确同时匹配 `event/basic_attack_start` 和 `event/source_owner`（来源为本挂载拥有者），并且只调用该控制能力。原生开始仍由空操作的单次开始驱动和 `attackStartFacts`（攻击开始事实）提供；控制能力不能被普通驱动借用。命中使用独立的单次命中驱动与 `skillHitFacts`（命中事实），与开始、过程共用同一 `skillUses`（真实使用记录）的来源、技能、使用标识和实际目标。即时“记录发起”步骤不自动变成命中。

过程冷却仍消费初次控制能力的完整引用。适配层保留原攻击间隔表达式，并在整数毫秒边界明确包裹 `round`（四舍五入）；联动次数不使用该时间转换。尚未接入的作者入口继续明确拒绝。

定向通用验证入口为 `go test -count=1 ./internal/model ./internal/runtime -run Authoring`；收尾继续执行本模块全量Go检查、性能基准、最终构建及通用Node往返验证。真实浏览器工作线程和所选场景证据由主负责人独立验收。

普通减速与取强治疗的`source_target`（按来源与承受者）实例恢复必须提供真实来源、当前承受者、非空实例标识、单层与正到期时间；缺失不按自身或默认层数补齐。同一归属不能恢复两份实例，新生成标识不复用恢复过的标识。已到期记录允许输入但不贡献有效强度，再次施加建立新生命周期；期限必须为可表示的正整数毫秒。

| 区域 | 状态 | 说明 |
| --- | --- | --- |
| Generic ABI / frame / outbox | 已接入 | kind `200..214`；优先帧保留 |
| Session registry + hash 校验 | 已接入 | `session.go` Compile/Run/Release |
| `CompileGeneric` | 已接入 | collect-all；输出 `CompiledSession` |
| `RunGeneric` | 已接入 | driver plan、gate、damage/heal/resource、provider tick |
| 阶段2连续普攻与可靠结果 | 已接入 | 原生逐刀与过程冷却、相关提交一致、有限记录与完整汇总、只读采样隔离；静态共享普攻范围 |
| 通用吸血 | 已接入 | 游戏规则与伤害例外；普通、复制伤害共用末尾吸血结算；治疗修正与逐次证据 |
| 跨来源状态合并与重施 | 已接入 | `source_target` 单层重施、普通减速取强快照、`effectiveStatuses`、治疗组 `ratio_max` |
| 命中供值与法术护盾 | 已接入 | `resolve_skill_hit` 单次 driver、`skillUses`/`skillHitFacts`、四档阻挡与 `event/spell_shield_blocked` |
| 同次使用、固定时间窗与普攻原生事件 | 已接入 | `listener.condition` 冻结、`oncePerUse` 专用账本、`start_on_first_write`、`operation.outputRef`、`event/basic_attack_*` |
| 主动过程与阶段时点 | 已接入 | 顺序即时/延时、末尾蓄力或单次重施、原子成本、取消/中断、实际成本退款、可恢复实例 |
| 显式作者基准 | 已接入 | `formula_phase4_explicit_basic_damage.json`（目标生命900）；旧固定输入缺公式明确拒绝 |
| Node smoke | 已接入 | 真实 compile/run/release round-trip |
| Node / Go bench | 已接入 | `--mode generic-run` / `go run ./cmd/bench` 默认 generic |

## 常用命令

运行时的英雄命名测试保留历史 Wiki 来源、数值边界、排除项和通用构造样例的编译运行检查。旧战斗链的 35 份种子及其后端检查已在 2026-08-29 的 `4e448817b` 删除，因此当前测试不再读取旧种子、旧后端检查文件或旧说明字节，也不以测试时工作树只能修改某一文件作为产品断言。构造样例的通过只证明原生通用机制，不表示现行管理配置已经保存或通过真实页面、工作线程验证；迁移逐项记录见本轮原生历史检查迁移证据。

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
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1 -TinyGo "C:\path\to\tinygo.exe"
```

### TinyGo 工具链定位

`Get-Command tinygo` 或 `where.exe tinygo` 未命中只表示当前终端的 `PATH` 没有 TinyGo，不代表机器上未安装。当前项目级 TinyGo 0.40.1 位于：

```text
C:\project\tinygo0.40.1\tinygo\bin\tinygo.exe
C:\project\tinygo0.40.1\tinygo\targets\wasm_exec.js
```

可直接复核版本：

```powershell
& 'C:\project\tinygo0.40.1\tinygo\bin\tinygo.exe' version
```

`build-wasm.ps1` 会先解析传入值或 `PATH` 中的 `tinygo`；默认值未命中时，再依次查找仓库级 `.tools\tinygo0.40.1\tinygo\bin\tinygo.exe` 和项目级 `C:\project\tinygo0.40.1\tinygo\bin\tinygo.exe`。因此在当前项目布局中无需修改全局 `PATH`，直接运行默认构建命令即可。工具移动到其它位置时再显式传入 `-TinyGo`。

Node 宿主必须加载与编译器同版本的 `wasm_exec.js`；仓库脚本同样会查找上述工具目录，也可用 `TINYGO_WASM_EXEC` 显式指定。

## 构建

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
```

等价于：

```powershell
tinygo build -scheduler=none -no-debug -opt=z -target .\targets\wasm-256m.json -o .\dist\tinygo_engine_v2.wasm .\cmd\engine_wasm
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
- 构建默认 `-scheduler=none -no-debug -opt=z`。
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

方案唯一来源为规划工作树的《管理页面与共性机制迭代计划》第6项必要增量 `authoring-p6-shield-r2`。该项只补通用 `shield` 操作的可选期限，不实现普通护盾重施、衰减或伤害类型筛选；后续4B增加的普通护盾接收链见本文件阶段4B小节。

- `operation.shieldDurationMs` 仅 `shield` 允许；其它操作携带时编译拒绝。省略字段仍表示无期限（`expireAt=0`）。
- 编译对可折叠常量拒绝非有限、非整数、非正数及 `>=2^63` 的值。运行在施加帧严格读取，转换为 `int64` 前做相同校验，再拒绝 `nowMs+duration` 溢出或到期时刻不晚于当前时刻。缺失输入不能补零。
- 有期限实例使用原 `shieldRef` 作为定义前缀，分配确定且不与恢复实例、本 run 已用编号冲突的运行引用。仅成功提交的新有期限实例入队到期清理。
- 清理按完整引用匹配，且只移除已经到期的实例；旧事件不能删刷新后或新实例。快照保存/恢复 `expireAt`。到期采用左闭右开：到期同刻不能再吸收，施加同帧仍可吸收。

专项验证覆盖期限内吸收、到期同刻、同帧吸收、引用冲突、恢复清理、非法期限与失败帧。2026-09-23最终产物895683字节，SHA256为`620763fce922e91e3a33f6b8a1597ff528ffcf7a53200cabecf50f548ee3415b`；真实浏览器Worker第6项13项通过，另第5项10项、第7项8项及通用吸血8项通过。第6项包含原库星蚀护盾公式与期限，不代表原装备全部触发资格已核定。分层证据由唯一计划及其《命中与触发运行》验收记录维护。

### 主动过程与阶段时点

方案唯一来源为规划工作树《管理页面与共性机制迭代计划》第4项 `casting-runtime-r2`。过程定义位于 `ProviderDefinition.processes`，能力继续使用 `kind=active`，由 `processControl.action` 声明首次施放、重施、蓄力释放、取消或中断。过程控制只接受单次驱动与明确 `processCommandFacts`，绑定已有真实 `skillUses`。

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
