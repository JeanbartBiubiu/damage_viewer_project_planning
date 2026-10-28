package action

import (
	planbundle "tinygo_engine_v2/internal/plan"
)

type AmmoView struct{ data *ammoData }

type ammoData struct {
	owner, providerRef, target, abilityRef string
	definition                             planbundle.CompiledProvider
	binding                                planbundle.CompiledAmmoBinding
	wait                                   AmmoWait
	ability                                planbundle.CompiledAbility
}

type AmmoWait struct {
	ReadyAt    int64
	Generation uint64
	Active     bool
}

type AmmoSeed struct {
	Owner, ProviderRef, Target, AbilityRef string
	Definition                             planbundle.CompiledProvider
	Binding                                planbundle.CompiledAmmoBinding
	Wait                                   AmmoWait
	Ability                                planbundle.CompiledAbility
}

func NewAmmo(seed AmmoSeed) *AmmoView {
	return &AmmoView{data: &ammoData{owner: seed.Owner, providerRef: seed.ProviderRef, target: seed.Target, abilityRef: seed.AbilityRef, definition: seed.Definition, binding: seed.Binding, wait: seed.Wait, ability: seed.Ability}}
}
func (a *AmmoView) Owner() string                           { return a.data.owner }
func (a *AmmoView) ProviderRef() string                     { return a.data.providerRef }
func (a *AmmoView) Target() string                          { return a.data.target }
func (a *AmmoView) AbilityRef() string                      { return a.data.abilityRef }
func (a *AmmoView) Definition() planbundle.CompiledProvider { return a.data.definition }
func (a *AmmoView) Binding() planbundle.CompiledAmmoBinding { return a.data.binding }
func (a *AmmoView) Ability() planbundle.CompiledAbility     { return a.data.ability }
func (a *AmmoView) Wait() AmmoWait                          { return a.data.wait }
func (s *State) BindAmmo(a *AmmoView, target, ref string, ability planbundle.CompiledAbility) {
	a.data.target, a.data.abilityRef, a.data.ability = target, ref, ability
}
func (s *State) AddAmmo(a *AmmoView)                        { s.ammo = append(s.ammo, a) }
func (s *State) AmmoCount() int                             { return len(s.ammo) }
func (s *State) AmmoAt(index int) *AmmoView                 { return s.ammo[index] }
func (s *State) PublishAmmoWait(a *AmmoView, wait AmmoWait) { a.data.wait = wait }
func (s *State) RemoveAmmoProvider(owner, provider string) {
	removedBasic := false
	for _, ammo := range s.ammo {
		if ammo.Owner() == owner && ammo.ProviderRef() == provider {
			removedBasic = s.basicAttack != nil && s.basicAttack.Ammo() == ammo
			ammo.data.wait.Active = false
			if ammo.data.wait.Generation != ^uint64(0) {
				ammo.data.wait.Generation++
			}
		}
	}
	if !removedBasic && s.basicAttack != nil && s.basicAttack.Ammo() != nil {
		ammo := s.basicAttack.Ammo()
		if ammo.Owner() == owner && ammo.ProviderRef() == provider {
			ammo.data.wait.Active = false
			if ammo.data.wait.Generation != ^uint64(0) {
				ammo.data.wait.Generation++
			}
		}
	}
}
