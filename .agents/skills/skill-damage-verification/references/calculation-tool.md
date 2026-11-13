# 离线计算与对照

`scripts/verify-damage.mjs` 使用 Node.js 20 内置模块，执行给定算式或读取给定预期值，再对照指定 Wasm 结果字段。不导入被测公式或结算实现，不核查资料来源或版本。

## 准备预期

在本次 `output/` 子目录创建场景计划。已给预期值时直接写入 `value`；需要算术时使用 `inputs`、`steps` 和 `expression`。以下示例为每笔金额 `60 + 0.5 × 攻击力`，无防御和其他修正，目标生命80、护盾40，先结算一笔；字段路径按本次实际输出填写。

```json
{
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

计划字段含义：`cases` 是场景；`inputs` 是有限数值变量；`steps` 按顺序计算，后项可引用前项；`checks` 声明对照项。每项只提供 `expression`（算式）或 `value`（固定预期）之一。`basis` 可选，仅作算例说明，不要求资料信息。期望文件自动保存完整计划、分步值和文件摘要。

算式支持十进制／科学记数、变量、括号、`+ - * / % **`，以及 `min`、`max`、`abs`、`floor`、`ceil`、`round`、`pow`。变量使用字母、数字、下划线且不能以数字开头；不支持属性访问、比较、条件或任意代码，未知变量、除零和非有限结果立即失败。复杂条件或状态演进先用独立脚本明确实现，不能省略相应验证。

`pointer` 使用 JSON Pointer（从 JSON 根开始的字段路径）：数组下标从0开始，键中的 `/` 写为 `~1`，`~` 写为 `~0`。`measure: "length"` 读取数组长度；默认读取字段值。`measure: "exists"` 只接受精确比较与固定布尔 `value`：最终属性缺失为 `false`，存在且值为 `0` 或 `null` 仍为 `true`；中间父路径缺失或不是对象仍报错，空指针表示根存在。例如 `{"pointer":"/provider/targetState","measure":"exists","value":false}` 检查目标状态未实例化，要求 `provider` 真实存在；它不表示目标层数已按数值0验证。默认精确比较，金额显式使用 `comparison: "amount"`，容差取技能正文定义，计划不能自行调大。

## 运行之后对照原始结果

为每个场景指定对应的 Wasm 原始 JSON；已有结果直接使用，需要运行时再生成。文件路径相对结果清单位置：

```json
{ "cases": [{ "id": "normal", "file": "normal.wasm.json" }] }
```

在仓库根目录执行，尖括号代表本次真实路径：

```powershell
node .agents/skills/skill-damage-verification/scripts/verify-damage.mjs calculate --plan <计划.json> --output <新期望.json>
# 提供同一组输入的 Wasm 结果文件及清单；缺少结果时先运行。
node .agents/skills/skill-damage-verification/scripts/verify-damage.mjs compare --expected <期望.json> --actual <结果清单.json> --output <新报告.json>
```

比较时重新执行计划中的算式并保留固定预期；读取原始结果文件。遗漏场景、字段或文件，实际值为空，数组长度错误、时刻／标识不符或金额超差，都会失败。它只检查计划声明的字段；多段伤害应声明次数和逐笔字段，不能只放一个总额检查。

不同内容不能覆盖已有输出，请用新的文件名保存重算或复验；父目录须先存在。正常一致退出码为0，字段差异或执行错误为1。字段差异会写入预期、实际值和比较结果；读取、格式等错误直接失败。

工具修改后的针对性检查：

```powershell
node --test .agents/skills/skill-damage-verification/scripts/verify-damage.test.mjs
```
