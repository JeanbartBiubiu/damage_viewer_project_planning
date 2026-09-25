import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = 'C:/project/damage_backend_dev/db/game_manage/schema.sql';
const sql = fs.readFileSync(source, 'utf8');
function splitFields(body) {
  const result = []; let start = 0, depth = 0, quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "'") { if (quoted && body[i + 1] === "'") { i++; continue; } quoted = !quoted; }
    if (quoted) continue;
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { result.push(body.slice(start, i).trim()); start = i + 1; }
  }
  result.push(body.slice(start).trim()); return result;
}
const names = {
  games: '游戏范围', attributes: '公共属性目录', game_vamp_rules: '游戏通用吸血规则', game_level_configs: '角色等级范围',
  characters: '角色主体', character_attributes: '角色等级属性', equipment: '装备主体', equipment_attributes: '装备直接属性',
  skill_categories: '技能分类目录', skills: '技能主体', skill_category_relations: '技能分类关系', skill_parameters: '技能参数',
  skill_formulas: '技能公式', damage_types: '伤害类型目录', modifier_zones: '修正乘区目录', statuses: '战斗状态目录',
  skill_effects: '技能效果', skill_internal_states: '技能内部状态', skill_processes: '技能过程', skill_trigger_rules: '技能触发规则',
  images: '代表图片资源', character_skill_relations: '角色挂载技能', equipment_skill_relations: '装备挂载技能',
  image_relations: '对象与代表图片关系', skill_object_references: '系统生成的技能引用索引', runes: '符文主体',
  rune_paths: '符文系与碎片组布局', rune_skill_relations: '符文挂载技能'
};
const common = {
  game_id: '所属游戏及隔离范围；所有同游戏引用以此为边界。',
  name: '供作者识别的显示名称，不代替稳定标识或执行逻辑。',
  description: '人工说明；不作为条件、公式或执行规则。',
  status: 'ENABLED＝启用；DISABLED＝停用。不是删除，也不是战斗中的生效标记。',
  sort_order: '非负排序值；普通目录用于显示顺序，不应自行解释为伤害或事件优先级。',
  created_at: '创建时间；数据库默认写入当前时间。',
  updated_at: '最后修改时间；管理更新语句写入 now()，不是此DDL声明的自动更新触发器。',
  character_key: '同游戏角色稳定标识；在挂载表中指向技能拥有者，在角色属性表中指向属性拥有者。',
  equipment_key: '同游戏装备稳定标识；挂载的技能独立保存，可与其他主体共享。',
  rune_key: '同游戏符文稳定标识；符文效果通过技能挂载表达。',
  skill_key: '同游戏技能稳定标识；在技能组成表中表示该组成所属技能。',
  skill_category_key: '分类目录标识；属于数据引用，不是写死的主动/被动等枚举。',
  attribute_key: '属性目录稳定标识；实际属性的语义由目录及消费方约定，不从名称自动推断。',
  value_type: 'INTEGER＝整数；DECIMAL＝可带小数的数值。整数语义由后端校验，不等于SQL numeric自动限制整数。',
  min_value: '属性允许的下界；NULL表示未配置下界。不是当前生命值或额外属性值。',
  max_value: '属性允许的上界；NULL表示未配置上界。不能据此单独推断战斗中的最大生命值。',
  min_level: '角色等级下界，至少1；用于完整角色等级图和按角色等级参数。',
  max_level: '等级上界；具体适用技能等级或角色等级见本表约束。',
  value_mode: 'FIXED＝固定值；SKILL_LEVEL＝按技能等级；CHARACTER_LEVEL＝按角色等级；RUNTIME_INPUT＝计算时由执行入口供值。',
  fixed_value: 'FIXED模式的数值；其他取值模式必须NULL。数值用途决定是否允许负数、零或小数。',
  level_values: '以等级字符串为键的JSON对象；具体值结构见本表说明。',
  parameter_key: '同技能参数稳定标识；固定值、等级图或计算时输入均通过它被引用。',
  formula_key: '同技能公式稳定标识；结果、过程等引用此键求值。',
  expression: '公式表达式树JSON；节点字段、运算枚举与属性取值口径见“数值与公式”章。',
  damage_type_key: '同游戏伤害类型目录标识，不是数据库内置的物理/魔法/真实枚举。',
  modifier_zone_key: '修正乘区稳定标识；用于指明哪些修正属于同组及在哪个阶段合并。',
  domain: 'ATTRIBUTE＝属性；DAMAGE＝伤害；HEALING＝治疗；SHIELD＝收到护盾。',
  calculation_mode: 'FLAT_ADD＝固定值加算；RATIO_ADD＝比例加算；RATIO_MAX＝比例取最大。组合限制见本表。',
  application_stage: 'ATTRIBUTE_FLAT＝属性固定段；ATTRIBUTE_PERCENT＝属性比例段；DAMAGE_PRE_DEFENSE＝防御前伤害；DAMAGE_POST_DEFENSE＝防御后伤害；HEALING_RESULT＝治疗结果；SHIELD_RESULT＝收到护盾结果。',
  status_key: '战斗状态稳定标识；效果引用它施加/移除状态，持续时间不在目录里。',
  status_kind: 'STUN＝眩晕；MOVEMENT_SLOW＝普通移动减速；ROOT＝禁锢；SILENCE＝沉默；CHARM＝魅惑；AIRBORNE＝击飞。表示行为身份，不等于本次已验证所有运行行为。',
  effect_key: '同技能效果稳定标识；效果是结果和可选生命周期的保存单元。',
  results: '有序结果JSON数组；包含结果身份、对象、数值规则、类型明细及生命周期行为。见效果章。',
  lifecycle: '效果生命周期JSON；NULL表示没有父生命周期，非NULL描述实例范围、期限、层数、重施与周期。',
  state_key: '同技能内部状态稳定标识；与公共战斗状态 status_key 不同。',
  state_type: 'COUNTER＝计数；AMMO＝弹药；MODE＝模式；FLAG＝准备标记；INTERNAL_COOLDOWN＝内部冷却。',
  scope: 'SKILL＝技能范围；TARGET＝按目标分别保存。当前只有计数可选择TARGET。',
  detail: '随内部状态种类变化的JSON明细，五种结构详见过程与内部状态章。',
  process_key: '同技能过程稳定标识；过程拥有步骤、普通冷却和时点挂接。',
  activation_type: 'ACTIVE＝主动；PASSIVE＝被动；CONSUMABLE＝消耗能力。它是过程使用方式，不代替技能分类。',
  steps: '有序过程步骤JSON数组；立即、延迟、多段、周期、引导、蓄力、重施、强化普攻八类。',
  cooldown: '可空普通冷却JSON；保存时长取值和起算时点，不是当前剩余冷却。',
  effect_bindings: '过程时点→效果的有序挂接JSON数组；对应接口 effectBindings。',
  state_operations: '过程时点→内部状态操作的有序JSON数组；对应接口 stateOperations。',
  rule_key: '同技能触发规则稳定标识；被引用动作属于此规则。',
  event_type: '事件种类检索列，来自event_source中的eventType；完整23类及各自detail见触发章，不能与JSON种类不一致。',
  event_source: '事件来源JSON：eventType加该事件专有detail。不是“事件发生次数”的运行记录。',
  condition_groups: '条件组JSON数组；组内与、组间或，具体空数组与字段能力约束见触发章。',
  actions: '触发后执行的有序动作JSON数组，含目标上下文、动态供值和结果修正。',
  limits: '触发限制JSON；内含perTargetCooldown、maxTriggersPerProcess、oncePerUse。接口将三项放在规则顶层。',
  image_key: '同游戏图片稳定标识；允许字母、数字、点、下划线和短横线，长度不超过128。',
  image_base64: 'PNG/JPEG图片数据地址；期待用于展示，不参与伤害计算。本字典不读取任何图片内容。',
  mime_type: 'image/png或image/jpeg；管理服务根据图片内容识别。',
  byte_size: '解码后字节数，1～262144（256KiB）。',
  width: '图片像素宽度，1～64。',
  height: '图片像素高度，1～64。',
  enabled: '图片是否启用；布尔值true/false，默认true。',
  source_parent_key: '图片来源为SKILL_EFFECT时填写所属技能键；其他来源必须是空字符串。',
  source_skill_key: '引用索引中发起引用的技能键；不是运行时施法者身份。',
  field_path: '引用出现的位置，例 results[0].valueRule.value.parameterKey；用于反查和错误定位。',
  target_skill_key: '目标属于技能组成时填写所属技能键；公共目录等目标使用空字符串，不能NULL。',
  target_key: '被引用对象的稳定标识，必须非空。',
  target_sub_key: '被引用子项的键，如结果、模式选项、步骤、动作；引用根对象时为空字符串，不能NULL。',
  vamp_type: 'LIFE_STEAL＝生命偷取；OMNIVAMP＝全能吸血；PHYSICAL_VAMP＝物理吸血；SPELL_VAMP＝法术吸血。',
  source_attribute_key: '吸血比例来源属性；同游戏真实属性外键，后端要求DECIMAL。不会因为属性名字像吸血而自动选取。',
  basis_output_kind: 'POST_DEFENSE_DAMAGE＝防御后、护盾吸收前伤害；ACTUAL_HP_LOSS＝实际扣除生命。',
  default_efficiency: '非负有限效率倍率，1为100%；与来源对象吸血比例共同决定治疗，不是吸血比例本身。',
  delivery_kinds: '非空去重数组：SKILL＝技能伤害；BASIC_ATTACK＝普通攻击伤害。',
  origin_kinds: '非空去重数组：DIRECT＝直接伤害；REFLECTED＝反射伤害。',
  skill_category_keys: '同游戏分类键的非空去重数组，任一分类匹配；与产生方式和来源性质两个筛选维度同时满足。',
  category: 'KEYSTONE＝基石符文；MINOR＝普通符文；SHARD＝属性碎片。',
  path_key: '符文系或碎片组的稳定标识。',
  kind: 'RUNE_PATH＝普通符文系；SHARD_GROUP＝属性碎片组。',
  slots: '有序槽位JSON数组，每项name、category、runeKeys；布局唯一来源，不保存玩家本次选择。',
  attribute_values: '属性键→数值的JSON对象，表示装备直接属性；主动/被动效果另由技能表达。',
  game_name: '游戏显示名称。'
};
const overrides = {
  'characters.character_key': '同游戏角色稳定标识；不在此表重复保存技能配置。',
  'equipment.equipment_key': '同游戏装备稳定标识；主动/被动通过技能挂载。',
  'runes.rune_key': '符文或属性碎片的身份键；不记录玩家选择。',
  'skills.skill_key': '同游戏技能稳定标识；角色、装备、符文通过关系表挂载，技能本体不持有所属角色键。',
  'skills.max_level': '技能最大等级，数据库及创建请求均要求至少1；本字段没有写死为5，也不能套用角色等级上限100。',
  'game_level_configs.max_level': '角色等级上界，要求min_level≤max_level≤100；与技能max_level是不同范围。',
  'skill_parameters.level_values': '等级字符串→数值。SKILL_LEVEL覆盖1～技能max_level；CHARACTER_LEVEL覆盖游戏min_level～max_level，不得缺项或多项。',
  'character_attributes.level_values': '等级字符串→{属性键:数值}的完整角色自然成长图；不包含技能/装备/临时效果的运行后结果。',
  'skill_trigger_rules.sort_order': '规则非负顺序，最大999999；用于稳定规则排列，具体同事件执行及条件取样需按触发契约，不等同于任意全局优先级。',
  'image_relations.source_type': 'GAME游戏、CHARACTER角色、ATTRIBUTE属性、EQUIPMENT装备、SKILL技能、SKILL_EFFECT技能效果、STATUS状态、RUNE符文、RUNE_PATH符文系。',
  'image_relations.source_key': '图片来源对象键；GAME来源必须等于game_id，SKILL_EFFECT来源为效果键。',
  'skill_object_references.source_type': 'FORMULA公式、EFFECT效果、STATE内部状态、PROCESS过程、TRIGGER触发规则。由系统提取。',
  'skill_object_references.source_key': '发起引用的根对象键；由source_type解释，始终与source_skill_key一起定位。',
  'skill_object_references.target_type': 'ATTRIBUTE属性、PARAMETER参数、FORMULA公式、SKILL技能、CATEGORY分类、DAMAGE_TYPE伤害类型、MODIFIER_ZONE乘区、STATUS状态、EFFECT效果、RESULT结果、LIFECYCLE生命周期、STATE内部状态、OPTION模式选项、PROCESS过程、STEP步骤、ACTION动作。'
};
const notes = {
  games: 'game_id为主键，允许小写字母、数字、下划线；与其他对象键不同，它可由数字开头。created_at是可空timestamp，其余多数表审计列是非空timestamptz。',
  attributes: '同游戏名称按去空格、忽略大小写唯一；min/max同时存在时min≤max。值类型、状态、排序由DB直接约束。属性没有独立单位列。',
  game_vamp_rules: '以(game_id,vamp_type)唯一；效率必须有限且≥0；三个集合非空。产生方式/来源集合的合法值由DB检查，集合去重、分类存在性及DECIMAL比例属性由后端补充。',
  game_level_configs: '每游戏一条；1≤min_level≤max_level≤100。调整范围会影响按角色等级参数与角色等级属性完整图。',
  characters: '名称同游戏忽略大小写唯一；角色属性、技能挂载及图片另表保存。',
  character_attributes: '每角色一行；DB只检查level_values是对象，等级和属性完整性、数值类型/边界由后端校验；删除角色级联删除本行。',
  equipment: '名称同游戏忽略大小写唯一；直接属性和技能挂载不在本表。',
  equipment_attributes: '每装备一行；DB检查attribute_values为对象。属性存在性、启停引用、数值类型与边界由后端处理；删除装备级联删除。',
  skill_categories: '同游戏名称忽略大小写唯一。分类键是可管理数据，不是固定枚举；多个分类可共同属于一个技能。',
  skills: '主键(game_id,skill_key)；name非空，max_level≥1，状态为ENABLED/DISABLED。DDL未对技能名称建立唯一索引；不能把名称当身份键。',
  skill_category_relations: '复合主键同时去重；删除技能级联清分类关系；被引用分类的删除受RESTRICT保护。本表没有排序列。',
  skill_parameters: 'FIXED：fixed_value必填且level_values=NULL；两种等级模式反之；RUNTIME_INPUT：二者均NULL。DB只检查形状，整数及完整等级图由后端校验。参数数值没有通用非负约束，具体引用用途另限。',
  skill_formulas: 'expression必须JSON对象；节点类型、二元运算、引用、深度32/节点256限制由后端检查。公式列表摘要不带完整表达式，读取详情才有完整树。',
  damage_types: '名称同游戏忽略大小写唯一。伤害类型键是目录数据，不是固定SQL枚举；当前游戏使用哪些键不由此DDL预置。',
  modifier_zones: '合法三元组：ATTRIBUTE/FLAT_ADD/ATTRIBUTE_FLAT；ATTRIBUTE/RATIO_ADD/ATTRIBUTE_PERCENT；DAMAGE/RATIO_ADD/防御前或防御后；HEALING/RATIO_ADD或RATIO_MAX/HEALING_RESULT；SHIELD/RATIO_ADD/SHIELD_RESULT。当前后端将RATIO_MAX引用限制为“受到治疗＋降低”。',
  statuses: 'status_kind六选一，管理接口创建后不可改；名称同游戏忽略大小写唯一。目录不保存持续时间、强度或层数，它们属于效果配置。',
  skill_effects: 'DB只约束results数组、lifecycle对象或NULL。后端允许“合法生命周期＋零结果”的标记；无生命周期又无结果不能保存。结果类型、字段组合、引用、周期和数值限制详见效果章。',
  skill_internal_states: 'state_type五选一；scope二选一；仅COUNTER允许TARGET。detail必须对象，各状态明细由后端按种类校验。',
  skill_processes: 'activation_type三选一；steps/effect_bindings/state_operations必须数组，cooldown对象或NULL。DB数组默认空不代表后端允许空过程；步骤数量、种类、时点和挂接限制详见过程章。',
  skill_trigger_rules: 'event_type为23类固定事件；JSON种类与检索列一致。规则名称≤100、说明≤1000、排序0～999999。事件/条件/动作/限制的具体合法组合详见触发章；DB形状CHECK本身不证明引用完整。',
  images: '按game_id列表分区；本字典只计逻辑父表，不计具体游戏分区。名字同游戏忽略大小写唯一；键、媒体类型、像素和字节数均有DB限制。',
  character_skill_relations: '同一角色不能重复挂同一技能；角色删除级联清挂载，技能删除受RESTRICT保护。没有Q/W/E/R槽位列，不应从sort_order单独推断槽位语义。',
  equipment_skill_relations: '同一装备不能重复挂同一技能；装备删除级联清挂载，技能删除受RESTRICT保护。',
  image_relations: '每个来源对象只对应一张代表图片；本表明确没有外键，由后端校验来源/图片存在并清理删除关联。不是技能战斗机制关系。',
  skill_object_references: '全部九列组成复合主键；来源技能删除级联清索引。目标不是逐类型SQL外键，由同游戏写事务读取完整聚合校验并重建；无独立手工编辑接口。',
  runes: '名称同游戏忽略大小写唯一，说明≤2000。category三选一；技能通过rune_skill_relations挂载。',
  rune_paths: '名称同游戏忽略大小写唯一，说明≤2000、sort_order≥0、slots数组；kind与槽位类别配对及符文存在性由后端校验。',
  rune_skill_relations: '同符文不能重复挂同一技能；符文删除只级联清挂载，技能删除受RESTRICT保护。'
};
const coreOrder = ['skills','skill_categories','skill_category_relations','skill_parameters','skill_formulas','skill_effects',
  'skill_processes','skill_internal_states','skill_trigger_rules','skill_object_references','character_skill_relations',
  'equipment_skill_relations','rune_skill_relations','attributes','damage_types','modifier_zones','statuses','game_vamp_rules',
  'game_level_configs','games','image_relations','images','characters','character_attributes','equipment','equipment_attributes','runes','rune_paths'];
const tables = [];
for (const match of sql.matchAll(/CREATE TABLE public\.(\w+) \(([\s\S]*?)\n\)(?: PARTITION BY LIST \(game_id\))?;/g)) {
  const [,name,body] = match; const parts = splitFields(body); const columns = [], constraints = [];
  for (const part of parts) {
    if (/^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK)\b/.test(part)) { constraints.push(part); continue; }
    const col = /^([a-z][a-z0-9_]*)\s+([\s\S]+)$/.exec(part); assert(col, part);
    const raw = col[2].replace(/\s+/g,' ');
    const type = raw.split(/\s+(?:NOT NULL|DEFAULT|PRIMARY KEY|REFERENCES|CHECK)\b/)[0];
    const description = overrides[`${name}.${col[1]}`] ?? common[col[1]]; assert(description, `${name}.${col[1]}`);
    columns.push({name:col[1],type,nullable:!/(NOT NULL|PRIMARY KEY)/.test(raw),default:raw.match(/\bDEFAULT\s+(.+)$/)?.[1]??null,description,definition:part});
  }
  const alterConstraints = [...sql.matchAll(new RegExp(`ALTER TABLE public\\.${name} ADD CONSTRAINT[\\s\\S]*?;`,'g'))].map(m=>m[0]);
  const indexes = [...sql.matchAll(/CREATE (?:UNIQUE )?INDEX\s+\w+\s+ON public\.(\w+)[\s\S]*?;/g)].filter(m=>m[1]===name).map(m=>m[0]);
  tables.push({name,title:names[name],sourceLine:sql.slice(0,match.index).split('\n').length,columns,constraints,alterConstraints,indexes,notes:notes[name]});
}
assert.equal(tables.length,28); assert.equal(coreOrder.length,tables.length);
const ordered = coreOrder.map(name=>{const t=tables.find(t=>t.name===name);assert(t);return t;});
const inventory={at:new Date().toISOString(),source,sha256:crypto.createHash('sha256').update(sql).digest('hex'),
  tableCount:ordered.length,columnCount:ordered.reduce((n,t)=>n+t.columns.length,0),tables:ordered};
fs.writeFileSync(path.join(here,'物理字段清单.json'),JSON.stringify(inventory,null,2)+'\n');
const lines=['## 物理表与列：完整索引','',
  '本节按当前建表脚本逐列列出。前13张是技能核心组成和挂载/引用关系；接下来是技能直接使用的目录；最后补充图片与角色/装备/符文容器，便于沿外键追踪，不将它们误认成技能子模块。',
  '',`共 ${inventory.tableCount} 张逻辑表、${inventory.columnCount} 个物理列。类型、空值和默认值来自DDL；JSON内字段在后续章节展开。完整CHECK/索引原文保存在同目录“物理字段清单.json”。`, '',
  '普通业务稳定键使用 `^[a-z][a-z0-9_]{0,63}$`；game_id和image_key的例外在对应表注明。字符串非空检查通常是去空格后不为空。启停、排序和说明均不能代替真实行为字段。',''];
for (const t of ordered) {
  lines.push(`### ${t.name} — ${t.title}`,'',`来源：[schema.sql:${t.sourceLine}](/C:/project/damage_backend_dev/db/game_manage/schema.sql:${t.sourceLine})。`, '',
    '| 物理字段 | SQL类型 | 可空 / 默认 | 作用与预期表达 |','| --- | --- | --- | --- |');
  for (const c of t.columns) lines.push(`| \`${t.name}.${c.name}\` | \`${c.type}\` | ${c.nullable?'可空':'非空'}；${c.default===null?'无默认值':`默认 \`${c.default}\``} | ${c.description} |`);
  lines.push('',`约束要点：${t.notes}`,'');
  for (const raw of t.constraints.filter(x=>/PRIMARY KEY|FOREIGN KEY/.test(x))) lines.push(`- \`${raw.replace(/\s+/g,' ')}\``);
  if(t.columns.some(c=>/PRIMARY KEY/.test(c.definition))) lines.push('- 内联主键：`game_id`。');
  for(const index of t.indexes.filter(x=>/^CREATE UNIQUE/.test(x))) lines.push(`- 唯一索引：\`${index.replace(/\s+/g,' ')}\``);
  lines.push('');
}
fs.writeFileSync(path.join(here,'分章/01-物理表字段.md'),lines.join('\n'));
console.log(JSON.stringify({tables:inventory.tableCount,columns:inventory.columnCount,sourceSha256:inventory.sha256}));
