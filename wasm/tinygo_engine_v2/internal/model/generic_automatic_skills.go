package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"strings"
)

const (
	MaxAutomaticSkillRules          = 16
	DefaultMaxAutomaticSkillRecords = 1000
	MaxAutomaticSkillRecords        = 4096
)

// 自动计划只选择已编译技能，不接受任意能力引用或控制阶段。
type AutomaticSkillPlan struct {
	Rules []AutomaticSkillRule `json:"rules"`
}

type AutomaticSkillRule struct {
	RuleKey             string                 `json:"ruleKey"`
	BindingKey          string                 `json:"bindingKey"`
	SortOrder           int                    `json:"sortOrder"`
	Target              string                 `json:"target"`
	HitBindings         []SkillActionHitPreset `json:"hitBindings"`
	WaitForCooldowns    []string               `json:"waitForCooldowns"`
	ReleaseAfterRuleKey *string                `json:"releaseAfterRuleKey"`
}

type AutomaticSkillWaiting struct {
	Reason          string   `json:"reason"`
	RelatedRuleKeys []string `json:"relatedRuleKeys"`
	NextCheckAtMs   *int64   `json:"nextCheckAtMs"`
}

type AutomaticSkillRuleSummary struct {
	RuleKey                 string                 `json:"ruleKey"`
	AttemptCount            int                    `json:"attemptCount"`
	StartedCount            int                    `json:"startedCount"`
	RejectedCount           int                    `json:"rejectedCount"`
	AbortedBeforeStartCount int                    `json:"abortedBeforeStartCount"`
	CompletedCount          int                    `json:"completedCount"`
	FailedCount             int                    `json:"failedCount"`
	InFlightCount           int                    `json:"inFlightCount"`
	Waiting                 *AutomaticSkillWaiting `json:"waiting"`
}

type AutomaticSkillQualification struct {
	GrantorRuleKey    string  `json:"grantorRuleKey"`
	ConsumerRuleKey   string  `json:"consumerRuleKey"`
	GrantedCount      int     `json:"grantedCount"`
	ConsumedCount     int     `json:"consumedCount"`
	RemainingCount    int     `json:"remainingCount"`
	LastGrantUseRef   *string `json:"lastGrantUseRef"`
	LastConsumeUseRef *string `json:"lastConsumeUseRef"`
}

type AutomaticSkillSummary struct {
	RuleCount               int                           `json:"ruleCount"`
	AttemptCount            int                           `json:"attemptCount"`
	StartedCount            int                           `json:"startedCount"`
	RejectedCount           int                           `json:"rejectedCount"`
	AbortedBeforeStartCount int                           `json:"abortedBeforeStartCount"`
	CompletedCount          int                           `json:"completedCount"`
	FailedCount             int                           `json:"failedCount"`
	InFlightCount           int                           `json:"inFlightCount"`
	Rules                   []AutomaticSkillRuleSummary   `json:"rules"`
	Qualifications          []AutomaticSkillQualification `json:"qualifications"`
}

type AutomaticSkillRecord struct {
	Sequence       int64   `json:"sequence"`
	TimeMs         int64   `json:"timeMs"`
	Kind           string  `json:"kind"`
	RuleKey        string  `json:"ruleKey"`
	UseRef         *string `json:"useRef"`
	RelatedRuleKey *string `json:"relatedRuleKey"`
	RelatedUseRef  *string `json:"relatedUseRef"`
	Reason         *string `json:"reason"`
	NextCheckAtMs  *int64  `json:"nextCheckAtMs"`
}

type AutomaticSkillRecording struct {
	TotalCount    int  `json:"totalCount"`
	ReturnedCount int  `json:"returnedCount"`
	OmittedCount  int  `json:"omittedCount"`
	DroppedCount  int  `json:"droppedCount"`
	Truncated     bool `json:"truncated"`
}

func (value *AutomaticSkillPlan) UnmarshalJSON(data []byte) error {
	if err := automaticJSONShape(data, "driverPlan.automaticSkills", "rules", ""); err != nil {
		return err
	}
	type plain AutomaticSkillPlan
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	plan := AutomaticSkillPlan(decoded)
	if err := plan.Validate(); err != nil {
		return err
	}
	*value = plan
	return nil
}

func (value *AutomaticSkillRule) UnmarshalJSON(data []byte) error {
	const fields = "ruleKey bindingKey sortOrder target hitBindings waitForCooldowns releaseAfterRuleKey"
	if err := automaticJSONShape(data, "AutomaticSkillRule", fields, "releaseAfterRuleKey"); err != nil {
		return err
	}
	type plain AutomaticSkillRule
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*value = AutomaticSkillRule(decoded)
	return nil
}

// Validate也供直接构造请求的原生入口复用；编译绑定及本次关系引用由运行入口核对。
func (value AutomaticSkillPlan) Validate() error {
	const path = "driverPlan.automaticSkills.rules"
	if len(value.Rules) < 1 || len(value.Rules) > MaxAutomaticSkillRules {
		return errors.New(path + " must contain 1 to 16 rules")
	}
	keys, bindings, orders := map[string]bool{}, map[string]bool{}, map[int]bool{}
	for index, rule := range value.Rules {
		p := path + "[" + strconv.Itoa(index) + "]"
		for _, entry := range []struct{ key, value string }{{"ruleKey", rule.RuleKey}, {"bindingKey", rule.BindingKey}} {
			if !validAutomaticSkillKey(entry.value) {
				return errors.New(p + "." + entry.key + " must be an explicit key without surrounding whitespace")
			}
		}
		if keys[rule.RuleKey] {
			return errors.New(p + ".ruleKey is duplicated")
		}
		if bindings[rule.BindingKey] {
			return errors.New(p + ".bindingKey is duplicated")
		}
		if rule.SortOrder < 0 || rule.SortOrder >= MaxAutomaticSkillRules || orders[rule.SortOrder] {
			return errors.New(p + ".sortOrder must be a unique integer in [0,15]")
		}
		keys[rule.RuleKey], bindings[rule.BindingKey], orders[rule.SortOrder] = true, true, true
		if rule.Target != SelectorSource && rule.Target != SelectorTarget {
			return errors.New(p + ".target must be source or target")
		}
		if rule.HitBindings == nil || rule.WaitForCooldowns == nil {
			return errors.New(p + ".hitBindings and waitForCooldowns must be explicit arrays")
		}
		hits := map[string]bool{}
		for hitIndex, hit := range rule.HitBindings {
			hp := p + ".hitBindings[" + strconv.Itoa(hitIndex) + "]"
			if !validAutomaticSkillKey(hit.HitBindingKey) || hits[hit.HitBindingKey] {
				return errors.New(hp + ".hitBindingKey must be a unique explicit key")
			}
			if hit.Preset != "TARGET_HIT" && hit.Preset != "MISS" {
				return errors.New(hp + ".preset must be TARGET_HIT or MISS")
			}
			hits[hit.HitBindingKey] = true
		}
		waits := map[string]bool{}
		for waitIndex, key := range rule.WaitForCooldowns {
			if !validAutomaticSkillKey(key) || key == rule.RuleKey || waits[key] {
				return errors.New(p + ".waitForCooldowns[" + strconv.Itoa(waitIndex) + "] must uniquely name another rule")
			}
			waits[key] = true
		}
		if rule.ReleaseAfterRuleKey != nil && (!validAutomaticSkillKey(*rule.ReleaseAfterRuleKey) || *rule.ReleaseAfterRuleKey == rule.RuleKey) {
			return errors.New(p + ".releaseAfterRuleKey must be null or another explicit rule key")
		}
	}
	return nil
}

func validAutomaticSkillKey(value string) bool {
	return value != "" && strings.TrimSpace(value) == value
}

func automaticJSONShape(data []byte, name, allowed, nullable string) error {
	if err := processJSONShape(data, name, allowed, ""); err != nil {
		return err
	}
	fields, err := strictJSONObject(data, name)
	if err != nil {
		return err
	}
	for _, key := range strings.Fields(allowed) {
		raw, present := fields[key]
		if !present || (string(raw) == "null" && !strings.Contains(" "+nullable+" ", " "+key+" ")) {
			return errors.New(name + "." + key + " is required")
		}
	}
	return nil
}

// strictJSONObject保留重复字段错误，避免map解码默默采用最后一项。
func strictJSONObject(data []byte, name string) (map[string]json.RawMessage, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	token, err := decoder.Token()
	if err != nil {
		return nil, err
	}
	if token != json.Delim('{') {
		return nil, errors.New(name + " must be an object")
	}
	fields := map[string]json.RawMessage{}
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return nil, err
		}
		key, valid := token.(string)
		if !valid {
			return nil, errors.New(name + " must use string keys")
		}
		if _, present := fields[key]; present {
			return nil, errors.New(name + "." + key + " is duplicated")
		}
		var raw json.RawMessage
		if err := decoder.Decode(&raw); err != nil {
			return nil, err
		}
		fields[key] = raw
	}
	if _, err := decoder.Token(); err != nil {
		return nil, err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return nil, errors.New(name + " must contain exactly one object")
	}
	return fields, nil
}

func requireEmptyJSONArray(fields map[string]json.RawMessage, key, path string) error {
	raw, present := fields[key]
	var values []json.RawMessage
	if !present || string(raw) == "null" || json.Unmarshal(raw, &values) != nil || values == nil || len(values) != 0 {
		return errors.New(path + "." + key + " must be an explicit empty array in automatic mode")
	}
	return nil
}

func (value *RunRequest) UnmarshalJSON(data []byte) error {
	fields, err := strictJSONObject(data, "RunRequest")
	if err != nil {
		return err
	}
	type plain RunRequest
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	if decoded.DriverPlan.AutomaticSkills != nil {
		for _, key := range []string{"skillUses", "skillHitFacts", "attackStartFacts", "processCommandFacts"} {
			if err := requireEmptyJSONArray(fields, key, "RunRequest"); err != nil {
				return err
			}
		}
	}
	*value = RunRequest(decoded)
	return nil
}

func (value DriverPlan) MarshalJSON() ([]byte, error) {
	type plain DriverPlan
	if value.AutomaticSkills == nil {
		return json.Marshal(plain(value))
	}
	return json.Marshal(struct {
		plain
		SkillActions []SkillActionPlan `json:"skillActions"`
	}{plain: plain(value), SkillActions: value.SkillActions})
}

func (value RunRequest) MarshalJSON() ([]byte, error) {
	type plain RunRequest
	if value.DriverPlan.AutomaticSkills == nil {
		return json.Marshal(plain(value))
	}
	return json.Marshal(struct {
		plain
		SkillUses           []SkillUseFact       `json:"skillUses"`
		SkillHitFacts       []SkillHitFact       `json:"skillHitFacts"`
		AttackStartFacts    []AttackStartFact    `json:"attackStartFacts"`
		ProcessCommandFacts []ProcessCommandFact `json:"processCommandFacts"`
	}{plain: plain(value), SkillUses: value.SkillUses, SkillHitFacts: value.SkillHitFacts, AttackStartFacts: value.AttackStartFacts, ProcessCommandFacts: value.ProcessCommandFacts})
}

const (
	AutomaticWaitOwnCooldown             = "OWN_COOLDOWN"
	AutomaticWaitRelatedCooldown         = "RELATED_COOLDOWN"
	AutomaticWaitReleaseQualification    = "RELEASE_QUALIFICATION"
	AutomaticWaitActionOccupied          = "ACTION_OCCUPIED"
	AutomaticWaitProcessActive           = "PROCESS_ACTIVE"
	AutomaticWaitMechanicResource        = "MECHANIC_RESOURCE"
	AutomaticWaitAuthorCondition         = "AUTHOR_CONDITION"
	AutomaticRecordAttemptRejected       = "ATTEMPT_REJECTED"
	AutomaticRecordAbortedBeforeStart    = "ABORTED_BEFORE_START"
	AutomaticRecordStarted               = "STARTED"
	AutomaticRecordCompleted             = "COMPLETED"
	AutomaticRecordFailed                = "FAILED"
	AutomaticRecordQualificationGranted  = "QUALIFICATION_GRANTED"
	AutomaticRecordQualificationConsumed = "QUALIFICATION_CONSUMED"
	AutomaticRecordWaitChanged           = "WAIT_CHANGED"
)

// 自动输出显式返回空明细，隐藏只属于有限手动计划的记录。
func (value DoneResult) MarshalJSON() ([]byte, error) {
	return json.Marshal(value.JSONValue())
}

// JSONValue只选择原有输出结构，供出箱编码器直接编码，避免整份结果的中间副本。
func (value DoneResult) JSONValue() any {
	type plain DoneResult
	if value.AutomaticSkillSummary == nil {
		return plain(value)
	}
	value.Summary.SkillActions = nil
	records := value.AutomaticSkillRecords
	if records == nil {
		records = []AutomaticSkillRecord{}
	}
	return struct {
		plain
		SkillActionRecords    *struct{}              `json:"skillActionRecords,omitempty"`
		SkillUseRecords       *struct{}              `json:"skillUseRecords,omitempty"`
		AutomaticSkillRecords []AutomaticSkillRecord `json:"automaticSkillRecords"`
	}{plain: plain(value), AutomaticSkillRecords: records}
}
