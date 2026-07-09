package typeset

import (
	"strings"

	"tinygo_engine_v2/internal/model"
)

const maxRelationDepth = 2

// CatalogResult 是 type catalog 编译结果。
type CatalogResult struct {
	Registry Registry
	Domains  map[TypeID]string
}

// CompileTypeCatalog 将 TypeCatalog 编译为 flat registry，并校验 domain/relation。
func CompileTypeCatalog(catalog model.TypeCatalog, addError func(code model.GenericErrCode, path, message, ref string)) CatalogResult {
	result := CatalogResult{
		Registry: NewRegistry(),
		Domains:  make(map[TypeID]string),
	}
	seen := make(map[string]struct{}, len(catalog.Types))
	for i, entry := range catalog.Types {
		path := "typeCatalog.types[" + itoa(i) + "]"
		if entry.Key == "" {
			addError(model.GenericErrMissingRequiredField, path+".key", "type key is required", "")
			continue
		}
		if entry.Domain == "" {
			addError(model.GenericErrMissingRequiredField, path+".domain", "type domain is required", entry.Key)
			continue
		}
		if !strings.Contains(entry.Key, "/") {
			addError(model.GenericErrUnknownTypeKey, path+".key", "type key must be domain/name", entry.Key)
			continue
		}
		prefix := strings.SplitN(entry.Key, "/", 2)[0]
		if prefix != entry.Domain {
			addError(model.GenericErrMatcherDomainError, path, "type key domain prefix does not match domain field", entry.Key)
			continue
		}
		if _, exists := seen[entry.Key]; exists {
			addError(model.GenericErrUnknownTypeKey, path+".key", "duplicate type key", entry.Key)
			continue
		}
		seen[entry.Key] = struct{}{}
		id, ok := result.Registry.Intern(entry.Key)
		if !ok {
			addError(model.GenericErrUnknownTypeKey, path+".key", "too many type keys", entry.Key)
			continue
		}
		result.Domains[id] = entry.Domain
	}
	validateRelations(catalog.Relations, result, addError)
	return result
}

func validateRelations(relations []model.TypeRelation, catalog CatalogResult, addError func(code model.GenericErrCode, path, message, ref string)) {
	if len(relations) == 0 {
		return
	}
	parentOf := make(map[string]string, len(relations))
	childOf := make(map[string]string, len(relations))
	for i, rel := range relations {
		path := "typeCatalog.relations[" + itoa(i) + "]"
		if rel.Parent == "" || rel.Child == "" {
			addError(model.GenericErrMissingRequiredField, path, "relation parent and child are required", "")
			continue
		}
		parentID, parentOK := catalog.Registry.Lookup(rel.Parent)
		if !parentOK {
			addError(model.GenericErrUnknownTypeKey, path+".parent", "unknown relation parent type", rel.Parent)
		}
		childID, childOK := catalog.Registry.Lookup(rel.Child)
		if !childOK {
			addError(model.GenericErrUnknownTypeKey, path+".child", "unknown relation child type", rel.Child)
		}
		if !parentOK || !childOK {
			continue
		}
		_ = parentID
		_ = childID
		if existing, ok := parentOf[rel.Child]; ok && existing != rel.Parent {
			addError(model.GenericErrMatcherDomainError, path, "type relation child has multiple parents", rel.Child)
		}
		parentOf[rel.Child] = rel.Parent
		childOf[rel.Parent] = rel.Child
		if rel.Parent == rel.Child {
			addError(model.GenericErrMatcherDomainError, path, "type relation cycle detected", rel.Parent)
			continue
		}
		depth := relationDepth(rel.Child, parentOf)
		if depth > maxRelationDepth {
			addError(model.GenericErrMatcherDomainError, path, "type relation depth exceeds limit", rel.Child)
		}
		if hasCycle(rel.Child, parentOf) {
			addError(model.GenericErrMatcherDomainError, path, "type relation cycle detected", rel.Child)
		}
	}
}

func relationDepth(key string, parentOf map[string]string) int {
	depth := 1
	current := key
	visited := map[string]struct{}{key: {}}
	for {
		parent, ok := parentOf[current]
		if !ok {
			return depth
		}
		if _, seen := visited[parent]; seen {
			return depth
		}
		visited[parent] = struct{}{}
		depth++
		current = parent
	}
}

func hasCycle(start string, parentOf map[string]string) bool {
	slow, fast := start, start
	for {
		pSlow, okSlow := parentOf[slow]
		if !okSlow {
			return false
		}
		pFast, okFast := parentOf[fast]
		if !okFast {
			return false
		}
		pFast, okFast = parentOf[pFast]
		if !okFast {
			return false
		}
		if pSlow == pFast {
			return true
		}
		slow = pSlow
		fast = pFast
	}
}

// EntityKind 标识 matcher domain 校验的实体类别。
type EntityKind int

const (
	EntityCombatant EntityKind = iota
	EntityProvider
	EntityAbility
	EntityOperationDamageType
	EntityListener
)

var allowedDomains = map[EntityKind]map[string]struct{}{
	EntityCombatant: {
		"combatant": {},
		"ability":   {},
		"damage":    {},
		"status":    {},
		"provider":  {},
		"tag":       {},
	},
	EntityProvider: {
		"provider": {},
		"ability":  {},
		"damage":   {},
		"status":   {},
		"tag":      {},
	},
	EntityAbility: {
		"ability": {},
		"damage":  {},
		"tag":     {},
	},
	EntityOperationDamageType: {
		"damage": {},
	},
	EntityListener: {
		"event": {},
		"tag":   {},
	},
}

// ValidateTypeKeys 校验实体引用的 type key 已声明且 domain 匹配。
func ValidateTypeKeys(keys []string, kind EntityKind, catalog CatalogResult, path string, addError func(code model.GenericErrCode, path, message, ref string)) TypeSet {
	var set TypeSet
	allowed := allowedDomains[kind]
	for i, key := range keys {
		itemPath := path + "[" + itoa(i) + "]"
		if key == "" {
			addError(model.GenericErrMissingRequiredField, itemPath, "type key is empty", "")
			continue
		}
		id, ok := catalog.Registry.Lookup(key)
		if !ok {
			addError(model.GenericErrUnknownTypeKey, itemPath, "unknown type key", key)
			continue
		}
		domain := catalog.Domains[id]
		if _, domainOK := allowed[domain]; !domainOK {
			addError(model.GenericErrMatcherDomainError, itemPath, "type domain not allowed for entity", key)
			continue
		}
		set.Add(id)
	}
	return set
}

// CompileGenericMatcher 编译 canonical TypeMatcher，并按实体类别校验 domain。
func CompileGenericMatcher(input model.TypeMatcher, catalog CatalogResult, kind EntityKind, path string, addError func(code model.GenericErrCode, path, message, ref string)) Matcher {
	legacy := model.TypeMatcherV2{Any: input.Any, All: input.All, None: input.None}
	matcher, problems := CompileMatcher(legacy, catalog.Registry)
	for _, problem := range problems {
		addError(model.GenericErrUnknownTypeKey, path, problem, "")
	}
	validateMatcherTypeDomains(input, catalog, kind, path, addError)
	return matcher
}

func validateMatcherTypeDomains(input model.TypeMatcher, catalog CatalogResult, kind EntityKind, path string, addError func(code model.GenericErrCode, path, message, ref string)) {
	allowed := allowedDomains[kind]
	checkKeys := func(keys []string, suffix string) {
		for i, key := range keys {
			if key == "" {
				continue
			}
			id, ok := catalog.Registry.Lookup(key)
			if !ok {
				continue
			}
			domain := catalog.Domains[id]
			if _, domainOK := allowed[domain]; !domainOK {
				addError(model.GenericErrMatcherDomainError, path+suffix+"["+itoa(i)+"]", "type domain not allowed for matcher", key)
			}
		}
	}
	checkKeys(input.Any, ".any")
	checkKeys(input.All, ".all")
	checkKeys(input.None, ".none")
}

func itoa(v int) string {
	if v == 0 {
		return "0"
	}
	var buf [12]byte
	pos := len(buf)
	n := v
	for n > 0 {
		pos--
		buf[pos] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[pos:])
}
