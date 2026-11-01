package operation

import (
	"math"
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/contract"
)

const eventTypeBasicAttackHit = model.EventTypeBasicAttackHit

// applyExecuteThreshold 仅在真实 event/basic_attack_hit 的 emit snapshot 上判定；
// 命中后经 command/pipeline 置零 live HP，不写 damage summary/evidence，不 emit。
func (f *calculation) applyExecuteThreshold(op planbundle.CompiledOperation, targetKey string, ability planbundle.CompiledAbility) *model.EngineError {
	// Fail closed：无 event context 或非 basic_attack_hit 不触发。
	if f.input.Event == nil || f.input.Event.EventType != eventTypeBasicAttackHit {
		return nil
	}
	snapCurrent := attribute.ReadAttr(f.input.Event.TargetAttrs, "hp.current")
	snapMax := attribute.ReadAttr(f.input.Event.TargetAttrs, "hp.max")
	if snapMax <= 0 {
		snapMax = attribute.ReadHPMax(f.input.Event.TargetAttrs)
	}
	if snapMax <= 0 || math.IsNaN(snapMax) || math.IsInf(snapMax, 0) {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "execute_threshold requires positive snapshot max HP", f.executor.plan.SchemaHash, f.executor.plan.RulesHash, f.executor.sessionID)
	}
	ratio := snapCurrent / snapMax
	if math.IsNaN(ratio) || math.IsInf(ratio, 0) || !(ratio < op.Threshold) {
		return nil
	}

	sc := f.stageFor(targetKey)
	liveHP := attribute.ReadAttr(sc.attributesView(), "hp.current")
	if liveHP <= 0 || math.IsNaN(liveHP) || math.IsInf(liveHP, 0) {
		return nil
	}

	cmd := pipeline.Command{
		Kind:          pipeline.KindExecuteThreshold,
		Source:        f.input.Source,
		Target:        targetKey,
		Ref:           op.Ref,
		Threshold:     op.Threshold,
		SnapshotHP:    snapCurrent,
		SnapshotMaxHP: snapMax,
	}
	if !pipeline.ValidateCommand(cmd) {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrOperationTargetMissing, "execute_threshold target unavailable", f.executor.plan.SchemaHash, f.executor.plan.RulesHash, f.executor.sessionID)
	}

	viewAttributes, viewShields := sc.attributesView(), sc.Instances.Shields()
	outcome, nextAttributes, nextShields := viewShields.ExecuteThreshold(cmd, viewAttributes)

	sc.setAttributes(nextAttributes)
	sc.Instances.SetShields(nextShields)
	if !outcome.Applied {
		return nil
	}
	f.reResolveStagedAttributesTwoPass(ability)
	*sc.Dirty = true

	f.recordGenericExecuteEvidence(contract.ExecuteFact{
		Source:       cmd.Source,
		Target:       cmd.Target,
		ProviderRef:  f.input.ProviderRef,
		AbilityRef:   f.input.AbilityRef,
		OperationRef: op.Ref,
		HpBefore:     outcome.HPBefore,
		MaxHp:        snapMax,
		HpRatio:      ratio,
		Threshold:    op.Threshold,
		Killed:       outcome.Killed,
		ShieldBypass: outcome.ShieldBypassed,
	})
	return nil
}
