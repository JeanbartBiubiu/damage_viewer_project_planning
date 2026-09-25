package model

// FormulaPathDamageSelf 仅在已知本笔伤害双方时读取；同一对象为1，否则为0。
// 不推定类别或敌我关系，缺少伤害参与者上下文必须报错。
const FormulaPathDamageSelf = "damage.self"
