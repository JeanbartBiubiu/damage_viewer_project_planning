package execution

import (
	model "tinygo_engine_v2/internal/model"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

const (
	spellbladeReadyKey      = "spellblade_ready"
	spellbladeICDKey        = "spellblade_icd"
	spellbladeProviderRef   = "item:trinity_spellblade"
	spellbladeChampionRef   = "champion:source_demo"
	spellbladeTumbleKey     = "tumble"
	spellbladeHitAbilityKey = "basic_attack_hit"
	spellbladeCastEvent     = "event/ability_started"
	spellbladeHitEvent      = "event/basic_attack_hit"
	spellbladeDamageOpRef   = "op:spellblade_damage"
	spellbladeADBase        = 60.0
	spellbladeAADamage      = 10.0
	spellbladeReadyDuration = 10000
	spellbladeICDDuration   = 1500
)

func ensureSpellbladeTypes(req *model.CompileRequest) {
	formuladefinition.DeclareAttributes(req, "armor")
	formuladefinition.SetDamageFormula(req, "damage/physical", formuladefinition.ResistanceDefense("armor"))

	formuladefinition.DeclareAttributes(req, "magic_resist")
	formuladefinition.SetDamageFormula(req, "damage/magic", formuladefinition.ResistanceDefense("magic_resist"))

	need := []model.TypeCatalogEntry{
		{Key: spellbladeCastEvent, Domain: "event"},
		{Key: spellbladeHitEvent, Domain: "event"},
		{Key: "event/source_owner", Domain: "event"},
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "damage/physical", Domain: "damage"},
		{Key: "damage/magic", Domain: "damage"},
	}
	have := map[string]bool{}
	for _, t := range req.TypeCatalog.Types {
		have[t.Key] = true
	}
	for _, t := range need {
		if !have[t.Key] {
			req.TypeCatalog.Types = append(req.TypeCatalog.Types, t)
		}
	}
}
