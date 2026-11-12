# 离线计算与对照

`scripts/verify-damage.mjs` 使用 Node.js 20 内置模块，不导入业务公式或结算实现。它只执行显式算术并对照指定原始结果字段，不生成游戏规则、不调用接口或 Wasm，也不证明原始文件来自真实执行。配置与产物身份、运行完成和覆盖范围继续由技能正文核对。

## 先计算并冻结期望

在本次 `output/` 子目录创建计划，写明来源、取舍和场景。以下是合成口径示例：每笔金额 `60 + 0.5 × 攻击力`，无防御和其他修正，目标生命80、护盾40，先结算一笔；这些字段仅示意，对真实输出使用其实际字段路径。

```json
{
  "basis": "已核定资料路径与修订；本例为合成口径演示，无防御和其他修正",
  "cases": [{
    "id": "normal",
    "inputs": { "attack": 80, "hp": 80, "shield": 40 },
    "steps": [
      { "name": "damage", "expression": "60 + 0.5 * attack" },
      { "name": "absorbed", "expression": "min(shield, damage)" },
      { "name": "loss", "expression": "min(hp, max(0, damage - absorbed))" }
    ],
    "checks": [
      { "pointer": "/complete", "value": true },
      { "pointer": "/records", "measure": "length", "expression": "1" },
      { "pointer": "/records/0/timeMs", "expression": "250" },
      { "pointer": "/records/0/source", "value": "skill-example" },
      { "pointer": "/records/0/postDefenseDamage", "expression": "damage", "comparison": "amount" },
      { "pointer": "/records/0/shieldAbsorbed", "expression": "absorbed", "comparison": "amount" },
      { "pointer": "/records/0/actualHpLoss", "expression": "loss", "comparison": "amount" },
      { "pointer": "/remainingHp", "expression": "hp - loss", "comparison": "amount" }
    ]
  }]
}
```

计划字段含义：`basis` 是规则依据；`cases` 是场景；`inputs` 是有限数值变量；`steps` 按顺序计算，后项可引用前项；`checks` 声明对照项。每项只提供 `expression`（算式）或 `value`（独立固定值）之一。期望文件保存完整计划、分步值、计算工具及原计划的 SHA-256 摘要。

算式支持十进制／科学记数、变量、括号、`+ - * / % **`，以及 `min`、`max`、`abs`、`floor`、`ceil`、`round`、`pow`。变量使用字母、数字、下划线且不能以数字开头；不支持属性访问、比较、条件或任意代码，未知变量、除零和非有限结果立即失败。复杂条件或状态演进先用独立脚本明确实现，不能省略相应验证。

`pointer` 使用 JSON Pointer（从 JSON 根开始的字段路径）：数组下标从0开始，键中的 `/` 写为 `~1`，`~` 写为 `~0`。`measure: "length"` 读取数组长度；默认读取字段值。默认精确比较，金额显式使用 `comparison: "amount"`，容差取技能正文定义，计划不能自行调大。

## 运行之后对照原始结果

期望计算完成后运行真实被测链路，保存各场景完整原始 JSON。结果清单只引用这些文件，文件路径相对清单位置：

```json
{ "cases": [{ "id": "normal", "file": "normal.wasm.json" }] }
```

在仓库根目录执行，尖括号代表本次真实路径：

```powershell
node .agents/skills/skill-damage-verification/scripts/verify-damage.mjs calculate --plan <计划.json> --output <新期望.json>
# 现在运行真实配置经生产适配和正式 Wasm 的场景，再写结果清单。
node .agents/skills/skill-damage-verification/scripts/verify-damage.mjs compare --expected <期望.json> --actual <结果清单.json> --output <新报告.json>
```

比较时重新计算原计划，拒绝手改期望结果；读取原始文件并记录摘要。遗漏场景、字段或原始文件，实际值为空，数组长度错误、时刻／身份不符或金额超差，都会失败。它只检查计划声明的字段，调用者仍须覆盖逐笔次数、来源、时间、必要状态及完整性，不能只放一个总额检查。

不同内容不能覆盖已有输出，请用新的文件名保存重算或复验；父目录须先存在。正常一致退出码为0，字段差异或执行错误为1。字段差异会写入逐项报告；读取、格式等错误直接失败。该工具可用的证据仅是“这些已声明字段符合独立计划”，不自动给角色准入。

工具修改后的针对性检查：

```powershell
node --test .agents/skills/skill-damage-verification/scripts/verify-damage.test.mjs
```
