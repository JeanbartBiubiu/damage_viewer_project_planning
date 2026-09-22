package formula

import (
	"errors"
	"strings"
	"tinygo_engine_v2/internal/model"
)

// 严格读取不把缺值变成零，也不把合法的 Resolved=0 回退为 Current。
func readAttrValueChecked(attrs map[string]model.AttributeSlotDef, key string, strict bool) (float64, error) {
	if !strict {
		return readAttrValue(attrs, key), nil
	}
	attrKey, suffix := key, "resolved"
	if i := strings.LastIndex(key, "."); i > 0 {
		attrKey, suffix = key[:i], key[i+1:]
	}
	slot, ok := attrs[attrKey]
	if !ok {
		return 0, errors.New("missing attribute: " + attrKey)
	}
	switch suffix {
	case "resolved":
		return slot.Resolved, nil
	case "base":
		return slot.Base, nil
	case "current":
		return slot.Current, nil
	case "max":
		return slot.Max, nil
	default:
		return 0, errors.New("unsupported attribute field: " + key)
	}
}
