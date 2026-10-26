package effect

import "fmt"

// IdentityRegistry 拥有效果实例的本次运行身份；移除实例不释放已用引用。
type IdentityRegistry struct {
	providerSequence uint64
	shieldSequence   uint64
	providerRefs     map[string]bool
	shieldRefs       map[string]bool
}

func NewIdentityRegistry() IdentityRegistry {
	return IdentityRegistry{providerRefs: map[string]bool{}, shieldRefs: map[string]bool{}}
}

func (r *IdentityRegistry) ProvidersSeeded() bool { return r.providerRefs != nil }
func (r *IdentityRegistry) ShieldsSeeded() bool   { return r.shieldRefs != nil }
func (r *IdentityRegistry) SeedProviders() {
	if r.providerRefs == nil {
		r.providerRefs = map[string]bool{}
	}
}
func (r *IdentityRegistry) SeedShields() {
	if r.shieldRefs == nil {
		r.shieldRefs = map[string]bool{}
	}
}
func (r *IdentityRegistry) ReserveProvider(ref string) {
	r.SeedProviders()
	r.providerRefs[ref] = true
}
func (r *IdentityRegistry) ReserveShield(ref string) {
	r.SeedShields()
	if ref != "" {
		r.shieldRefs[ref] = true
	}
}
func (r *IdentityRegistry) NextProvider(definition string) string {
	r.SeedProviders()
	for {
		r.providerSequence++
		ref := fmt.Sprintf("%s#%d", definition, r.providerSequence)
		if !r.providerRefs[ref] {
			r.providerRefs[ref] = true
			return ref
		}
	}
}
func (r *IdentityRegistry) NextShield(definition string) string {
	if definition == "" {
		definition = "shield:auto"
	}
	r.SeedShields()
	for {
		r.shieldSequence++
		ref := fmt.Sprintf("%s#%d", definition, r.shieldSequence)
		if !r.shieldRefs[ref] {
			r.shieldRefs[ref] = true
			return ref
		}
	}
}
