// Legacy basicAttackActions → active action schedule adapter.
package runtime

import (
	"strings"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func resolvedDPSActiveActions(snapshot model.DPSResolvedSnapshotV2) []model.DPSActiveActionRefV2 {
	if len(snapshot.ActiveActions) > 0 {
		return snapshot.ActiveActions
	}
	refs := make([]model.DPSActiveActionRefV2, 0, len(snapshot.BasicAttackActions))
	for _, basic := range snapshot.BasicAttackActions {
		refs = append(refs, model.DPSActiveActionRefV2{
			ActionID:   basic.ActionID,
			SkillID:    basic.SkillID,
			Label:      basic.Label,
			Kind:       dpsActiveActionKindBasicAttack,
			Classifier: basic.Classifier,
		})
	}
	return refs
}

func resolveActiveActionKind(bundle compilebundle.CompiledBundle, ref model.DPSActiveActionRefV2, actionIndex uint16) string {
	kind := strings.TrimSpace(ref.Kind)
	if kind == "" {
		if compiledActionHasBasicAttackClassifier(bundle, actionIndex) {
			return dpsActiveActionKindBasicAttack
		}
		return dpsActiveActionKindSkill
	}
	return kind
}
