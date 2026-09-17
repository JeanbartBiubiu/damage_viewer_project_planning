import fs from 'node:fs';
import assert from 'node:assert/strict';
const here = new URL('./', import.meta.url);
const read = name => JSON.parse(fs.readFileSync(new URL(name, here), 'utf8'));
const plan = read('接口候选.json'), proof = read('独立最终回读.json'), writes = read('写入执行记录.json'), math = read('独立手算证据.json');
assert.equal(proof.summary.failedCheckCount + proof.summary.mismatchCount, 0);
assert.equal(writes.summary.verifiedWriteCount, 61);
assert.equal(math.summary.mismatchCount, 0);
assert.equal(read('页面验收.json').passed, true);
const history = new URL('准备阶段报告/', here);
fs.mkdirSync(history, { recursive: true });
for (const name of ['README.md','实际体验报告.md']) {
  const archive = new URL(name, history);
  if (!fs.existsSync(archive)) fs.copyFileSync(new URL(name, here), archive);
}
const lines = [
  '# 第九批装备技能实录', '',
  '六件装备已实际保存61组成：6技能、27参数、8公式、6效果、2规则、6装备挂载和6技能代表图。每次写入均独立GET，随后115项753字段独立检查零失败、零差异，39项手算通过。主负责人真实页面核对翠绿屏障消费与规则、海妖角色等级参数；未执行战斗或Wasm。', '',
  '| 装备 | 参数 | 公式 | 效果 | 规则 |', '| --- | ---: | ---: | ---: | ---: |',
  ...plan.objects.map(o => `| ${o.equipmentName} ${o.equipmentKey} | ${o.apiPayload.parameters.length} | ${o.apiPayload.formulas.length} | ${o.apiPayload.effects.length} | ${o.apiPayload.triggerRules.length} |`), '',
  '客户端16.17和官方16.17.1继续冻结。属性映射补证.json保存同源心之钢最大生命、峡谷制造者额外生命的字段与当前绑定文字：无终恨意伤害按额外生命3%，败魔普通魔法护盾按最大生命15%；守护天使分别保留基础生命50%与最大法力100%的恢复量公式。恢复时序另配。', '',
  '海妖用角色等级参数准确保存1至18级断点，前8级150、9级155、18级200。两伤害效果不带错误的计数生命周期。翠绿屏障已保存初始化授予、成功阻挡后的显式消费；60秒重获和受伤重置另配。', '',
  '尚未配置的范围内组成：', '',
  ...plan.objects.flatMap(o => (o.omittedComponents ?? []).filter(x => !x.reason.includes('替代')).map(x => `- ${o.equipmentName}：${x.key}；${x.reason}`)), '',
  '海妖原有三个断点标量已由完整逐级参数替代，不是遗漏或待补录。', '',
  '各对象完整待配信息还保留在接口候选.json中，不能把61个已存组成当成六件完整装备机制。装备主体、直接属性和原代表图已对照写前快照保持一致。', '',
  '录入装备技能.mjs默认只读，--apply只补缺：同值跳过、不同值保留并停止该对象，不覆盖或删除。独立最终回读.mjs重新GET全部组成键集合、详情、关系和原装备数据。当前业务载荷与写入时接口候选.json相同；早期概念候选及准备报告保留为历史，不是当前写入入口。', '',
  'Luna Max完成来源和候选；独立代理核对来源与接口，执行代理修正载荷并完成61次写入，主负责人接手限流后的报告和页面验收。不将工具限流记作产品故障。', '',
];
fs.writeFileSync(new URL('README.md', here), lines.join('\n'));
fs.writeFileSync(new URL('实际体验报告.md', here), [
  '# 第九批配置体验与处置', '',
  '本轮暴露的主要问题是录入候选的字段完整性和资料映射：三个效果漏resultType；有生命周期却未声明结果行为；角色等级断点被误当不可表达；属性枚举未充分利用同版本当前绑定旁证。写入前均已纠正，海妖与心之钢独立伤害不附计数时长，恢复量公式与复杂复活时序分开保存。', '',
  '翠绿屏障复用已验收的法术护盾初始化、成功消费契约，两个效果两条规则实际保存；没有把恢复计时缺口扩大成全部内容不可录。代表页面正确显示自身消费、成功事件具体护盾引用以及角色等级表。', '',
  '保存和逐写回读61次；独立115检查753字段、39项手算通过，6件装备原有主体、属性、代表图不变。当前候选仍列出范围内待配，详见README和接口候选；既无完整战斗结算，也未运行无关全量回归。', '',
].join('\n'));
console.log(JSON.stringify({ reported: true, components: 61, checks: proof.summary.checkCount }));
