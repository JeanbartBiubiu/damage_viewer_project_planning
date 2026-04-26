package typeset

import "tinygo_engine_v2/internal/model"

const MaxTypes = 256

type TypeID uint16

type TypeSet [4]uint64

type Registry struct {
	Keys []string
	ids  map[string]TypeID
}

type Matcher struct {
	any        TypeSet
	all        TypeSet
	none       TypeSet
	hasAny     bool
	impossible bool
}

func NewRegistry() Registry {
	return Registry{
		Keys: make([]string, 0),
		ids:  make(map[string]TypeID),
	}
}

func (r *Registry) Intern(key string) (TypeID, bool) {
	if r.ids == nil {
		r.ids = make(map[string]TypeID)
	}
	if id, ok := r.ids[key]; ok {
		return id, true
	}
	if len(r.Keys) >= MaxTypes {
		return 0, false
	}
	id := TypeID(len(r.Keys))
	r.ids[key] = id
	r.Keys = append(r.Keys, key)
	return id, true
}

func (r Registry) Lookup(key string) (TypeID, bool) {
	id, ok := r.ids[key]
	return id, ok
}

func (s *TypeSet) Add(id TypeID) {
	if id >= MaxTypes {
		return
	}
	s[id/64] |= uint64(1) << (id % 64)
}

func (s TypeSet) Contains(id TypeID) bool {
	if id >= MaxTypes {
		return false
	}
	return s[id/64]&(uint64(1)<<(id%64)) != 0
}

func (s TypeSet) Intersects(other TypeSet) bool {
	for i := range s {
		if s[i]&other[i] != 0 {
			return true
		}
	}
	return false
}

func (s TypeSet) ContainsAll(other TypeSet) bool {
	for i := range s {
		if s[i]&other[i] != other[i] {
			return false
		}
	}
	return true
}

func (s TypeSet) Empty() bool {
	for i := range s {
		if s[i] != 0 {
			return false
		}
	}
	return true
}

func CompileMatcher(input model.TypeMatcherV2, registry Registry) (Matcher, []string) {
	var matcher Matcher
	var problems []string

	matcher.hasAny = len(input.Any) > 0
	for _, key := range input.Any {
		id, ok := registry.Lookup(key)
		if !ok {
			problems = append(problems, "unknown type: "+key)
			continue
		}
		matcher.any.Add(id)
	}

	for _, key := range input.All {
		id, ok := registry.Lookup(key)
		if !ok {
			problems = append(problems, "unknown type: "+key)
			matcher.impossible = true
			continue
		}
		matcher.all.Add(id)
	}

	for _, key := range input.None {
		id, ok := registry.Lookup(key)
		if !ok {
			problems = append(problems, "unknown type: "+key)
			continue
		}
		matcher.none.Add(id)
	}

	return matcher, problems
}

func (m Matcher) Match(types TypeSet) bool {
	if m.impossible {
		return false
	}
	if m.hasAny && !types.Intersects(m.any) {
		return false
	}
	if !types.ContainsAll(m.all) {
		return false
	}
	if types.Intersects(m.none) {
		return false
	}
	return true
}
