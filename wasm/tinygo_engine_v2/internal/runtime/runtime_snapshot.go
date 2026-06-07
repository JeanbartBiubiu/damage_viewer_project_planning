package runtime

import (
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func (ctx *RunContext) snapshots() []model.ActorSnapshot {
	return []model.ActorSnapshot{
		ctx.snapshot(0),
		ctx.snapshot(1),
	}
}

func (ctx *RunContext) actionSnapshots() []model.ActorActionSnapshotV2 {
	return []model.ActorActionSnapshotV2{
		ctx.actionSnapshot(0),
		ctx.actionSnapshot(1),
	}
}

func (ctx *RunContext) actionSnapshot(actor uint8) model.ActorActionSnapshotV2 {
	if int(actor) >= len(ctx.Actors) {
		return model.ActorActionSnapshotV2{}
	}
	templateID := ctx.Actors[actor].Template
	if int(templateID) >= len(ctx.Bundle.Actors) {
		return model.ActorActionSnapshotV2{ActorID: ctx.Actors[actor].ActorID}
	}
	template := ctx.Bundle.Actors[templateID]
	actions := make([]model.ActionInitialStateV2, 0, len(template.Actions))
	for _, actionID := range template.Actions {
		if int(actionID) >= len(ctx.Bundle.Actions) {
			continue
		}
		action := ctx.Bundle.Actions[actionID]
		gate := ctx.CanCast(actor, actionID, ctx.NowMs)
		cooldownMs, cooldownFormulaID, cooldownBreakdown := ctx.actionCooldownSnapshot(actor, actionID)
		readyAtMs := int64(0)
		if int(actionID) < len(ctx.Actors[actor].ActionState) {
			readyAtMs = ctx.Actors[actor].ActionState[actionID].ReadyAtMs
		}
		actions = append(actions, model.ActionInitialStateV2{
			ActionID:          action.ID,
			Label:             action.Label,
			SkillLevel:        ctx.actionSkillLevel(actor, actionID),
			PanelInputs:       ctx.actionPanelInputs(actor, actionID),
			CooldownMs:        cooldownMs,
			CooldownFormulaID: cooldownFormulaID,
			CooldownBreakdown: cooldownBreakdown,
			ReadyAtMs:         readyAtMs,
			CanCast:           gate.Code == CastOK,
			BlockedReason:     castBlockedReason(gate),
			ResourceCosts:     ctx.actionCostSnapshotRows(actor, actionID),
			EffectRows:        ctx.actionEffectSnapshotRows(actor, actionID),
		})
	}
	return model.ActorActionSnapshotV2{
		ActorID: ctx.Actors[actor].ActorID,
		Actions: actions,
	}
}

func (ctx *RunContext) actionCostSnapshotRows(actor uint8, action uint16) []model.ActionCostSnapshotV2 {
	compiled := ctx.Bundle.Actions[action]
	if len(compiled.PanelCosts) > 0 {
		rows := make([]model.ActionCostSnapshotV2, 0, len(compiled.PanelCosts))
		for _, cost := range compiled.PanelCosts {
			amount := cost.Amount
			breakdown := []model.ActionValueBreakdownStepV2(nil)
			if cost.HasFormula {
				value, steps, ok := ctx.evalActionFormula(actor, actor, actor, action, cost.Formula)
				if ok {
					amount = value
					breakdown = steps
				}
			}
			rows = append(rows, model.ActionCostSnapshotV2{
				ResourceID:  cost.ResourceID,
				FormulaID:   cost.FormulaID,
				Amount:      amount,
				Source:      "panel",
				BaseAmount:  cost.Amount,
				FinalAmount: amount,
				Breakdown:   breakdown,
			})
		}
		return rows
	}
	amounts, _, ok := ctx.actionCostAmounts(actor, action)
	if !ok {
		return nil
	}
	rows := make([]model.ActionCostSnapshotV2, 0, len(compiled.Costs))
	for i, cost := range compiled.Costs {
		row := model.ActionCostSnapshotV2{
			Amount:      amounts[i],
			Source:      "resourceCost",
			BaseAmount:  cost.Amount,
			FinalAmount: amounts[i],
		}
		if int(cost.Resource) < len(ctx.Bundle.Resources) {
			row.ResourceID = ctx.Bundle.Resources[cost.Resource].ID
		}
		if cost.HasFormula && int(cost.Formula) < len(ctx.Bundle.Formulas.Programs) {
			row.FormulaID = ctx.Bundle.Formulas.Programs[cost.Formula].ID
			if _, steps, ok := ctx.evalActionFormula(actor, actor, actor, action, cost.Formula); ok {
				row.Breakdown = steps
			}
		}
		rows = append(rows, row)
	}
	return rows
}

func (ctx *RunContext) actionEffectSnapshotRows(actor uint8, action uint16) []model.ActionEffectSnapshotV2 {
	compiled := ctx.Bundle.Actions[action]
	if len(compiled.PanelEffects) > 0 {
		rows := make([]model.ActionEffectSnapshotV2, 0, len(compiled.PanelEffects))
		for _, effect := range compiled.PanelEffects {
			amount := effect.Amount
			breakdown := []model.ActionValueBreakdownStepV2(nil)
			actualSource := roleActor(effect.SourceRole, actor, actor^1)
			actualTarget := roleActor(effect.TargetRole, actor, actor^1)
			if effect.HasFormula {
				value, steps, ok := ctx.evalActionFormula(actor, actualSource, actualTarget, action, effect.Formula)
				if ok {
					amount = value
					breakdown = steps
				}
			}
			rows = append(rows, model.ActionEffectSnapshotV2{
				EffectIndex:       effect.EffectIndex,
				Kind:              effect.Kind,
				Label:             effect.Label,
				FormulaID:         effect.FormulaID,
				DamageType:        effect.DamageType,
				StatusID:          effect.StatusID,
				AttrID:            effect.AttrID,
				MarkID:            effect.MarkID,
				SourceRole:        effect.SourceRole,
				TargetRole:        effect.TargetRole,
				ResolvedAmount:    amount,
				HasResolvedAmount: true,
				Source:            "panel",
				BaseAmount:        effect.Amount,
				FinalAmount:       amount,
				Breakdown:         breakdown,
			})
		}
		return rows
	}
	rows := make([]model.ActionEffectSnapshotV2, 0, len(compiled.Effects))
	for idx, effect := range compiled.Effects {
		row := model.ActionEffectSnapshotV2{
			EffectIndex: idx,
			Kind:        effectKindString(effect.Type),
			DamageType:  effect.DamageType,
			MarkID:      effect.MarkID,
			SourceRole:  effect.SourceRole,
			TargetRole:  effect.TargetRole,
			Source:      "effects",
			BaseAmount:  effect.Amount,
		}
		if effect.HasFormula && int(effect.Formula) < len(ctx.Bundle.Formulas.Programs) {
			row.FormulaID = ctx.Bundle.Formulas.Programs[effect.Formula].ID
		}
		if int(effect.Status) < len(ctx.Bundle.Statuses) {
			row.StatusID = ctx.Bundle.Statuses[effect.Status].ID
		}
		actualSource := roleActor(effect.SourceRole, actor, actor^1)
		actualTarget := roleActor(effect.TargetRole, actor, actor^1)
		switch effect.Type {
		case compilebundle.EffectDealDamage, compilebundle.EffectHeal, compilebundle.EffectGrantShield:
			amount, code := ctx.effectAmount(effect, actualSource, actualTarget, float64(ctx.actionSkillLevel(actor, action)))
			if code == model.ErrOK {
				row.ResolvedAmount = amount
				row.HasResolvedAmount = true
				row.FinalAmount = amount
				if effect.HasFormula {
					if _, steps, ok := ctx.evalActionFormula(actor, actualSource, actualTarget, action, effect.Formula); ok {
						row.Breakdown = steps
					}
				}
			}
		case compilebundle.EffectDamageFromRecent:
			amount := ctx.Actors[actualSource].DamageTaken.Sum(ctx.NowMs, effect.HistoryWindowMs)
			if effect.Amount != 0 {
				amount *= effect.Amount
			}
			row.ResolvedAmount = amount
			row.HasResolvedAmount = true
			row.FinalAmount = amount
		}
		rows = append(rows, row)
	}
	return rows
}

func (ctx *RunContext) snapshot(actor uint8) model.ActorSnapshot {
	ctx.Actors[actor].Attrs.ResolveAll(ctx.NowMs)
	attrs := make(map[string]model.AttributeSnapshotV2, len(ctx.Bundle.Attrs))
	for i, def := range ctx.Bundle.Attrs {
		slot := ctx.Actors[actor].Attrs.Slots[i]
		attrs[def.ID] = model.AttributeSnapshotV2{
			Base: slot.Base, Current: slot.Current, Max: slot.Max, Resolved: slot.Resolved,
		}
	}
	resources := make(map[string]model.ResourceValueV2, len(ctx.Bundle.Resources))
	for i, def := range ctx.Bundle.Resources {
		slot := ctx.Actors[actor].Resources.Slots[i]
		resources[def.ID] = model.ResourceValueV2{Current: slot.Current, Max: slot.Max}
	}
	return model.ActorSnapshot{
		ActorID: ctx.Actors[actor].ActorID, CurrentHP: ctx.Actors[actor].HP, MaxHP: ctx.Actors[actor].MaxHP,
		ShieldAmount: ctx.shieldTotal(actor), Attributes: attrs, Resources: resources,
	}
}

func (ctx *RunContext) shieldTotal(actor uint8) float64 {
	total := 0.0
	for _, shield := range ctx.Shields {
		if shield.Alive && shield.Actor == actor {
			total += shield.Amount
		}
	}
	return total
}

func (ctx *RunContext) statusID(statusID uint16) string {
	if int(statusID) >= len(ctx.Bundle.Statuses) {
		return ""
	}
	return ctx.Bundle.Statuses[statusID].ID
}
