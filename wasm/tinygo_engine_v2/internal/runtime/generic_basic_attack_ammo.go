package runtime

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

type ammoUseCapture struct {
	useRef      string
	owner       string
	providerRef string
	stateKey    string
	before      float64
}

type ammoRecoveryWait struct {
	readyAt    int64
	generation uint64
	active     bool
}

type basicAttackAmmo struct {
	owner       string
	providerRef string
	definition  planbundle.CompiledProvider
	binding     planbundle.CompiledAmmoBinding
	wait        ammoRecoveryWait
	target      string
	abilityRef  string
	ability     planbundle.CompiledAbility
}

func validBasicAttackAmmoProvider(provider planbundle.CompiledProvider) bool {
	if provider.AmmoBinding == nil {
		return len(provider.StateFields) == 0
	}
	return validBoundAmmoFields(provider)
}

func validBoundAmmoFields(provider planbundle.CompiledProvider) bool {
	if provider.AmmoBinding == nil {
		return false
	}
	field, exists := provider.StateFields[provider.AmmoBinding.StateKey]
	if !exists || field.StateKind != model.ProviderStateKindAmmo || field.AmmoRecovery == nil {
		return false
	}
	for key, extra := range provider.StateFields {
		if key != provider.AmmoBinding.StateKey && (extra.StateKind != "" || extra.ValueType != model.ProviderStateValueInteger) {
			return false
		}
	}
	return true
}

func (s *genericRunState) basicAttackAmmoReady() (bool, *model.EngineError) {
	if s.basicAttack == nil || s.basicAttack.ammo == nil {
		return true, nil
	}
	ammo := s.basicAttack.ammo
	s.bindBasicAttackAmmo(ammo)
	var frame executionFrame
	s.initAmmoFrame(&frame, ammo)
	value, err := frame.ammoInventory(ammo)
	if err != nil {
		return false, err
	}
	if value > 0 {
		if ammo.wait.active && !ammo.definition.StateFields[ammo.binding.StateKey].AmmoRecovery.OneByOne {
			return false, s.basicAttackErr("a recovering all-at-once inventory cannot contain usable ammo", ammo.binding.StateKey)
		}
		return true, nil
	}
	if ammo.wait.active {
		if ammo.wait.readyAt <= s.nowMs {
			return false, s.basicAttackErr("ammo recovery must settle before attack admission", ammo.binding.StateKey)
		}
		return false, nil
	}
	if err := frame.consumeCommands(1); err != nil {
		return false, err
	}
	if err := frame.stageAmmoRecoveryFor(ammo, ammo.ability, -1); err != nil {
		return false, err
	}
	frame.commit()
	return false, frame.fatalErr
}

func (f *executionFrame) populateMechanicEvalContext(context *formula.GenericEvalContext, ability planbundle.CompiledAbility) {
	if !f.run.compiled.HasMechanicReads {
		return
	}
	if int(ability.ProviderIndex) < len(f.run.compiled.Providers) {
		provider := f.run.compiled.Providers[ability.ProviderIndex]
		if provider.AmmoBinding != nil {
			useRef := f.processUseKey
			if f.eventCtx != nil && f.eventCtx.hasUse {
				useRef = f.eventCtx.useKey
			} else if fact, exists := f.run.skillHitFacts[f.driverEntryKey]; exists && fact.UseRef != nil {
				useRef = *fact.UseRef
			}
			if use := f.run.skillUses[useRef]; use != nil && use.source == f.providerOwnerKey() && use.skillKey == ability.SkillKey {
				capture := use.ammoBefore
				if f.pendingAmmoCapture != nil && f.pendingAmmoCapture.useRef == useRef {
					capture = f.pendingAmmoCapture
				}
				if capture != nil && capture.owner == f.providerOwnerKey() && capture.providerRef == f.ownerProviderRef && capture.stateKey == provider.AmmoBinding.StateKey {
					context.HasUseAmmoBefore, context.UseAmmoBefore = true, capture.before
				}
			}
		}
	}
	context.HasStatusContext = true
	context.SourceStatuses = f.statusPresence(f.sourceKey)
	context.TargetStatuses = f.statusPresence(f.targetKey)
}

func (f *executionFrame) statusPresence(owner string) map[string]bool {
	values := map[string]bool{}
	for _, statusKey := range f.run.compiled.StatusKeys {
		values[statusKey] = false
	}
	for _, instance := range f.stageFor(owner).providers {
		if instance.Expired(f.run.nowMs) {
			continue
		}
		for _, contribution := range instance.StatusContributions {
			if _, declared := values[contribution.StatusKey]; declared {
				values[contribution.StatusKey] = true
			}
		}
	}
	return values
}
