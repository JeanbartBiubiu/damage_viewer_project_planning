package runtime

import (
	"math"
	"strings"

	"tinygo_engine_v2/internal/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
)

type attributeMemoField uint8

const (
	memoFieldUnknown attributeMemoField = iota
	memoFieldBase
	memoFieldCurrent
	memoFieldMax
	memoFieldResolved
	memoFieldPresence
)

func memoReadField(field string) attributeMemoField {
	switch field {
	case "base":
		return memoFieldBase
	case "current":
		return memoFieldCurrent
	case "max":
		return memoFieldMax
	case "resolved":
		return memoFieldResolved
	case "presence":
		return memoFieldPresence
	}
	return memoFieldUnknown
}

type attributeMemoRead struct {
	kind                 formula.GenericReadKind
	key, owner, provider string
	field                attributeMemoField
	authoredTarget       bool
	attributeIndex       int
	attributeIndexBound  bool
	providerIndex        int
}
type attributeMemoValue struct {
	index          int
	base, resolved uint64
	inputResolved  uint64
	presence       uint8
	multiplyInput  bool
}
type attributeMemoStamp struct {
	value, fallback uint64
	presence        uint8
}
type attributeMemo struct {
	resolver                 pipeline.AttributeResolver
	reads                    []attributeMemoRead
	values                   []attributeMemoValue
	stamps, scratch          []attributeMemoStamp
	cacheable, valid, strict bool
	derived                  bool
	derivedInputs            map[string]bool
	derivedSlots             []uint8
	derivedLayout            *attribute.Layout
	hpIndex                  int
	shape, input, output     attribute.Table
	pages                    []attributeMemoPage
	providers                []attributeMemoProvider
	providerValues           []attributeMemoProviderValues
	probeSource, probeTarget attribute.Table
	probeValid, probeStrict  bool
}

type attributeMemoPage struct {
	page, first, last int
	allInputsPresent  bool
	resolvedMask      uint8
}

type attributeMemoProvider struct{ owner, ref string }

type attributeMemoProviderValues struct {
	state, target, defaults map[string]float64
	present                 bool
}

func (m *attributeMemo) sameKeys(attrs attribute.Table) bool {
	return m.shape.SameShape(attrs)
}

func attributePresence(slot model.AttributeSlotDef) uint8 {
	var mask uint8
	if slot.HasBase() {
		mask |= 1
	}
	if slot.HasCurrent() {
		mask |= 2
	}
	if slot.HasMax() {
		mask |= 4
	}
	if slot.HasResolved() {
		mask |= 8
	}
	return mask
}

func (s *genericRunState) attributeMemo(actor string, derived bool, batch bool, context [2]string, resolver pipeline.AttributeResolver, attrs attribute.Table) *attributeMemo {
	// 编号对应实际双方身份，与编译输入的排列无关。批量缓存仅供正向双方结算。
	var cached **attributeMemo
	actorIndex := -1
	switch actor {
	case model.SelectorSource:
		actorIndex = 0
	case model.SelectorTarget:
		actorIndex = 1
	}
	if actorIndex >= 0 {
		if !batch && context == [2]string{} {
			mode := 0
			if derived {
				mode = 1
			}
			cached = &s.attributeMemos[actorIndex][mode]
		} else if derived && batch && context == [2]string{model.SelectorSource, model.SelectorTarget} {
			cached = &s.attributeMemos[actorIndex][2]
		}
	}
	if cached != nil && *cached != nil && (*cached).resolver.SameMounts(resolver) && (*cached).sameKeys(attrs) {
		memo := *cached
		return memo
	}
	memo := &attributeMemo{resolver: resolver, cacheable: true, derived: derived && !batch, shape: attrs, hpIndex: attrs.Layout().HPIndex()}
	if memo.derived {
		memo.derivedInputs = make(map[string]bool)
		for _, derivation := range s.compiled.AttributeDerivations {
			if derivation.CombatantKey == actor {
				memo.derivedInputs[derivation.AttributeKey] = derivation.ValuePolicy == "multiply"
			}
		}
	}
	providerIndices := make(map[attributeMemoProvider]int)
	add := func(program formula.GenericProgramID, owner, provider string, authoredTarget bool) {
		reads, supported := s.formulas.AttributeCacheDependencies(program)
		if !supported {
			memo.cacheable = false
			return
		}
		for _, read := range reads {
			item := attributeMemoRead{kind: read.ReadKind, key: read.ReadKey, owner: owner, provider: provider, authoredTarget: authoredTarget && read.AuthoredRead, providerIndex: -1}
			if index, exists := providerIndices[attributeMemoProvider{owner, provider}]; exists {
				item.providerIndex = index
			}
			if read.ReadKind == formula.ReadSourceAttr || read.ReadKind == formula.ReadTargetAttr {
				var field string
				item.key, field, _ = strings.Cut(read.ReadKey, ".")
				if field == "" {
					field = "resolved"
				}
				item.field = memoReadField(field)
				if item.field == memoFieldUnknown {
					memo.cacheable = false
				}
				item.attributeIndex = read.AttrIndex
				item.attributeIndexBound = read.AttrIndexBound && read.AttrKey == item.key && read.AttrField == field
			}
			memo.reads = append(memo.reads, item)
		}
	}
	for _, mod := range resolver.MountedModifiers() {
		_, present := attrs.Lookup(mod.AttributeKey)
		used := !derived || batch
		if derived && !batch {
			for _, d := range s.compiled.AttributeDerivations {
				if d.CombatantKey == actor && d.AttributeKey == mod.AttributeKey && d.ValuePolicy == "set" {
					used = true
				}
			}
		}
		if mod.HasValue && present && used {
			provider := attributeMemoProvider{mod.OwnerCombatantKey, mod.ProviderRef}
			if _, exists := providerIndices[provider]; !exists {
				providerIndices[provider] = len(memo.providers)
				memo.providers = append(memo.providers, provider)
			}
			add(mod.ValueProgram, mod.OwnerCombatantKey, mod.ProviderRef, false)
		}
	}
	if derived {
		for _, d := range s.compiled.AttributeDerivations {
			if d.CombatantKey == actor {
				add(d.ValueProgram, "", "", actor == "target")
			}
		}
	}
	memo.stamps = make([]attributeMemoStamp, len(memo.reads))
	memo.scratch = make([]attributeMemoStamp, len(memo.reads))
	memo.providerValues = make([]attributeMemoProviderValues, len(memo.providers))
	if cached != nil {
		*cached = memo
	}
	return memo
}

// probe只比较数值依赖；不复用旧属性表，生命、上限和字段存在性不会回滚。
// 供值状态读取仍先沿原上下文入口执行惰性过期。
func (m *attributeMemo) probe(attrs attribute.Table, ctx *formula.GenericEvalContext, providerContext pipeline.ProviderFormulaContextFunc) bool {
	if !m.cacheable {
		return false
	}
	valueCount := attrs.Len()
	if m.derived {
		valueCount = len(m.derivedInputs)
	}
	matched := m.valid && m.strict == ctx.StrictReads && len(m.values) == valueCount
	if providerContext != nil {
		for index, provider := range m.providers {
			pctx := providerContext(provider.owner, provider.ref)
			m.providerValues[index] = attributeMemoProviderValues{pctx.ProviderState, pctx.ProviderTargetState, pctx.ProviderStateDefaults, pctx.HasProviderContext}
		}
	}
	if matched {
		for _, page := range m.pages {
			if page.allInputsPresent && m.input.SamePage(attrs, page.page) {
				continue
			}
			for _, cached := range m.values[page.first:page.last] {
				slot, exists := attrs.LookupIndex(cached.index)
				if !exists || math.Float64bits(slot.Base) != cached.base || attributePresence(slot) != cached.presence || (cached.multiplyInput && math.Float64bits(slot.Resolved) != cached.inputResolved) {
					matched = false
					break
				}
			}
			if !matched {
				break
			}
		}
	}
	for index, read := range m.reads {
		stamp := attributeMemoStamp{}
		switch read.kind {
		case formula.ReadSourceAttr, formula.ReadTargetAttr:
			source, target := ctx.SourceAttrs, ctx.TargetAttrs
			values, previous := source, m.probeSource
			if (read.kind == formula.ReadTargetAttr) != read.authoredTarget {
				values, previous = target, m.probeTarget
			}
			var slot model.AttributeSlotDef
			var exists bool
			if read.attributeIndexBound && values.Layout().Key(read.attributeIndex) == read.key {
				if m.probeValid && m.probeStrict == ctx.StrictReads && previous.SamePage(values, read.attributeIndex/attribute.PageSize) {
					stamp = m.scratch[index]
					break
				}
				slot, exists = values.LookupIndex(read.attributeIndex)
			} else {
				slot, exists = values.Lookup(read.key)
			}
			if exists {
				stamp.presence = 16 | attributePresence(slot)
			}
			switch read.field {
			case memoFieldBase:
				stamp.value = math.Float64bits(slot.Base)
			case memoFieldCurrent:
				stamp.value = math.Float64bits(slot.Current)
			case memoFieldMax:
				stamp.value = math.Float64bits(slot.Max)
			case memoFieldResolved:
				stamp.value = math.Float64bits(slot.Resolved)
				if !ctx.StrictReads && slot.Resolved == 0 {
					stamp.fallback = math.Float64bits(slot.Current)
				}
			}
		case formula.ReadProviderState, formula.ReadProviderTargetState:
			if providerContext == nil {
				matched = false
				break
			}
			var pctx attributeMemoProviderValues
			if read.providerIndex >= 0 && read.providerIndex < len(m.providerValues) {
				pctx = m.providerValues[read.providerIndex]
			}
			if pctx.present {
				stamp.presence |= 1
			}
			values := pctx.state
			if read.kind == formula.ReadProviderTargetState {
				values = pctx.target
			}
			value, exists := values[read.key]
			if exists {
				stamp.presence |= 2
			}
			stamp.value = math.Float64bits(value)
			fallback, hasDefault := pctx.defaults[read.key]
			if hasDefault {
				stamp.presence |= 4
			}
			stamp.fallback = math.Float64bits(fallback)
		default:
			matched = false
		}
		m.scratch[index] = stamp
		if stamp != m.stamps[index] {
			matched = false
		}
	}
	// 最近一次完整探测的签名独立于成功求值的stamps，失败也不会成为成功缓存。
	m.probeSource, m.probeTarget = ctx.SourceAttrs, ctx.TargetAttrs
	m.probeStrict, m.probeValid = ctx.StrictReads, true
	return matched
}

func (m *attributeMemo) apply(attrs attribute.Table) attribute.Table {
	out := attrs.Edit()
	for _, page := range m.pages {
		if m.output.SamePage(attrs, page.page) {
			continue
		}
		if out.ReuseResolvedPage(m.output, page.page, page.resolvedMask) {
			continue
		}
		for _, cached := range m.values[page.first:page.last] {
			slot, exists := out.LookupIndex(cached.index)
			if exists && math.Float64bits(slot.Resolved) == cached.resolved {
				continue
			}
			slot.Resolved = math.Float64frombits(cached.resolved)
			out.SetIndex(cached.index, slot)
		}
	}
	return out.Finish()
}

func (m *attributeMemo) outputsMatch(attrs attribute.Table) bool {
	for _, page := range m.pages {
		if m.output.SamePage(attrs, page.page) {
			continue
		}
		for _, cached := range m.values[page.first:page.last] {
			if cached.index != m.hpIndex && math.Float64bits(attrs.AtIndex(cached.index).Resolved) != cached.resolved {
				return false
			}
		}
	}
	return true
}

func (m *attributeMemo) remember(input, result attribute.Table, strict bool) {
	if !m.cacheable {
		return
	}
	m.values = m.values[:0]
	m.pages = m.pages[:0]
	m.hpIndex = result.Layout().HPIndex()
	if m.derived && result.Layout() != m.derivedLayout {
		m.derivedLayout = result.Layout()
		m.derivedSlots = make([]uint8, result.Layout().Len())
		for key, multiply := range m.derivedInputs {
			if index, exists := result.Layout().Lookup(key); exists {
				m.derivedSlots[index] = 1
				if multiply {
					m.derivedSlots[index] |= 2
				}
			}
		}
	}
	sameLayout := input.Layout() == result.Layout()
	result.RangeIndex(func(index int, slot model.AttributeSlotDef) bool {
		var flags uint8
		if m.derived {
			flags = m.derivedSlots[index]
			if flags&1 == 0 {
				return true
			}
		}
		var original model.AttributeSlotDef
		var exists bool
		if sameLayout || input.Layout().Key(index) == result.Layout().Key(index) {
			original, exists = input.LookupIndex(index)
		} else {
			original, exists = input.Lookup(result.Layout().Key(index))
		}
		page := index / attribute.PageSize
		if len(m.pages) == 0 || m.pages[len(m.pages)-1].page != page {
			m.pages = append(m.pages, attributeMemoPage{page: page, first: len(m.values), last: len(m.values), allInputsPresent: true})
		}
		if !exists {
			m.pages[len(m.pages)-1].allInputsPresent = false
		}
		m.values = append(m.values, attributeMemoValue{index: index, base: math.Float64bits(original.Base), resolved: math.Float64bits(slot.Resolved), inputResolved: math.Float64bits(original.Resolved), presence: attributePresence(original), multiplyInput: flags&2 != 0})
		m.pages[len(m.pages)-1].resolvedMask |= 1 << uint(index%attribute.PageSize)
		m.pages[len(m.pages)-1].last = len(m.values)
		return true
	})
	m.input, m.output = input, result
	copy(m.stamps, m.scratch)
	m.strict, m.valid = strict, true
}

func (s *genericRunState) resolveOrdinaryAttributes(actor string, attrs attribute.Table, resolver pipeline.AttributeResolver, ctx formula.GenericEvalContext, providerContext pipeline.ProviderFormulaContextFunc) (attribute.Table, error) {
	memo := s.attributeMemo(actor, false, false, [2]string{}, resolver, attrs)
	if memo.probe(attrs, &ctx, providerContext) {
		return memo.apply(attrs), nil
	}
	resolved, err := resolver.ResolveAttributesWithProviderContext(attrs, ctx, s.formulas, providerContext)
	if err == nil {
		memo.remember(attrs, resolved, ctx.StrictReads)
	}
	return resolved, err
}

func (s *genericRunState) resolveDerivedAttributesCached(actor string, attrs attribute.Table, resolver pipeline.AttributeResolver, source, target attribute.Table, providerContext pipeline.ProviderFormulaContextFunc) (attribute.Table, error) {
	memo := s.attributeMemo(actor, true, false, [2]string{}, resolver, attrs)
	ctx := formula.GenericEvalContext{StrictReads: true, SourceAttrs: source, TargetAttrs: target}
	if actor == "source" {
		ctx.SourceAttrs = attrs
	} else {
		ctx.TargetAttrs = attrs
	}
	if memo.probe(attrs, &ctx, providerContext) {
		return memo.apply(attrs), nil
	}
	resolved, err := resolveDerivedAttributes(s.compiled, s.formulas, actor, attrs, resolver, source, target, providerContext)
	if err == nil {
		memo.remember(attrs, resolved, true)
	}
	return resolved, err
}

// refreshMemo只跳过已有结果仍有效的整轮结算。依赖签名来自结算前，
// 因而尚未稳定的跨属性读取仍会继续原来的两遍，不改变求值顺序。
func (f *executionFrame) refreshMemo(abilityCtx formula.GenericEvalContext) ([2]*attributeMemo, [2]attribute.Table, bool) {
	var memos [2]*attributeMemo
	var inputs [2]attribute.Table
	// 反向和自身行动的派生补算会另用全局双方上下文；无法完整证明
	// 两种上下文的依赖均未变化时，继续执行原两遍路径及其错误检查。
	if f.sourceKey != "source" || f.targetKey != "target" {
		return memos, inputs, false
	}
	matched := true
	for index, actor := range []string{f.sourceKey, f.targetKey} {
		host := f.stageFor(actor)
		inputs[index] = host.attributes
		memo := f.run.attributeMemo(actor, true, true, [2]string{f.sourceKey, f.targetKey}, host.resolver, host.attributes)
		memos[index] = memo
		if !memo.probe(host.attributes, &abilityCtx, f.providerFormulaContextFunc(actor)) {
			matched = false
		}
		if !memo.outputsMatch(host.attributes) {
			matched = false
		}
	}
	return memos, inputs, matched
}
