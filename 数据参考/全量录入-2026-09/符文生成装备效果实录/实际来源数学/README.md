# 四件符文衍生装备实际来源数学复核

独立来源数学脚本只读取已经完成的独立 GET 报告、同目录最终 GET 快照、四装备固定来源和饼干当前具名来源补证，不调用业务接口、数据库、浏览器或 Git。它不导入候选数学脚本，也不改候选、执行器或 GET 报告。

固定来源：

- 四装备固定来源：SHA d8f769c5c407406bd38d1154115334403e92141001b5c5a39e2b049c45e3f92f
- 饼干当前具名来源补证：SHA b7ecdc756cdc1e00b4b2b5ffb8a4a5e879d0d176599575724714b255b6c41b66
- 实际 GET 报告：SHA 8a02524d8ca96482eb85c1078e55561fdfeb6da8c8241fbf039ca5b27c30bc37
- 实际 GET 快照：SHA f80324d082711f4172fbe5382dcc3559085dd072a4bb6c90f169833b7abcbc2c

## 运行

~~~powershell
$node = 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
& $node 'C:/project/damage_web_dev/.agents/artifacts/rune-equipment-ownership-actual-math/独立来源数学.mjs' --validate-only
& $node 'C:/project/damage_web_dev/.agents/artifacts/rune-equipment-ownership-actual-math/独立来源数学.mjs' --report 'C:/project/damage_web_dev/.agents/artifacts/rune-equipment-ownership-execution/独立GET核对/2026-09-10T05-49-54-307Z/GET复核报告.json'
~~~

报告参数必须指向通过的独立 GET 报告；脚本从报告同目录读取最终 GET 快照，并按字节核对两份实际证据的固定散列。输出位于本目录的 报告/时间/。

## 核对范围

脚本从实际 GET 快照读取 12 个参数、3 个公式和 2 个效果，再从固定来源独立得到期望值：

- 饼干恢复基数使用 20 + 0.015 × SOURCE.hp.TOTAL；5 秒窗口为 5000 毫秒。总量场景分别覆盖无提升和超过 100% 上限的输入。
- 已损生命提升和实际消费或出售数均为无默认的运行输入；缺少输入时必须拒绝求值。
- 永久最大生命使用 30 × 实际消费或出售数；1、2、3、3 的自贡献依次为 30、60、90、90，生命周期使用应用快照、共享值和替换重施，避免重复累加。
- 技能合剂的 1 是技能点数，不转成角色等级；原力合剂为 25 适应之力和 60000 毫秒，不猜测攻击力或法术强度方向。
- 有点神奇之鞋保留主体 25 移动速度，效果附加 10 点，最终点数为 35；属性使用 move_speed 与 attribute_flat_add，不当作比例属性。

每个公式至少有两个独立数值场景，并检查公式节点、参数引用、二元运算、有限数值、整数毫秒、效果固定倍率和属性单位。报告只证明来源数学和实时 GET 快照的一致性，不宣称运行时或浏览器已经执行。
