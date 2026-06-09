package runtime

import (
	"math"
	"strings"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func (ctx *RunContext) dealDamage(source uint8, target uint8, amount float64, damageType string, chainDepth uint8) model.ErrCode {
	_, code := ctx.dealDamageResult(source, target, amount, damageType, chainDepth)
	return code
}

func (ctx *RunContext) dealDamageResult(source uint8, target uint8, amount float64, damageType string, chainDepth uint8) (damageApplication, model.ErrCode) {
	if code := validateDamageAmount(amount); code != model.ErrOK {
		return damageApplication{}, code
	}
	hpBefore := ctx.Actors[target].HP
	shieldBefore := ctx.shieldTotal(target)
	remaining := ctx.consumeShields(target, amount, damageType)
	shieldAfter := ctx.shieldTotal(target)
	hpAfter, appliedDamage, code := applyDamageToHP(hpBefore, remaining)
	if code != model.ErrOK {
		return damageApplication{}, code
	}
	ctx.Actors[target].HP = hpAfter
	ctx.Actors[target].DamageTaken.Add(ctx.NowMs, appliedDamage)
	ctx.log("damage", source, target, 0, 0, appliedDamage, damageType)
	if code := ctx.fireTriggers(compilebundle.TriggerOnDamageDealt, source, target, appliedDamage, chainDepth); code != model.ErrOK {
		return damageApplication{FinalDamage: appliedDamage, ShieldBefore: shieldBefore, ShieldAfter: shieldAfter, ShieldAbsorbed: amount - remaining}, code
	}
	if code := ctx.fireTriggers(compilebundle.TriggerOnDamageTaken, source, target, appliedDamage, chainDepth); code != model.ErrOK {
		return damageApplication{FinalDamage: appliedDamage, ShieldBefore: shieldBefore, ShieldAfter: shieldAfter, ShieldAbsorbed: amount - remaining}, code
	}
	if ctx.Actors[target].HP <= 0 {
		if code := ctx.EmitDone("actor_dead"); code != model.ErrOK {
			return damageApplication{FinalDamage: appliedDamage, ShieldBefore: shieldBefore, ShieldAfter: shieldAfter, ShieldAbsorbed: amount - remaining}, code
		}
	}
	return damageApplication{FinalDamage: appliedDamage, ShieldBefore: shieldBefore, ShieldAfter: shieldAfter, ShieldAbsorbed: amount - remaining}, model.ErrOK
}

func (ctx *RunContext) applyHeal(source uint8, target uint8, amount float64) (healApplication, model.ErrCode) {
	if amount < 0 || math.IsNaN(amount) || math.IsInf(amount, 0) {
		return healApplication{}, model.ErrNumeric
	}
	hpBefore := ctx.Actors[target].HP
	ctx.Actors[target].HP = math.Min(ctx.Actors[target].MaxHP, ctx.Actors[target].HP+amount)
	applied := ctx.Actors[target].HP - hpBefore
	overheal := amount - applied
	if overheal < 0 {
		overheal = 0
	}
	ctx.log("heal", source, target, 0, 0, applied, "")
	return healApplication{HPBefore: hpBefore, HPAfter: ctx.Actors[target].HP, Applied: applied, Overheal: overheal}, model.ErrOK
}

func (ctx *RunContext) fireTriggers(event compilebundle.TriggerEvent, source uint8, target uint8, damage float64, chainDepth uint8) model.ErrCode {
	if chainDepth > 0 {
		return model.ErrOK
	}
	count := 0
	for _, trigger := range ctx.Bundle.Triggers {
		if trigger.Event != event {
			continue
		}
		if !ctx.triggerOwnerMatches(trigger, source, target) {
			continue
		}
		if trigger.RequiresDamage && damage <= 0 {
			continue
		}
		count += len(trigger.Effects)
		if count > ctx.Bundle.Settings.MaxCommandsPerEvent {
			return model.ErrUnsupported
		}
		ctx.TriggerResults = append(ctx.TriggerResults, model.TriggerRunResultV2{
			TimeMs:        ctx.NowMs,
			TriggerID:     trigger.ID,
			Event:         triggerEventName(event),
			SourceActorID: ctx.Actors[source].ActorID,
			TargetActorID: ctx.Actors[target].ActorID,
			EffectCount:   len(trigger.Effects),
			ChainDepth:    int(chainDepth) + 1,
		})
		ctx.log("trigger_fire", source, target, 0, 0, 0, trigger.ID)
		for _, effect := range trigger.Effects {
			if code := ctx.applyEffect(effect, source, target, chainDepth+1, 0, nil, -1); code != model.ErrOK {
				return code
			}
		}
	}
	return model.ErrOK
}

func (ctx *RunContext) triggerOwnerMatches(trigger compilebundle.CompiledTrigger, source uint8, target uint8) bool {
	if trigger.OwnerRole == "" && trigger.OwnerID == "" {
		return true
	}
	switch trigger.OwnerRole {
	case "source":
		return trigger.OwnerID == "" || ctx.Actors[source].ActorID == trigger.OwnerID
	case "target":
		return trigger.OwnerID == "" || ctx.Actors[target].ActorID == trigger.OwnerID
	case "":
		return ctx.Actors[source].ActorID == trigger.OwnerID || ctx.Actors[target].ActorID == trigger.OwnerID
	default:
		return false
	}
}

func triggerEventName(event compilebundle.TriggerEvent) string {
	switch event {
	case compilebundle.TriggerOnDamageTaken:
		return "on_damage_taken"
	case compilebundle.TriggerOnDamageDealt:
		return "on_damage_dealt"
	case compilebundle.TriggerOnActionCast:
		return "on_action_cast"
	default:
		return ""
	}
}

func (ctx *RunContext) consumeShields(actor uint8, amount float64, damageType string) float64 {
	remaining := amount
	for i := range ctx.Shields {
		if remaining <= 0 {
			break
		}
		shield := &ctx.Shields[i]
		if !shield.Alive || shield.Actor != actor || !shieldMatches(shield.Kind, damageType) {
			continue
		}
		used := math.Min(shield.Amount, remaining)
		shield.Amount -= used
		remaining -= used
		ctx.log("shield_absorb", actor, actor, 0, 0, used, shield.Kind)
		if shield.Amount <= 0 {
			shield.Alive = false
		}
	}
	return remaining
}

func shieldMatches(kind string, damageType string) bool {
	normalizedKind := normalizeShieldKind(kind)
	return normalizedKind == "" || normalizedKind == "all" || normalizedKind == damageType
}

func normalizeShieldKind(kind string) string {
	switch kind {
	case "", "all", "physical", "magic", "true":
		return kind
	case "shield", "all_shield":
		return "all"
	case "physical_shield":
		return "physical"
	case "magic_shield":
		return "magic"
	case "true_shield":
		return "true"
	}
	if strings.HasSuffix(kind, "_shield") {
		return strings.TrimSuffix(kind, "_shield")
	}
	return kind
}
