// 本文件定义模式强化/海克斯开关骨架，用于在 run 级别启用全局规则改写策略。
package augment

type Toggle string

const (
	ToggleFixedAttackSpeed Toggle = "fixed_attack_speed"
	ToggleOverflowToAD     Toggle = "overflow_to_ad"
	ToggleSpellCanCrit     Toggle = "spell_can_crit"
	ToggleDotCanCrit       Toggle = "dot_can_crit"
)

type Definition struct {
	ID      string
	Toggles []Toggle
}

type ActiveSet struct {
	Toggles map[Toggle]bool
}

func NewActiveSet(defs []Definition) ActiveSet {
	set := ActiveSet{Toggles: make(map[Toggle]bool)}
	for _, def := range defs {
		for _, toggle := range def.Toggles {
			set.Toggles[toggle] = true
		}
	}
	return set
}

func (s ActiveSet) Enabled(toggle Toggle) bool {
	return s.Toggles[toggle]
}
