package admission

import (
	"strconv"
	"strings"

	"tinygo_engine_v2/internal/model"
)

// AttackStartDriver 借用原驱动及其已解析能力的有限绑定，不包含能力执行或命中状态。
type AttackStartDriver struct {
	Entry                      model.DriverEntry
	AbilityResolved            bool
	HasSkillHit, IsBasicAttack bool
	OperationCount             uint16
	SkillKey                   string
	WhileReady                 bool
}

// AttackStartUse 是已登记真实使用的来源和技能身份，不创建或修改使用。
type AttackStartUse struct {
	Source, SkillKey string
}

// AttackStartInput 只提供冷初始化所需的事实、编译绑定、原限制和错误身份。
type AttackStartInput struct {
	Facts             []model.AttackStartFact
	Drivers           []AttackStartDriver
	Uses              map[string]AttackStartUse
	HasStartEventType bool
	MaxFacts          int
	Identity          Identity
}

// ValidateAttackStartFacts 按原序核对每项开始事实，并返回已接受的前序事实。
// 超出原专用限制时返回空映射引用；其余失败返回当前部分结果，供根层保持原登记边界。
// 开始相对命中的顺序仍由原命中所有者在本检查成功后核对。
func ValidateAttackStartFacts(input AttackStartInput) (map[string]model.AttackStartFact, *model.EngineError) {
	if len(input.Facts) > input.MaxFacts {
		return nil, attackStartError(input.Identity, model.GenericErrRuntimeInvariantFailed, "attackStartFacts exceeded dedicated budget", "attackStartFacts", "")
	}
	accepted := map[string]model.AttackStartFact{}
	seenEntry := map[string]int{}
	seenUse := map[string]int{}
	startEntries := map[string]int{}
	for i, driver := range input.Drivers {
		if !driver.AbilityResolved || driver.HasSkillHit || !driver.IsBasicAttack || driver.OperationCount != 0 {
			continue
		}
		startEntries[driver.Entry.EntryKey] = i
	}
	for i, fact := range input.Facts {
		path := "attackStartFacts[" + strconv.Itoa(i) + "]"
		if strings.TrimSpace(fact.DriverEntryKey) == "" {
			return accepted, attackStartError(input.Identity, model.GenericErrMissingRequiredField, "attackStartFacts.driverEntryKey is required", path+".driverEntryKey", "")
		}
		if prev, ok := seenEntry[fact.DriverEntryKey]; ok {
			return accepted, attackStartError(input.Identity, model.GenericErrUnknownRef, "duplicate attackStartFacts.driverEntryKey", path+".driverEntryKey", fact.DriverEntryKey+" previously "+strconv.Itoa(prev))
		}
		seenEntry[fact.DriverEntryKey] = i
		entryIdx, ok := startEntries[fact.DriverEntryKey]
		if !ok {
			return accepted, attackStartError(input.Identity, model.GenericErrUnknownRef, "attackStartFact must point to a single empty-operations basic_attack start driver", path+".driverEntryKey", fact.DriverEntryKey)
		}
		driver := input.Drivers[entryIdx]
		entry := driver.Entry
		if entry.Repeat != nil || driver.WhileReady {
			return accepted, attackStartError(input.Identity, model.GenericErrUnknownRef, "attack start driver cannot use Repeat or WhileReady", "driverPlan.entries["+entry.EntryKey+"]", entry.AbilityRef)
		}
		if driver.HasSkillHit {
			return accepted, attackStartError(input.Identity, model.GenericErrUnknownRef, "attackStartFact cannot point to resolve_skill_hit", path+".driverEntryKey", fact.DriverEntryKey)
		}
		if strings.TrimSpace(fact.UseRef) == "" {
			return accepted, attackStartError(input.Identity, model.GenericErrMissingRequiredField, "attackStartFacts.useRef is required", path+".useRef", fact.DriverEntryKey)
		}
		use, found := input.Uses[fact.UseRef]
		if !found {
			return accepted, attackStartError(input.Identity, model.GenericErrUnknownRef, "attackStartFact.useRef is not a declared skill use", path+".useRef", fact.UseRef)
		}
		if prev, ok := seenUse[fact.UseRef]; ok {
			return accepted, attackStartError(input.Identity, model.GenericErrUnknownRef, "duplicate attack start for the same use", path+".useRef", fact.UseRef+" previously "+strconv.Itoa(prev))
		}
		seenUse[fact.UseRef] = i
		if use.Source != entry.Source {
			return accepted, attackStartError(input.Identity, model.GenericErrUnknownRef, "attack start use source must equal the driver source", path+".useRef", fact.UseRef)
		}
		if strings.TrimSpace(driver.SkillKey) == "" {
			return accepted, attackStartError(input.Identity, model.GenericErrMissingRequiredField, "attack start ability requires skillKey", "driverPlan.entries["+entry.EntryKey+"]", entry.AbilityRef)
		}
		if use.SkillKey != driver.SkillKey {
			return accepted, attackStartError(input.Identity, model.GenericErrUnknownRef, "attack start skillKey must equal skillUses.skillKey", path+".useRef", fact.UseRef)
		}
		if !input.HasStartEventType {
			return accepted, attackStartError(input.Identity, model.GenericErrUnknownTypeKey, "attack start requires event/basic_attack_start in typeCatalog", path, model.EventTypeBasicAttackStart)
		}
		accepted[fact.DriverEntryKey] = fact
	}
	return accepted, nil
}

func attackStartError(identity Identity, code model.GenericErrCode, message, path, ref string) *model.EngineError {
	out := model.NewEngineError(model.GenericPhaseRun, code, message)
	out.Path, out.Ref = path, ref
	out.SchemaHash, out.RulesHash, out.SessionID = identity.SchemaHash, identity.RulesHash, identity.SessionID
	return &out
}
