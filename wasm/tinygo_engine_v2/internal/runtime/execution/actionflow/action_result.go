package actionflow

// ActionResult 是本次独立行动的接纳事实，不代表整条同步派生链成功。
// Accepted 仅在本次真实帧发布行动事实后成立，可与尾部错误同时返回；
// 未接纳也不承诺撤回此前已经发布的其他事实。Reason 沿用已有正常拒绝原因。
type ActionResult struct {
	Accepted bool
	Reason   string
}
