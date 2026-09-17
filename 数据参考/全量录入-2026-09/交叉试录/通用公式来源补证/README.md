# 16.17 公式省略字段来源补证

本轮在 2026-09-09 约 02:16—02:30 UTC 完成有界只读调查。结果可以补齐具体类型的构造默认数值；属性含义另有同版本具名交叉证据，完整计算函数仍未取得。本目录没有业务请求、代码修改、服务操作或浏览器验收。

## 已确证的构造默认

主来源是 LeagueToolkit 提取器的 [16.17.8104348 原始类型记录](https://raw.githubusercontent.com/LeagueToolkit/lol-meta-classes/3284cf031cfcdfdd49cf371765522ed576b6f3fb/dumps/16.17.8104348.json)。构建号与冻结英雄客户端的 `16.17.8104348+branch.releases-16-17.content.release` 一致。固定提交为 `3284cf031cfcdfdd49cf371765522ed576b6f3fb`，原始记录 SHA256 为 `063932bad2bc800a44b0cb3929f6de31fbfcacd89d2f1add75b9c67cc7c7e167`。

| 具体类型 | 构造默认值 |
| --- | --- |
| StatByCoefficientCalculationPart、StatByNamedDataValueCalculationPart、StatBySubPartCalculationPart | mStat=0；mStatFormula=0；UseNewStats=false；statType=13；OutputType=0 |
| ByCharLevelBreakpointsCalculationPart | mLevel1Value=0；mInitialBonusPerLevel=0；mBreakpoints=[] |
| Breakpoint | mLevel=1；mBonusPerLevelAtAndAfter=0；mAdditionalBonusAtThisLevel=0 |

[提取器代码](https://github.com/LeagueToolkit/lol-meta-classes/blob/3284cf031cfcdfdd49cf371765522ed576b6f3fb/crates/dumper/src/meta_dump.rs#L452)创建客户端类实例后读取属性；同文件 281—299 行递归读取继承属性。[实例创建代码](https://github.com/LeagueToolkit/lol-meta-classes/blob/3284cf031cfcdfdd49cf371765522ed576b6f3fb/crates/dumper/src/meta.rs#L1151)调用该类构造函数。因此这些数值有明确的构造来源，并非从缺字段、常见技能常识或旧枚举猜测。

本轮读取的是公开提取产物和对应代码，未自行运行客户端二进制；没有取得完整反序列化器及求值函数。构造默认已证，与具体对象叠加后的读数是静态资料解释，不能当作客户端实战结果。

## 六处交叉核对

`六处交叉核对.json` 保存 Caitlyn P/R、Jhin W/R、装备 2503/3118 的根绑定、完整原对象、逐节点字段是否存在及构造默认。已重新核验英雄客户端压缩及原始哈希，并确认 15 个英雄技能对象、2 个装备根对象与冻结摘录完全相同。

- Caitlyn P、Jhin W/R 的攻击力节点显式 mStat=2，mStatFormula 省略。此次可补其构造数值为 0。Caitlyn Q 的 tADRatio 及 Jhin Q 的 ADRatio 均绑定 `Spell_ListType_TotalADRatio`，且相应节点同样为 mStat=2、mStatFormula 省略。这是总攻击力含义的同版本具名交叉支持，尚非属性分派函数的直接证明。
- Caitlyn R 显式 mStat=2、mStatFormula=2，根本不是省略字段。Draven R 同组合绑定 `Spell_ListType_BonusADRatio`，支持沿用额外攻击力；不可用本次默认 0 把 R 改成总攻击力。
- 装备 2503/3118 的 APRatio 节点省略 mStat/mStatFormula。根任务新冻结的电刑、血之滋味 APRatio 节点相同，AD 分支显式 2/2。它们支持默认 0 对应法强的窄映射；仍未取得当前属性分派实现，不把这一映射扩展成整张枚举表。
- Caitlyn P、Jhin P 的等级节点可明确补齐初始化数值。断点新斜率缺省的构造值为 0，不能把“缺省字段”直接写成“沿用旧字段值”。但计算函数是否另有累计/保留逻辑、断点级如何计入仍未证，故不凭构造表补完整等级曲线。

独立区分输入保存在 `结论与边界.json`：总 AD=200、额外 AD=100 可区分 Jhin W 的 100/50 攻击力项，以及 Caitlyn R 一级裸值 400/误值 500；AP=300、总 AD=200 可区分装备 2503 的约 6/4 加成。这些是供后续验证的数学判别例，不宣称运行了客户端。

## 插值和等级公式补充

`插值及等级公式默认补充.json` 只从已下载同构建原始记录取值：

- ByCharLevelInterpolationCalculationPart（0x15fecdbc）：mStartValue=0、mEndValue=0；0x7fe8e3b3=false；0xa331f6bf=true。后两个字段本轮没有可靠名称，保留哈希。
- ByCharLevelFormulaCalculationPart（0x2421b258）：0x246b0d8e 与 0x34474c3b 都是固定长度 31 的 F32 列表，初始每项 0。该结构不能证明数组索引对应哪个等级，也不能证明 1—18 线性插值。

## 仍缺的精确事实及后续入口

1. 同构建属性求值/渲染分派函数中，mStat0/2 与 mStatFormula0/2 如何读取属性，特别是 UseNewStats、OutputType 非默认分支。可据记录中的类哈希、构造地址继续定位同构建客户端函数；当前具名交叉不足以推整表。
2. ByCharLevelBreakpoints 的实际循环、断点当级计入和额外值顺序；插值节点的起止等级、布尔开关、取整及等级公式表索引。原始记录仅给结构及构造，不包含求值实现。
3. 缺省序列化字段在加载链中的完整行为。CDTB 的 `to_serializable()` 仅输出已有字段，不能自己证明省略值语义；构造记录补的是此前缺失的初始化证据。

旧 moonshadow565/calcrev 的枚举和未实现分支没有用于本轮结论。没有新增玩法资料下载或无限扩展搜索。

## 操作体验与复核

类型接口 `?inherited=1` 会展示继承字段，但继承字段未带默认值；具体类原始构造记录却包含这些默认值。只读接口页面会误判“没有默认来源”，应回原始具体类核对。另一个细节是字段哈希有时不补前导 0，比较时需要按整数规范化。

运行 `node 提取补证.mjs` 只读取冻结本地文件并重建本目录机器证据。它校验固定原始类型哈希、英雄及装备来源哈希、17 个原对象相等，输出六处核对。来源 URL、版本与字节哈希见 `来源与哈希.json`。既有业务数据和英雄第八批产物保持冻结。

## 基础攻击力具名补证

同一16.17装备原文中，773025当前绑定明确倍率参数乘基础攻击力，773078当前绑定明确200%基础攻击力，两者分别对应旧的具名系数节点和固定系数节点，均显式mStat=2、mStatFormula=1。另七个当前装备根的同形节点已交叉核对。独立44项检查通过，详见 `基础攻击力具名补证.json`、`基础攻击力补证报告.md` 与可复核脚本 `基础攻击力具名补证核对.mjs`。

本次采用的范围仅为这两类旧属性节点在既有同构建默认条件下读取施法者基础攻击力。不同模式对象只作为共享节点枚举的具名旁证，不录入它们或复制其装备数值；不扩展到生命12/0、属性29、资源节点或其他未证组合。当前仍是静态来源推断，后续业务回补需另存请求和实际回读，不修改历史候选。
