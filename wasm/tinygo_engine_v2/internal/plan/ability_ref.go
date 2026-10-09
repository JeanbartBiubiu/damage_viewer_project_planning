package plan

import "regexp"

var abilityRefPattern = regexp.MustCompile(`^(source|target|self|opponent)\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$`)

// ParsedAbilityRef 是解析后的 abilityRef 组件。
type ParsedAbilityRef struct {
	Combatant   string
	ProviderRef string
	AbilityKey  string
}

// ParseAbilityRef 解析 canonical abilityRef 字符串。
func ParseAbilityRef(ref string) (ParsedAbilityRef, bool) {
	matches := abilityRefPattern.FindStringSubmatch(ref)
	if len(matches) != 4 {
		return ParsedAbilityRef{}, false
	}
	return ParsedAbilityRef{
		Combatant:   matches[1],
		ProviderRef: matches[2],
		AbilityKey:  matches[3],
	}, true
}
