package execution

func (s *Engine) mintCastInstanceID() uint64 {
	s.nextCastInstanceID++
	return s.nextCastInstanceID
}

func attachCastProvenance(data map[string]interface{}, castInstanceID uint64, castOrigin string) {
	if castInstanceID > 0 {
		data["castInstanceId"] = float64(castInstanceID)
	}
	if castOrigin != "" {
		data["castOrigin"] = castOrigin
	}
}

func (f *Frame) appendCastOriginEventType(types []string) []string {
	if f == nil || f.castOrigin == "" || f.run == nil {
		return types
	}
	key := "cast_origin/" + f.castOrigin
	if _, ok := f.run.compiled.Types.Registry.LookupDomain("cast_origin", key); !ok {
		return types
	}
	for _, existing := range types {
		if existing == key {
			return types
		}
	}
	return append(types, key)
}
