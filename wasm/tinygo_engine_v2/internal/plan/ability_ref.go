package plan

import "strings"

// ParsedAbilityRef 是解析后的 abilityRef 组件。
type ParsedAbilityRef struct {
	Combatant   string
	ProviderRef string
	AbilityKey  string
}

// ParseAbilityRef 解析 canonical abilityRef 字符串。
func ParseAbilityRef(ref string) (ParsedAbilityRef, bool) {
	separator := strings.IndexByte(ref, '.')
	if separator < 0 {
		return ParsedAbilityRef{}, false
	}
	combatant := ref[:separator]
	switch combatant {
	case "source", "target", "self", "opponent":
	default:
		return ParsedAbilityRef{}, false
	}
	const providerPrefix = ".provider["
	if !strings.HasPrefix(ref[separator:], providerPrefix) {
		return ParsedAbilityRef{}, false
	}
	providerAndAbility := ref[separator+len(providerPrefix):]
	providerEnd := strings.IndexByte(providerAndAbility, ']')
	if providerEnd <= 0 {
		return ParsedAbilityRef{}, false
	}
	const abilityPrefix = "].ability["
	if !strings.HasPrefix(providerAndAbility[providerEnd:], abilityPrefix) {
		return ParsedAbilityRef{}, false
	}
	abilityAndEnd := providerAndAbility[providerEnd+len(abilityPrefix):]
	abilityEnd := strings.IndexByte(abilityAndEnd, ']')
	if abilityEnd <= 0 || abilityEnd != len(abilityAndEnd)-1 {
		return ParsedAbilityRef{}, false
	}
	return ParsedAbilityRef{
		Combatant:   combatant,
		ProviderRef: providerAndAbility[:providerEnd],
		AbilityKey:  abilityAndEnd[:abilityEnd],
	}, true
}
