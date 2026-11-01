package hit

import (
	"sort"
	"strconv"
	"strings"
	"tinygo_engine_v2/internal/model"
)

const (
	MaxUsesPerRun      = 256
	MaxFactsPerRun     = 1024
	MaxHistoryContacts = 4096
	MaxLedgerUnits     = 1024
	MaxOccurrences     = 4096
)

// Identity 指定真实运行的错误归属，不包含执行器或行动状态。
type Identity struct{ SchemaHash, RulesHash, SessionID string }

// DriverBinding 是父层按原驱动解析所得的只读能力事实；序号与驱动数组一致。
type DriverBinding struct {
	HasSkillHit bool
	SkillKey    string
	WhileReady  bool
}

// StateAPI 定义本场命中事实、首接触与判盾账能力，实际命中执行及帧提交仍由父层负责。
type StateAPI interface {
	// Initialize 核对原使用和命中输入并建立分组；只在本场初始化阶段调用，不创建行动身份。
	Initialize(uses []model.SkillUseFact, facts []model.SkillHitFact, entries []model.DriverEntry, bindings []DriverBinding, identity Identity) *model.EngineError
	// Fact 返回实际驱动对应的事实值；其中使用和序号引用只读借用，不可改写请求数据。
	Fact(entryKey string) (model.SkillHitFact, bool)
	// PutFact 登记父层已接受真实行动产生的临时命中事实，不改变原行动接纳条件。
	PutFact(entryKey string, fact model.SkillHitFact)
	// RemoveFact 移除同步执行完毕的临时命中事实，不清理历史或判盾账。
	RemoveFact(entryKey string)
	// ValidateAttackStartOrder 只读核对每项真实普攻开始先于其对应命中，按原毫秒、优先级和数组序号解释顺序。
	ValidateAttackStartOrder(starts map[string]model.AttackStartFact, entries []model.DriverEntry, identity Identity) *model.EngineError
	// NextOccurrence 在原尝试时点检查本场命中预算并递增序号；预算用尽时不改变序号。
	NextOccurrence(maxEvents int) (uint64, bool)
	// OccurrenceCount 返回本场已接受命中尝试的完整序号，不依赖明细保留。
	OccurrenceCount() uint64
	// FirstContact 依据显式历史与同刻分组取得首接触资格，未知顺序在首次到达时冻结。
	FirstContact(entryKey, useRef, historyState string, history *History, at int64) (bool, float64)
	// BlockUnit 返回该真实使用已冻结的技能范围判盾值，不借出可写账本。
	BlockUnit(useRef string) (BlockUnit, bool)
	// StoreBlockUnit 在原判盾登记时点保存独立范围值，容量耗尽返回原错误。
	StoreBlockUnit(useRef string, unit BlockUnit, identity Identity) *model.EngineError
}

// State 私有持有本场命中索引、分组、序号与技能范围判盾账，不持有帧或行动对象。
type State struct {
	facts       map[string]model.SkillHitFact
	groups      map[string]*group
	units       map[string]BlockUnit
	occurrences uint64
}

type group struct {
	useRef     string
	firstAtMs  int64
	entryKeys  []string
	knownOrder bool
	started    bool
	frozen     map[string]firstContactDecision
}

type firstContactDecision struct {
	has   bool
	value float64
}

var _ StateAPI = (*State)(nil)

func (s *State) Initialize(uses []model.SkillUseFact, facts []model.SkillHitFact, entries []model.DriverEntry, bindings []DriverBinding, identity Identity) *model.EngineError {
	s.facts = map[string]model.SkillHitFact{}
	s.groups = map[string]*group{}
	s.units = map[string]BlockUnit{}
	if len(uses) > MaxUsesPerRun {
		return hitError(identity, model.GenericErrRuntimeInvariantFailed, "skillUses exceeded run budget", "skillUses", "")
	}
	if len(facts) > MaxFactsPerRun {
		return hitError(identity, model.GenericErrRuntimeInvariantFailed, "skillHitFacts exceeded run budget", "skillHitFacts", "")
	}
	seenUse := map[string]int{}
	for i, use := range uses {
		path := "skillUses[" + strconv.Itoa(i) + "]"
		if strings.TrimSpace(use.UseKey) == "" {
			return hitError(identity, model.GenericErrMissingRequiredField, "skillUses.useKey is required", path+".useKey", "")
		}
		if prev, ok := seenUse[use.UseKey]; ok {
			return hitError(identity, model.GenericErrUnknownRef, "duplicate skillUses.useKey", path+".useKey", use.UseKey+" previously "+strconv.Itoa(prev))
		}
		seenUse[use.UseKey] = i
		if strings.TrimSpace(use.Source) == "" {
			return hitError(identity, model.GenericErrMissingRequiredField, "skillUses.source is required", path+".source", use.UseKey)
		}
		if strings.TrimSpace(use.SkillKey) == "" {
			return hitError(identity, model.GenericErrMissingRequiredField, "skillUses.skillKey is required", path+".skillKey", use.UseKey)
		}
		if use.HistoryState != model.SkillHitHistoryComplete && use.HistoryState != model.SkillHitHistoryUnknown {
			return hitError(identity, model.GenericErrUnknownRef, "skillUses.historyState must be complete or unknown", path+".historyState", use.HistoryState)
		}
		if len(use.PriorQualifiedContacts) > MaxHistoryContacts {
			return hitError(identity, model.GenericErrRuntimeInvariantFailed, "priorQualifiedContacts exceeded run budget", path+".priorQualifiedContacts", use.UseKey)
		}
	}

	hitEntries := map[string]int{}
	for i, entry := range entries {
		if !bindings[i].HasSkillHit {
			continue
		}
		hitEntries[entry.EntryKey] = i
		if entry.Repeat != nil || bindings[i].WhileReady {
			return hitError(identity, model.GenericErrUnknownRef, "resolve_skill_hit driver cannot use Repeat or WhileReady", "driverPlan.entries["+entry.EntryKey+"]", entry.AbilityRef)
		}
		if entry.Source == "" || entry.Target == "" {
			return hitError(identity, model.GenericErrMissingRequiredField, "hit driver requires explicit source and target", "driverPlan.entries["+entry.EntryKey+"]", entry.AbilityRef)
		}
	}

	seenFact := map[string]int{}
	for i, fact := range facts {
		path := "skillHitFacts[" + strconv.Itoa(i) + "]"
		if strings.TrimSpace(fact.DriverEntryKey) == "" {
			return hitError(identity, model.GenericErrMissingRequiredField, "skillHitFacts.driverEntryKey is required", path+".driverEntryKey", "")
		}
		if prev, ok := seenFact[fact.DriverEntryKey]; ok {
			return hitError(identity, model.GenericErrUnknownRef, "duplicate skillHitFacts.driverEntryKey", path+".driverEntryKey", fact.DriverEntryKey+" previously "+strconv.Itoa(prev))
		}
		seenFact[fact.DriverEntryKey] = i
		entryIdx, ok := hitEntries[fact.DriverEntryKey]
		if !ok {
			return hitError(identity, model.GenericErrUnknownRef, "skillHitFact must point to a single-shot resolve_skill_hit driver", path+".driverEntryKey", fact.DriverEntryKey)
		}
		entry := entries[entryIdx]
		if fact.UseRef != nil && *fact.UseRef != "" {
			useIndex, found := seenUse[*fact.UseRef]
			if !found {
				return hitError(identity, model.GenericErrUnknownRef, "skillHitFact.useRef is not a declared skill use", path+".useRef", *fact.UseRef)
			}
			use := uses[useIndex]
			if use.Source != entry.Source {
				return hitError(identity, model.GenericErrUnknownRef, "skill use source must equal the driver source", path+".useRef", *fact.UseRef)
			}
			if use.SkillKey != bindings[entryIdx].SkillKey {
				return hitError(identity, model.GenericErrUnknownRef, "skill use skillKey must equal the hit plan skillKey", path+".useRef", *fact.UseRef)
			}
		}
		if fact.Sequence != nil && *fact.Sequence < 0 {
			return hitError(identity, model.GenericErrUnknownRef, "skillHitFact.sequence must be a non-negative integer", path+".sequence", fact.DriverEntryKey)
		}
		s.facts[fact.DriverEntryKey] = fact
	}
	return s.buildGroups(entries, hitEntries, identity)
}

func (s *State) buildGroups(entries []model.DriverEntry, hitEntries map[string]int, identity Identity) *model.EngineError {
	type groupKey struct {
		use     string
		at      int64
		nullUse bool
	}
	buckets := map[groupKey][]string{}
	for entryKey, fact := range s.facts {
		entry := entries[hitEntries[entryKey]]
		key := groupKey{at: entry.FirstAtMs}
		if fact.UseRef != nil && *fact.UseRef != "" {
			key.use = *fact.UseRef
		} else {
			key.nullUse = true
			key.use = "\x00" + entryKey
		}
		buckets[key] = append(buckets[key], entryKey)
	}
	for key, members := range buckets {
		sort.SliceStable(members, func(i, j int) bool {
			ei := hitEntries[members[i]]
			ej := hitEntries[members[j]]
			pi := entries[ei].Priority
			pj := entries[ej].Priority
			if pi != pj {
				return pi < pj
			}
			return ei < ej
		})
		g := &group{useRef: key.use, firstAtMs: key.at, entryKeys: members, frozen: map[string]firstContactDecision{}}
		if key.nullUse {
			g.knownOrder = false
			s.groups[groupMapKey(key.use, key.at)] = g
			continue
		}
		if len(members) <= 1 {
			g.knownOrder = true
			s.groups[groupMapKey(key.use, key.at)] = g
			continue
		}
		known, err := s.orderKnown(members, g.entryKeys, identity)
		if err != nil {
			return err
		}
		g.knownOrder = known
		s.groups[groupMapKey(key.use, key.at)] = g
	}
	return nil
}

func groupMapKey(use string, at int64) string {
	return use + "\x00" + strconv.FormatInt(at, 10)
}

func (s *State) orderKnown(members, heapOrder []string, identity Identity) (bool, *model.EngineError) {
	seqs := make([]int, 0, len(members))
	missing := 0
	seenSeq := map[int]string{}
	lastProvided := -1
	for _, key := range members {
		fact := s.facts[key]
		if fact.Sequence == nil {
			missing++
			continue
		}
		if prev, ok := seenSeq[*fact.Sequence]; ok {
			return false, hitError(identity, model.GenericErrUnknownRef, "duplicate skillHitFact.sequence in same-use same-time group", "skillHitFacts.sequence", key+" conflicts "+prev)
		}
		seenSeq[*fact.Sequence] = key
		if *fact.Sequence <= lastProvided {
			return false, hitError(identity, model.GenericErrUnknownRef, "provided sequence contradicts relative heap order", "skillHitFacts.sequence", key)
		}
		lastProvided = *fact.Sequence
		seqs = append(seqs, *fact.Sequence)
	}
	if missing > 0 {
		return false, nil
	}
	bySeq := append([]string(nil), members...)
	sort.SliceStable(bySeq, func(i, j int) bool {
		return *s.facts[bySeq[i]].Sequence < *s.facts[bySeq[j]].Sequence
	})
	for i := range heapOrder {
		if bySeq[i] != heapOrder[i] {
			return false, hitError(identity, model.GenericErrUnknownRef, "skillHitFact.sequence contradicts heap order (priority then driver entries index)", "skillHitFacts.sequence", bySeq[i])
		}
	}
	return true, nil
}

func (s *State) Fact(entryKey string) (model.SkillHitFact, bool) {
	fact, exists := s.facts[entryKey]
	return fact, exists
}

func (s *State) PutFact(entryKey string, fact model.SkillHitFact) {
	if s.facts == nil {
		s.facts = make(map[string]model.SkillHitFact)
	}
	s.facts[entryKey] = fact
}

func (s *State) RemoveFact(entryKey string) { delete(s.facts, entryKey) }

func (s *State) NextOccurrence(maxEvents int) (uint64, bool) {
	limit := maxEvents
	if limit <= 0 || limit < 256 {
		limit = 256
	}
	if limit > MaxOccurrences {
		limit = MaxOccurrences
	}
	if int(s.occurrences) >= limit {
		return 0, false
	}
	s.occurrences++
	return s.occurrences, true
}

func (s *State) OccurrenceCount() uint64 { return s.occurrences }

func (s *State) FirstContact(entryKey, useRef, historyState string, history *History, at int64) (bool, float64) {
	if useRef == "" || history == nil || historyState == model.SkillHitHistoryUnknown {
		return false, 0
	}
	g := s.groups[groupMapKey(useRef, at)]
	hasPriorContact := history.TotalCount() > 0
	if g == nil {
		if hasPriorContact {
			return true, 0
		}
		return true, 1
	}
	if !g.knownOrder {
		if !g.started {
			g.started = true
			for _, key := range g.entryKeys {
				if hasPriorContact {
					g.frozen[key] = firstContactDecision{has: true, value: 0}
				} else {
					g.frozen[key] = firstContactDecision{has: false}
				}
			}
		}
		decision := g.frozen[entryKey]
		return decision.has, decision.value
	}
	if hasPriorContact {
		return true, 0
	}
	return true, 1
}

func (s *State) BlockUnit(useRef string) (BlockUnit, bool) {
	unit, exists := s.units[useRef]
	return unit, exists
}

func (s *State) StoreBlockUnit(useRef string, unit BlockUnit, identity Identity) *model.EngineError {
	if len(s.units) >= MaxLedgerUnits {
		return hitError(identity, model.GenericErrRuntimeInvariantFailed, "SKILL ledger exceeded run budget", "skillUses", useRef)
	}
	if s.units == nil {
		s.units = make(map[string]BlockUnit)
	}
	s.units[useRef] = unit
	return nil
}

func hitError(identity Identity, code model.GenericErrCode, message, path, ref string) *model.EngineError {
	err := model.NewEngineError(model.GenericPhaseRun, code, message)
	err.Path, err.Ref = path, ref
	err.SchemaHash, err.RulesHash, err.SessionID = identity.SchemaHash, identity.RulesHash, identity.SessionID
	return &err
}
