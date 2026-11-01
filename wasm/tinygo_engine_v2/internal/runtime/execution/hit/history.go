package hit

// HistoryAPI 定义真实技能使用的接触历史能力；登记时点与费用、行动和帧提交由父层协调。
type HistoryAPI interface {
	// TotalCount 返回原历史与本次运行已登记接触的总次数，目标重复也按原口径计数。
	TotalCount() int
	// ContactCount 返回本次运行新登记的接触数，不包含恢复的原历史。
	ContactCount() int
	// Append 在调用方核对原预算并到达真实登记时点后追加目标，不执行命中或发布其他状态。
	Append(target string)
}

// History 私有保存一项真实使用的原历史与本场接触，不拥有行动使用身份。
type History struct {
	prior    []string
	contacts []string
}

var _ HistoryAPI = (*History)(nil)

// NewHistory 独立复制原接触历史；后续登记不会改写请求中的原数组。
func NewHistory(prior []string) History {
	return History{prior: append([]string(nil), prior...)}
}

func (h *History) TotalCount() int { return len(h.prior) + len(h.contacts) }

func (h *History) ContactCount() int { return len(h.contacts) }

func (h *History) Append(target string) { h.contacts = append(h.contacts, target) }
