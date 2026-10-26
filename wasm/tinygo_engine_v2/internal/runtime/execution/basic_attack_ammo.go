package execution

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

func (s *Engine) basicAttackAmmoReady() (bool, *model.EngineError) {
	if s.actions.BasicAttack() == nil || s.actions.BasicAttack().Ammo() == nil {
		return true, nil
	}
	ammo := s.actions.BasicAttack().Ammo()
	s.bindBasicAttackAmmo(ammo)
	var frame Frame
	s.initAmmoFrame(&frame, ammo)
	value, err := frame.ammoInventory(ammo)
	if err != nil {
		return false, err
	}
	if value > 0 {
		if ammo.Wait().Active && !ammo.Definition().StateFields[ammo.Binding().StateKey].AmmoRecovery.OneByOne {
			return false, s.basicAttackErr("a recovering all-at-once inventory cannot contain usable ammo", ammo.Binding().StateKey)
		}
		return true, nil
	}
	if ammo.Wait().Active {
		if ammo.Wait().ReadyAt <= s.loop.TimeMs() {
			return false, s.basicAttackErr("ammo recovery must settle before attack admission", ammo.Binding().StateKey)
		}
		return false, nil
	}
	if err := frame.consumeCommands(1); err != nil {
		return false, err
	}
	if err := frame.stageAmmoRecoveryFor(ammo, ammo.Ability(), -1); err != nil {
		return false, err
	}
	frame.commit()
	return false, frame.fatalErr
}

func (f *Frame) populateMechanicEvalContext(context *formula.GenericEvalContext, ability planbundle.CompiledAbility) {
	f.populateAttackStartStateContext(context)
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
			if use := f.run.skillUses[useRef]; use != nil && use.identity.Source() == f.providerOwnerKey() && use.identity.SkillKey() == ability.SkillKey {
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

func (f *Frame) statusPresence(owner string) map[string]bool {
	values := map[string]bool{}
	for _, statusKey := range f.run.compiled.StatusKeys {
		values[statusKey] = false
	}
	for instanceIndex, instanceValues := 0, f.stageFor(owner).instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
		instance := instanceValues.At(instanceIndex)
		if instance.Expired(f.run.loop.TimeMs()) {
			continue
		}
		for instanceIndex, instanceValues := 0, instance.StatusContributions; instanceIndex < instanceValues.Len(); instanceIndex++ {
			contribution := instanceValues.At(instanceIndex)
			if _, declared := values[contribution.StatusKey]; declared {
				values[contribution.StatusKey] = true
			}
		}
	}
	return values
}
