// DPS 通用纯函数与属性/被动 ID 辅助。
package runtime

import (
	"math"
	"strconv"
	"strings"
	"tinygo_engine_v2/internal/attribute"
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func applyEquipmentStatsToResolvedSnapshot(snapshot model.DPSResolvedSnapshotV2) model.DPSResolvedSnapshotV2 {
	if len(snapshot.EquipmentStats) == 0 {
		return snapshot
	}
	attrs := copyDPSFloatMap(snapshot.AttackerSnapshot.Attributes)
	views := copyDPSAttributeViews(snapshot.AttackerSnapshot.AttributeViews)
	for attrKey, value := range snapshot.EquipmentStats {
		attrKey = strings.TrimSpace(attrKey)
		if attrKey == "" {
			continue
		}
		attrs[attrKey] += value
		if view, ok := views[attrKey]; ok {
			view.Resolved += value
			view.Current += value
			view.Max += value
			views[attrKey] = view
		}
	}
	snapshot.AttackerSnapshot.Attributes = attrs
	if len(views) > 0 {
		snapshot.AttackerSnapshot.AttributeViews = views
	}
	return snapshot
}

func attackIntervalMs(effectiveAttackSpeed float64) int64 {
	if effectiveAttackSpeed <= 0 || math.IsNaN(effectiveAttackSpeed) || math.IsInf(effectiveAttackSpeed, 0) {
		return 0
	}
	interval := int64(math.Round(1000 / effectiveAttackSpeed))
	if interval < 1 {
		return 1
	}
	return interval
}

func enabledDPSPassives(curve model.DPSCurveRunSpecV2) []model.DPSPassiveEffectV2 {
	enabled := enabledPassiveIDSet(curve)
	passives := make([]model.DPSPassiveEffectV2, 0, len(enabled))
	for _, passive := range curve.ResolvedSnapshot.PassiveEffects {
		if passiveIsEnabled(passive, enabled) {
			passives = append(passives, passive)
		}
	}
	return passives
}

func enabledPassiveIDSet(curve model.DPSCurveRunSpecV2) map[string]bool {
	result := map[string]bool{}
	for _, id := range curve.Selection.EnabledPassiveEffects {
		id = strings.TrimSpace(id)
		if id != "" {
			result[id] = true
		}
	}
	for _, id := range curve.ResolvedSnapshot.EnabledPassiveEffects {
		id = strings.TrimSpace(id)
		if id != "" {
			result[id] = true
		}
	}
	for _, id := range curve.Selection.TargetEnabledPassiveEffects {
		id = strings.TrimSpace(id)
		if id != "" {
			result[id] = true
		}
	}
	for _, id := range curve.ResolvedSnapshot.TargetEnabledPassiveEffects {
		id = strings.TrimSpace(id)
		if id != "" {
			result[id] = true
		}
	}
	return result
}

func targetEnabledPassiveIDSet(curve model.DPSCurveRunSpecV2) map[string]bool {
	result := map[string]bool{}
	for _, id := range curve.Selection.TargetEnabledPassiveEffects {
		id = strings.TrimSpace(id)
		if id != "" {
			result[id] = true
		}
	}
	for _, id := range curve.ResolvedSnapshot.TargetEnabledPassiveEffects {
		id = strings.TrimSpace(id)
		if id != "" {
			result[id] = true
		}
	}
	return result
}

func passiveIsEnabled(passive model.DPSPassiveEffectV2, enabled map[string]bool) bool {
	for _, id := range passiveIDs(passive) {
		if enabled[id] {
			return true
		}
	}
	return false
}

func findPassiveByID(passives []model.DPSPassiveEffectV2, id string) *model.DPSPassiveEffectV2 {
	for i := range passives {
		for _, candidate := range passiveIDs(passives[i]) {
			if candidate == id {
				return &passives[i]
			}
		}
	}
	return nil
}

func passiveIDs(passive model.DPSPassiveEffectV2) []string {
	ids := make([]string, 0, 3)
	for _, id := range []string{passive.PassiveID, passive.EffectID, passive.SourceID} {
		id = strings.TrimSpace(id)
		if id != "" {
			ids = append(ids, id)
		}
	}
	return ids
}

func passiveID(passive model.DPSPassiveEffectV2) string {
	for _, id := range passiveIDs(passive) {
		return id
	}
	return ""
}

func passiveRuntimeKey(passive model.DPSPassiveEffectV2) string {
	return nonEmpty(passive.TriggerID, passiveID(passive))
}

func passiveEffectRuntimeKey(passive model.DPSPassiveEffectV2) string {
	passiveKey := nonEmpty(passive.PassiveID, nonEmpty(passive.SourceID, passiveID(passive)))
	effectKey := nonEmpty(passive.EffectID, passive.TriggerID)
	if effectKey == "" || effectKey == passiveKey {
		return passiveKey
	}
	return passiveKey + "/" + effectKey
}

func stackRuntimeKey(passive model.DPSPassiveEffectV2, stackKey string) string {
	return passiveEffectRuntimeKey(passive) + "#" + stackKey
}

func passiveDamageSource(passive model.DPSPassiveEffectV2, op model.DPSPassiveOperationV2) string {
	return nonEmpty(op.Source, nonEmpty(passive.SourceID, passiveID(passive)))
}

func passiveHasPerStackStatModifier(passive model.DPSPassiveEffectV2) bool {
	for _, op := range passive.Operations {
		if op.Kind == dpsOpStatModifier && op.PerStack {
			return true
		}
	}
	return false
}

func intToString(value int) string {
	return strconv.Itoa(value)
}

func int64ToString(value int64) string {
	return strconv.FormatInt(value, 10)
}

func floatToString(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}

func hasScenarioState(states []model.DPSScenarioStateV2, stateID string) bool {
	for _, state := range states {
		if state.StateID == stateID {
			return true
		}
	}
	return false
}

func dotInterval(_ model.DPSPassiveOperationV2, rules model.DPSimulationRulesV2) int64 {
	return rules.DotTickIntervalMs
}

func copyDPSFloatMap(input map[string]float64) map[string]float64 {
	output := make(map[string]float64, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func copyDPSAttributeViews(input map[string]model.AttributeSnapshotV2) map[string]model.AttributeSnapshotV2 {
	if len(input) == 0 {
		return nil
	}
	output := make(map[string]model.AttributeSnapshotV2, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func normalizeStringSet(values []string) map[string]bool {
	output := make(map[string]bool, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			output[value] = true
		}
	}
	return output
}

func sameStringSet(left map[string]bool, right map[string]bool) bool {
	if len(left) != len(right) {
		return false
	}
	for value := range left {
		if !right[value] {
			return false
		}
	}
	return true
}

func readFirstPositiveAttr(attrs map[string]float64, keys ...string) float64 {
	for _, key := range keys {
		value, ok := attrs[key]
		if ok && value > 0 && !math.IsNaN(value) && !math.IsInf(value, 0) {
			return value
		}
	}
	return 0
}

func readFirstFiniteAttr(attrs map[string]float64, keys ...string) float64 {
	for _, key := range keys {
		value, ok := attrs[key]
		if ok && !math.IsNaN(value) && !math.IsInf(value, 0) {
			return value
		}
	}
	return 0
}

func hasAnyFiniteAttr(attrs map[string]float64, keys ...string) bool {
	for _, key := range keys {
		value, ok := attrs[key]
		if ok && !math.IsNaN(value) && !math.IsInf(value, 0) {
			return true
		}
	}
	return false
}

func hasType(types []string, expected string) bool {
	for _, value := range types {
		if value == expected {
			return true
		}
	}
	return false
}

func clampFloat(value float64, min float64, max float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return min
	}
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func nonEmpty(value string, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}

var dpsAttrAliases = map[string]string{
	"ad":           "attack_damage",
	"attackDamage": "attack_damage",
}

func applyDPSAttributesToStore(store *attribute.Store, attrIndex map[string]uint16, values map[string]float64) {
	if store == nil || len(values) == 0 {
		return
	}
	for key, value := range values {
		attrID := strings.TrimSpace(key)
		if alias, ok := dpsAttrAliases[attrID]; ok {
			attrID = alias
		}
		index, ok := attrIndex[attrID]
		if !ok || int(index) >= len(store.Slots) {
			continue
		}
		store.Slots[index].SetBase(value)
	}
	store.ResolveAll(0)
}

func attackerOwnsCompiledAction(bundle compilebundle.CompiledBundle, attackerTemplateID string, actionIndex uint16) bool {
	templateIndex, ok := bundle.ActorIndex[attackerTemplateID]
	if !ok || int(templateIndex) >= len(bundle.Actors) {
		return false
	}
	for _, owned := range bundle.Actors[templateIndex].Actions {
		if owned == actionIndex {
			return true
		}
	}
	return false
}

func compiledActionHasBasicAttackClassifier(bundle compilebundle.CompiledBundle, actionIndex uint16) bool {
	if int(actionIndex) >= len(bundle.Actions) {
		return false
	}
	typeID, ok := bundle.Types.Lookup("action/basic_attack")
	if !ok {
		return false
	}
	return bundle.Actions[actionIndex].TypeSet.Contains(typeID)
}
