//go:build !tinygo

package runtime

import "tinygo_engine_v2/internal/authorization"

// NewMathSession 仅供原生数学验证创建不验签的独立会话；正式 TinyGo 产物不编译此入口。
func NewMathSession() *Session {
	return newSession(authorization.NewPolicy(false, "", nil), nil)
}
