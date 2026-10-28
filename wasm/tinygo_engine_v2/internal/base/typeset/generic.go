package typeset

import "tinygo_engine_v2/internal/model"

const maxRelationDepth = 2

// CatalogResult 是 type catalog 编译结果。
type CatalogResult struct {
	Registry Registry
	Domains  map[TypeID]string
}

// EntityKind 标识 matcher domain 校验的实体类别。
type EntityKind int

// CompileTypeCatalog 将 TypeCatalog 编译为 flat registry，并校验 domain/relation。
func CompileTypeCatalog(catalog model.TypeCatalog, addError func(code model.GenericErrCode, path, message, ref string)) CatalogResult {
	result := CatalogResult{
		Registry: NewRegistry(),
		Domains:  make(map[TypeID]string),
	}
	seen := make(map[typeIdentity]struct{}, len(catalog.Types))
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
		identity := typeIdentity{entry.Domain, entry.Key}
		if _, exists := seen[identity]; exists {
			addError(model.GenericErrUnknownTypeKey, path+".key", "duplicate type key", entry.Key)
			continue
		}
		seen[identity] = struct{}{}
		id, ok := result.Registry.InternScoped(entry.Domain, entry.Key)
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

const (
	EntityCombatant EntityKind = iota
	EntityProvider
	EntityAbility
	EntityOperationDamageType
	EntityOperationDamageTrait
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
	EntityOperationDamageTrait: {
		"damage_trait": {},
	},
	EntityListener: {
		"event":        {},
		"tag":          {},
		"ability":      {},
		"damage":       {},
		"damage_trait": {},
		"cast_origin":  {},
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
		id, ok := catalog.LookupForEntity(key, kind)
		if !ok {
			if _, known := catalog.Registry.Lookup(key); known {
				addError(model.GenericErrMatcherDomainError, itemPath, "type domain not allowed for entity", key)
				continue
			}
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
	return Matcher{any: ValidateTypeKeys(input.Any, kind, catalog, path+".any", addError), all: ValidateTypeKeys(input.All, kind, catalog, path+".all", addError), none: ValidateTypeKeys(input.None, kind, catalog, path+".none", addError), hasAny: len(input.Any) > 0}
}

// 单键引用只在本使用点的允许作用域中选唯一身份；多个允许身份明确拒绝。
func (catalog CatalogResult) LookupForEntity(key string, kind EntityKind) (TypeID, bool) {
	allowed := allowedDomains[kind]
	found, count := TypeID(0), 0
	for i, candidate := range catalog.Registry.Keys {
		if candidate != key {
			continue
		}
		if _, allowedDomain := allowed[catalog.Domains[TypeID(i)]]; allowedDomain {
			found = TypeID(i)
			count++
		}
	}
	return found, count == 1
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
