package actionflow

import (
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/runtime/contract"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

// AmmoCaptureAPI 列出本次真实使用的扣弹前捕获能力。
type AmmoCaptureAPI interface {
	// UseKey 返回捕获所属的完整原使用，仅供原提交登记，不生成新使用。
	UseKey() string
	// Before 核对实际拥有者、来源和状态后借用扣弹前金额；缺失保持false。
	Before(owner, provider, state string) (float64, bool)
}

// AmmoCapture 独占一次真实使用的完整扣弹身份和扣弹前值。
type AmmoCapture struct {
	use, owner, provider, state string
	before                      float64
}

var _ AmmoCaptureAPI = (*AmmoCapture)(nil)

// NewAmmoCapture 仅在原扣弹资格核对成功后建立实际使用捕获，不发布或记录。
func NewAmmoCapture(use, owner, provider, state string, before float64) *AmmoCapture {
	return &AmmoCapture{use: use, owner: owner, provider: provider, state: state, before: before}
}

func (capture *AmmoCapture) UseKey() string {
	if capture == nil {
		return ""
	}
	return capture.use
}

func (capture *AmmoCapture) Before(owner, provider, state string) (float64, bool) {
	if capture == nil || capture.owner != owner || capture.provider != provider || capture.state != state {
		return 0, false
	}
	return capture.before, true
}

// MechanicUseReference 按原优先级确定库存公式所属使用；factUse只在没有事件使用时读取。
func MechanicUseReference(processUse string, event *contract.EventSnapshot, factUse *string) string {
	if event != nil && event.HasUse {
		return event.UseKey
	}
	if factUse != nil {
		return *factUse
	}
	return processUse
}

// UseAmmoBefore 核对实际使用与能力来源后优先借用本帧待提交捕获，保持有效零和缺失区分。
func UseAmmoBefore(use *actionpkg.UseView, key, owner, provider, skill, state string, saved, pending *AmmoCapture) (float64, bool) {
	if use == nil || use.Source() != owner || use.SkillKey() != skill {
		return 0, false
	}
	capture := saved
	if pending != nil && pending.UseKey() == key {
		capture = pending
	}
	return capture.Before(owner, provider, state)
}

// StatusPresence 按原声明与实际未到期贡献构造当前状态存在视图，不更新生命周期。
func StatusPresence(keys []string, providers effectpkg.ProviderList, now int64) map[string]bool {
	values := map[string]bool{}
	for _, key := range keys {
		values[key] = false
	}
	for index := 0; index < providers.Len(); index++ {
		instance := providers.At(index)
		if instance.Expired(now) {
			continue
		}
		for contributionIndex := 0; contributionIndex < instance.StatusContributions.Len(); contributionIndex++ {
			contribution := instance.StatusContributions.At(contributionIndex)
			if _, declared := values[contribution.StatusKey]; declared {
				values[contribution.StatusKey] = true
			}
		}
	}
	return values
}
