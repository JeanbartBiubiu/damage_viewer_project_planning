// Package contract 定义运行子系统之间的稳定身份和值视图。
package contract

// ProcessRef 是本次运行内不复用的过程槽位。编号0合法，Present区分缺失。
// 过程快照恢复后重新登记；该身份不写入外部运行协议。
type ProcessRef struct {
	Slot    int
	Present bool
}

type ActionRef struct {
	Slot    int
	Present bool
}
