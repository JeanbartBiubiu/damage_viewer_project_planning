# 机制回归用例

引擎或前端适配层变化后的回归，以这里的固定合成用例为准，不再逐个重跑已准入英雄。每个用例是一份不变的管理端业务数据（合成游戏 `mechanism_lab`，不引用 LoL 实库或英雄配置），加上事先手算好的期望结果。

```powershell
npm run test:mechanisms   # 只跑机制回归；npm test 也会包含
npm run check:wasm-build  # 先由当前源码正式构建，并与分发Wasm逐字节比对
```

分发产物启用计算验签时，Node 数值宿主也签发真实的第 2 版短期维护票据，不关闭验签。签名材料仅从本机忽略目录 `config/auth/grant-private.pk8` 或明确的 `DAMAGE_TEST_GRANT_PRIVATE_KEY_PATH` 读取，先核对与分发声明的受信公钥匹配，不写入证据。纯传输替身用例单独限定其模拟授权策略，正式协议拒绝与真实产物计算分别验证。

## 链路与比对

`mechanisms.test.ts` 对每个用例走与战斗分析页相同的生产链路：快照校验、公式预检、适配层装配、编译、按模式生成运行请求、真实 Wasm（`src/engine/wasm/tinygo_engine_v2.wasm`）运行、结果完整性核对、同会话重放一致、释放会话。

结果先投影成只含业务语义的字段（见 `mechanismCase.ts` 的 `MechanismProjection`），再与 `expected` 比对：

- 对象只比较写出的字段，数值按相对误差 1e-9 比较。
- `restorations`完整比较普通生命及非生命资源恢复的请求值、实际增量、前后当前值、溢出、拥有者、实际挂载、操作路径和原使用；不以终值代替逐笔事实。
- `damage`、`healing`、`skillStarts`、`resourceChanges`、`finalResources` 列表按发生顺序比较，条数必须一致；`attackStarts` 整体相等；`finalAttributes` 逐项核对明确填写的双方属性。
- `finalProviders`（运行实例列表）完整比较双方所有实例的拥有者、来源、定义、层数和期限，稳定排序后核对条数与五个字段；缺少身份直接失败，不补造来源，不筛掉额外实例。
- `shieldAbsorptions`逐笔核对真实伤害身份、完整盾与关联实例、创建归属、余量连续性和吸收守恒；`finalShieldWaits`核对实际父挂载中的等待值及截止时刻，不从总额补造逐盾事实。无新读取的旧场景须保持原证据字段。
- `ammoMechanics`与`finalAmmo`成对声明时，完整核对主动弹药每笔原提交顺序、真实首次使用、编译归属、库存及精确整数时刻；不从最终伤害推断回充，也不求值公式补造记录。未声明的旧用例保持原投影路径。
- 失败时实际投影写到被忽略的 `web/output/mechanisms/<caseKey>.actual.json`。

## 文件

| 路径 | 内容 |
| --- | --- |
| `catalogs/mechanism_lab.json` | 合成游戏的共享规则：属性、物理/魔法/真实伤害公式（先百分比后固定穿透、最低为0，倍率 100/(100+有效抗性)）、暴击与攻速属性键、普攻生命偷取规则 |
| `catalogs/mechanism_derived.json`、`catalogs/mechanism_vamp.json` | 分别显式声明攻速派生、正值技能与反伤吸血规则，不改变基础目录的既有规则 |
| `cases/<caseKey>.json` | 单个用例，文件名必须等于 `caseKey` |
| `admitted-coverage.json` | 正式准入对象依赖的机制标签，供证明刷新脚本核对覆盖 |

用例字段：`schemaVersion`（固定 `mechanism-case-v1`）、`caseKey`、`title`、`mechanisms`（机制标签）、`derivation`（手算推导，逐步写清）、`catalog`、`snapshot`（与管理端 `SimulationSnapshot` 相同，去掉 `gameId`、`catalogs`、`snapshotDigest`、`readAt`、`executionSkillKeys`）、`scenario`、`expected`。合成数值向量由用例装配器显式提供空执行表，不声明维护候选覆盖；生产快照仍必须带服务计算的执行表，不接受缺字段兼容。`scenario.mode` 为 `continuous_attack`、`skill_action` 或 `automatic_skill`，后两者分别需要 `actions` 和 `automaticRules`。场景可明确填写 `mechanicStateInputs`、`sceneParameterInputs`、`equipmentAssumptions`，均沿生产入口校验且不补默认值；形状见 `src/engine/skillActionRequest.ts`、`src/engine/automaticSkillRequest.ts`。

## 编写规则

1. 期望值必须含有效数值断言（空对象、只写名称或空列表不能获得覆盖），并来自手算或游戏机制资料，推导写进 `derivation`。不得先跑引擎再把输出抄成期望；跑出来与手算不符时，先复核推导和机制语义，确认是产品缺陷就修产品代码。只有能证明原推导错误时才改期望，并在 `derivation` 说明。
2. 一个用例只验证一个主机制，可以顺带已覆盖的基础机制。数值取整或便于手算，避开恰好落在观察时长边界的时刻，除非边界本身就是要验的机制。
3. 从最接近的现有用例复制后修改，JSON 是唯一来源，不写生成器。属性值写进角色等级值，`scenario.attributeInputs` 只能填本次计算实际需要的属性。
4. 共享目录只追加属性、伤害类型或规则，不改已有含义；追加后跑全量确认旧用例不变。需要不同规则时新建目录文件。
5. 新增机制标签时在用例说明其数值语义；用例内标签是唯一清单。新机制进入引擎或适配层时，同一改动里带上对应用例，并核对受影响对象的依赖声明。

已知的适配约束：

- 技能施放事件直接执行效果的规则必须带来源属性条件，可用恒真条件（当前生命比例 ≥ 0），见 `direct_heal_overheal`。
- 持续普攻模式不返回治疗明细，生命偷取只比较汇总。

## 已覆盖的数值机制

用例和机制清单以 `cases/*.json` 及其中的 `mechanisms` 为准，不另维护数量或逐标签副本。`kill_restore_*`四例使用明确当前法力1或45、真实容量50，手算致死/非致死/过量致死/回复上限；`scenario.initialResourceInputs`缺失不补满。

| 范围 | 固定用例入口 |
| --- | --- |
| 同组与异组属性、剩余比例后置、永久/有限发出及承受伤害、精确到期/刷新、方向隔离、真实装备及命中属性 | `grouped_*`；12例使用独立目录，原248例保持原数据。原伤害金额沿既有口径取造成修正后、防御前，三例首次字段误读的修正原因保存在各自推导中。 |
| 普攻节奏、间隔取整、暴击、穿透、击杀与过量伤害 | `basic_attack_*`、`physical_penetration_order`、`skill_magic_ratio_cast_delay` |
| 装备属性合并与攻速派生 | `equipment_*` |
| 普通盾、耗尽、刷新、反伤按目标额度、破盾不反伤、限时减伤 | `defense_*` |
| 本笔逐盾吸收、首次自身损盾等待、等待中不重置、扣血重置、外盾与同刻到期 | `defense_linked_shield_*` |
| 期限内削减双抗、整体削甲、属性时间衰减、剩余比例组合、损失生命求伤 | `damage_*` |
| 有限周期与到期、刷新保持原周期节奏 | `periodic_*` |
| 真实首次过程施加有限纯周期、零延迟首跳、刷新保留相位、当前属性读取 | `finite_immediate_*` |
| 按实际提交总冷却比例返还、急速取整、满血与全盾、同使用多笔、关闭与未计划隔离 | `committed_total_refund_*` |
| 逐枚弹药、第三发、未命中扣弹与普攻缩短回充 | `ammo_*` |
| 每轮读取当前急速、等待中不重算、正毫秒四舍五入及精确恢复记录 | `ammo_dynamic_haste*` |
| 真实普攻主体先挂标、同笔伤前标记、修正前原额派生真伤、零伤害、伤后挂标、已有标记续期及精确到期 | `marked_raw_*` |
| 有限引导、完成冷却、动作占用、后继资格与等待冷却 | `channel_*`、`schedule_successor_cooldown_wait` |
| 强化附伤、下一刀主体替换、附伤共存、计时重置、开始计数快照、逐结果暴击 | `empowered_*` |
| 战前0至3计数、每N次命中、同事件条件冻结、显式永久属性初值 | `passive_*` |
| 生命偷取、直接治疗与过量、正值全能吸血、反伤与逐结果吸血资格 | `basic_attack_life_steal`、`direct_heal_overheal`、`healing_*` |
| 本笔击杀冻结、普通自身回复、完整恢复归属及生命/法力夹取 | `kill_restore_*` |
| 真实命中有限受治疗降低、零伤害与未命中、精确到期、刷新及同组取强 | `hit_healing_modifier_*` |
| 有限生命上限、净增量授予、刷新与夹取、同实例双抗 | `resource_finite_*`、`resource_same_instance_*` |
| 普通费用按产品口径忽略、未来提交冷却倍率 | `resource_ordinary_cost_ignored`、`schedule_future_cooldown_duration` |
| 普攻命中缩短同来源主动剩余冷却，并唤醒真实自动施放 | `schedule_basic_attack_reduces_cooldown` |
| 真实技能命中缩短最多四个已绑定首次入口的冷却、未驱动隔离、自动唤醒、未命中及技能生命偷取夹取 | `skill_hit_cooldown_reduction_*` |
| 真实兄弟技能施放保留活动属性的最低余时、旧到期事件失效、到期不复活与自身整体增幅 | `duration_ensure_remaining_own_attributes` |
| 真实目标计数、实际命中开窗、后台普攻或兄弟命中叠层、满层与自然终点、旧回调失效及同刻先后 | `target_counter_*` |
| 自有有限目标计数余时、真实兄弟施放保底余时、边界与到期不复活、普攻消费及未计划兄弟隔离 | `target_state_remaining_*` |
| 单目标总移速乘算、百分数换算与有限单层整体刷新 | `ordinary_target_move_speed_refresh` |
| 有限禁锢与晕眩实例、旧期限前后的唯一实例、精确旧期限及最终到期、未命中不施加 | `finite_status_*` |
| 普攻发动前计数、显式初值、发动消费与命中叠层、自身有限总移速乘算 | `attack_start_counter_*` |
| 每次使用独立分阶段命中、首段未命中不授予后续资格、自由准备期兄弟动作与后续占用 | `staged_hit_*` |


强化用例逐笔检查伤害时刻和组成，避免总额正确却在施放时提前伤害。`process_charge_*`核对真实蓄力毫秒、结束后的自身状态清理、剩余冷却扣减，以及实际付款前后与自然失败退款后的资源快照。普通费用不进入现有资源上限变化明细。独立斩杀结果和其他控制仍按对应证据判断，回归覆盖与首次对象准入、浏览器冒烟分别留证。

`marked_raw_*`使用完整四规则作者图和最终真实普攻候选边界，不能证明先挂标顺序的组合明确拒绝。该系列只覆盖抗性与普通盾；永久和有限分组增幅由独立的`grouped_*`系列核验，不据此开放无命中步骤的主动对手盾。法盾与原额的通用协议探针仍与管理作者链证据分开。

## 与准入证明的关系

正式准入证明（`server/data_manage/src/main/resources/simulation-verification/<gameId>/combat-analysis.json`）绑定 Wasm 摘要和适配器版本。引擎或适配层变化后运行：

```powershell
node scripts/refresh-verification-identity.mjs          # 只检查
node scripts/refresh-verification-identity.mjs --write  # 条件全部满足后改写证明根
```

脚本要求 Wasm 身份常量与产物一致、相关源码已提交（源码身份即提交号）、每个 `PASSED` 对象在 `admitted-coverage.json` 声明的内容/外部依赖摘要与正式证明一致、依赖机制都有用例。完整刷新还必须先按正式参数构建当前Go源码和目标配置，重建字节与分发Wasm完全相同后才运行机制回归；缺构建工具、构建失败或产物不符均拒绝生成证明，没有跳过构建的参数。构建仅写入忽略目录，不覆盖正式产物；工具版本及安装位置见引擎README。

全部通过后只改写证明根上的 `wasmSha256`、`adapterVersion` 和 `mechanismRegression`（含实际重建产物摘要），各对象的内容摘要不变。检查范围包含整个前端执行链（包括脚本、配置和依赖锁）、引擎与共享契约；构建及回归前后均检查源码洁净，并拒绝覆盖运行期间变化的正式证明。覆盖未声明、摘要过期或有缺口时脚本拒绝刷新，并列出缺少的机制。

`admitted-coverage.json` 的对象键为`<kind>:<key>`，每项保存与正式证明相同的`contentDigest`、`externalDigest`、非空唯一`mechanisms`及中文核对依据`rationale`。对象范围以当前JSON声明为准，不能用空泛标签宣称支持新对象。

`npm run check:mechanism-coverage`只检查依赖，不运行回归、不写证明，也不证明构建一致。当前源码与分发Wasm的构建一致性由`npm run check:wasm-build`单独核对；`npm test`包含机制回归、刷新及构建比较门槛测试。新对象首次准入仍需按其真实配置单独验收；回归阶段只依赖这里的机制用例。

真实命中有限减疗的强度与期限仅接固定值或本技能静态参数；法盾空粒度须有同次更早的稳定全技能伤害候选与明确未挡条件。六个固定场景保留背景普攻及目标真实受伤治疗，逐笔恢复与完整末态共同核对，见[共享契约](../../../contracts/authoring/真实命中有限减疗共享契约.md)。补充初始通用法盾测试只证明判盾与有限效果门控；它保留法盾实例，不声称消费或管理作者初始化能力。

`permanent_character_periodic_*`五例保留真实来源初始化，核对500毫秒首跳及间隔、生命上限读取、两跳间法强变化、无后台普攻的真实主动并行、目标侧周期以及关闭和未学。不把这些合成场景作为阿木木完整P/W或英雄准入。
