package effect

import "fmt"

// IdentityRegistryAPI 列出本场效果实例身份分配能力；移除实例不释放已经使用的引用。
type IdentityRegistryAPI interface {
	// ProvidersSeeded 判断供值实例身份集合是否已初始化。
	ProvidersSeeded() bool
	// ShieldsSeeded 判断护盾身份集合是否已初始化。
	ShieldsSeeded() bool
	// SeedProviders 按需初始化供值实例身份集合。
	SeedProviders()
	// SeedShields 按需初始化护盾身份集合。
	SeedShields()
	// ReserveProvider 保留已存在的供值实例引用，防止后续分配复用。
	ReserveProvider(ref string)
	// ReserveShield 保留非空护盾引用，防止后续分配复用。
	ReserveShield(ref string)
	// NextProvider 按定义与单调编号分配未使用的供值实例引用，并立即保留。
	NextProvider(definition string) string
	// NextShield 按定义与单调编号分配未使用的护盾引用；空定义沿当前默认身份前缀处理。
	NextShield(definition string) string
}

// IdentityRegistry 拥有效果实例的本次运行身份；移除实例不释放已用引用。
type IdentityRegistry struct {
	providerSequence uint64
	shieldSequence   uint64
	providerRefs     map[string]bool
	shieldRefs       map[string]bool
}

var _ IdentityRegistryAPI = (*IdentityRegistry)(nil)

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
