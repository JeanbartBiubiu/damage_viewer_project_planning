// 本文件实现通用编译会话的登记、运行、释放及出箱接线。
package runtime

import (
	"encoding/json"
	"strconv"
	"time"

	"tinygo_engine_v2/internal/authorization"
	"tinygo_engine_v2/internal/base/abi"
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// SessionAPI 定义宿主与编译会话之间的有限能力；具体会话继续由 Session 保存。
type SessionAPI interface {
	// OutboxBytes 借用当前出箱字节，应在下一次写入或清空前完成读取。
	OutboxBytes() []byte
	// ClearOutbox 清空已消费的出箱内容，不释放编译会话。
	ClearOutbox()
	// CompileFrame 校验编译帧并编译其载荷，结果沿出箱返回；成功返回0，失败返回-1。
	CompileFrame(input []byte) int32
	// CompileJSON 先核验计算授权，再编译作者载荷并登记绑定账号的可复用计划；写出失败时撤销本次登记。
	// 成功返回0，编译拒绝或执行失败返回-1；错误输出超限时尝试固定短错误，连短错误也无法容纳则清空出箱。
	CompileJSON(payload []byte) int32
	// RunFrame 校验运行帧后执行其载荷，结果沿出箱返回；成功返回0，失败返回-1。
	RunFrame(input []byte) int32
	// RunJSON 先核验本次票据及编译账号，再校验规则身份和运行输入，创建独立战斗状态执行既有计划。
	// 结果沿出箱返回，成功返回0，失败返回-1。
	RunJSON(payload []byte) int32
	// ReleaseSessionFrame 校验释放帧后释放指定会话，释放结果沿出箱返回。
	// 成功返回0，失败返回-1。
	ReleaseSessionFrame(input []byte) int32
	// ReleaseSessionJSON 校验会话及可选规则身份后删除登记；结果写出失败不会恢复登记。
	// 结果沿出箱返回，成功返回0，失败返回-1。
	ReleaseSessionJSON(payload []byte) int32
}

// Session 拥有编译会话登记与出箱，不保存跨战斗复用的可变战斗状态。
type Session struct {
	outbox        abi.Outbox
	authorization authorization.Policy
	now           func() int64

	genericSessions      map[string]genericSessionEntry
	nextGenericSessionID uint32
}

type genericSessionEntry struct {
	sessionID     string
	schemaVersion string
	schemaHash    string
	rulesHash     string
	accountID     string
	compiled      planbundle.CompiledSession
}

var _ SessionAPI = (*Session)(nil)

// NewSession 按固化构建策略创建独立的授权会话登记表与出箱，配置缺失时拒绝计算。
func NewSession() *Session {
	return newSession(authorization.BuildPolicy(), func() int64 { return time.Now().Unix() })
}

func newSession(policy authorization.Policy, now func() int64) *Session {
	return &Session{
		outbox:          abi.NewOutbox(abi.DefaultOutboxCapacity),
		authorization:   policy,
		now:             now,
		genericSessions: make(map[string]genericSessionEntry),
	}
}

func (s *Session) OutboxBytes() []byte {
	return s.outbox.Bytes()
}

func (s *Session) ClearOutbox() {
	s.outbox.Clear()
}

func (s *Session) CompileFrame(input []byte) int32 {
	frame, err := abi.DecodeFrame(input)
	if err != nil {
		s.writeGenericError(model.GenericPhaseABI, model.GenericErrJSONParseError, err.Error(), "", "", "")
		return -1
	}
	if frame.Kind != model.FrameKindGenericCompile {
		s.writeGenericError(model.GenericPhaseABI, model.GenericErrMissingRequiredField, "expected generic compile frame", "", "", "")
		return -1
	}
	return s.CompileJSON(frame.Payload)
}

func (s *Session) CompileJSON(payload []byte) int32 {
	var req model.CompileRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		s.writeGenericError(model.GenericPhaseParse, model.GenericErrJSONParseError, err.Error(), "", "", "")
		return -1
	}
	accountID, failure := authorization.Verify(s.authorization, req.Authorization, s.authorizationTime())
	if failure != "" {
		s.writeGenericError(model.GenericPhaseCompile, model.GenericErrCode(failure), "计算授权无效或不可用", "", "", "")
		return -1
	}
	compiled := compilebundle.CompileGeneric(req)
	if !compiled.OK {
		s.writeGenericCompileResult(compiled.Result)
		return -1
	}
	sessionID := s.registerGenericSession(compiled.Session, accountID)
	result := compiled.Result
	result.SessionID = sessionID
	if !s.writeGenericFrame(model.FrameKindGenericCompileResult, result) {
		delete(s.genericSessions, sessionID)
		return -1
	}
	return 0
}

func (s *Session) RunFrame(input []byte) int32 {
	frame, err := abi.DecodeFrame(input)
	if err != nil {
		s.writeGenericError(model.GenericPhaseABI, model.GenericErrJSONParseError, err.Error(), "", "", "")
		return -1
	}
	if frame.Kind != model.FrameKindGenericRun {
		s.writeGenericError(model.GenericPhaseABI, model.GenericErrMissingRequiredField, "expected generic run frame", "", "", "")
		return -1
	}
	return s.RunJSON(frame.Payload)
}

func (s *Session) RunJSON(payload []byte) int32 {
	var req model.RunRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		s.writeGenericError(model.GenericPhaseParse, model.GenericErrJSONParseError, err.Error(), "", "", "")
		return -1
	}
	accountID, failure := authorization.Verify(s.authorization, req.Authorization, s.authorizationTime())
	if failure != "" {
		s.writeGenericError(model.GenericPhaseRun, model.GenericErrCode(failure), "计算授权无效或不可用", "", "", req.SessionID)
		return -1
	}
	if req.SessionID == "" {
		s.writeGenericError(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "sessionId is required", req.SchemaHash, req.RulesHash, "")
		return -1
	}
	entry, ok := s.genericSessions[req.SessionID]
	if !ok {
		s.writeGenericError(model.GenericPhaseRun, model.GenericErrSessionNotFound, "session not found", "", "", req.SessionID)
		return -1
	}
	if entry.accountID != accountID {
		s.writeGenericError(model.GenericPhaseRun, model.GenericErrAuthorizationAccountMismatch, "计算授权账号与编译会话不一致", entry.schemaHash, entry.rulesHash, req.SessionID)
		return -1
	}
	if req.ExpectedRulesHash == "" {
		s.writeGenericError(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "expectedRulesHash is required", entry.schemaHash, entry.rulesHash, req.SessionID)
		return -1
	}
	if req.ExpectedRulesHash != entry.rulesHash {
		s.writeGenericError(model.GenericPhaseRun, model.GenericErrHashMismatch, "expectedRulesHash mismatch", entry.schemaHash, entry.rulesHash, req.SessionID)
		return -1
	}
	if errPayload := validateGenericRunRequest(entry.compiled, req); errPayload != nil {
		s.writeGenericError(errPayload.Phase, errPayload.Code, errPayload.Message, entry.schemaHash, entry.rulesHash, req.SessionID)
		return -1
	}
	done, runErr := RunGeneric(entry.compiled, req)
	if runErr != nil {
		// 保留运行层的具体字段路径与引用，避免宿主只收到无法定位的错误消息。
		runErr.SchemaHash, runErr.RulesHash, runErr.SessionID = entry.schemaHash, entry.rulesHash, req.SessionID
		s.writeGenericFrame(model.FrameKindGenericError, *runErr)
		return -1
	}
	if !s.writeGenericFrame(model.FrameKindGenericDone, done.JSONValue()) {
		return -1
	}
	return 0
}

func (s *Session) ReleaseSessionFrame(input []byte) int32 {
	frame, err := abi.DecodeFrame(input)
	if err != nil {
		s.writeGenericError(model.GenericPhaseABI, model.GenericErrJSONParseError, err.Error(), "", "", "")
		return -1
	}
	if frame.Kind != model.FrameKindGenericReleaseSession {
		s.writeGenericError(model.GenericPhaseABI, model.GenericErrMissingRequiredField, "expected generic release session frame", "", "", "")
		return -1
	}
	return s.ReleaseSessionJSON(frame.Payload)
}

func (s *Session) ReleaseSessionJSON(payload []byte) int32 {
	var req model.ReleaseSessionRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		s.writeGenericError(model.GenericPhaseParse, model.GenericErrJSONParseError, err.Error(), "", "", "")
		return -1
	}
	if req.SessionID == "" {
		s.writeGenericError(model.GenericPhaseABI, model.GenericErrMissingRequiredField, "sessionId is required", "", "", "")
		return -1
	}
	entry, ok := s.genericSessions[req.SessionID]
	if !ok {
		s.writeGenericError(model.GenericPhaseABI, model.GenericErrSessionNotFound, "session not found", "", "", req.SessionID)
		return -1
	}
	if req.ExpectedRulesHash != "" && req.ExpectedRulesHash != entry.rulesHash {
		s.writeGenericError(model.GenericPhaseABI, model.GenericErrHashMismatch, "expectedRulesHash mismatch", entry.schemaHash, entry.rulesHash, req.SessionID)
		return -1
	}
	delete(s.genericSessions, req.SessionID)
	if !s.writeGenericFrame(model.FrameKindGenericReleaseResult, model.GenericReleaseDonePayload{
		OK:        true,
		SessionID: req.SessionID,
		Released:  true,
	}) {
		return -1
	}
	return 0
}

func (s *Session) registerGenericSession(session planbundle.CompiledSession, accountID string) string {
	s.nextGenericSessionID++
	sessionID := "generic-session-" + strconv.FormatUint(uint64(s.nextGenericSessionID), 10)
	s.genericSessions[sessionID] = genericSessionEntry{
		sessionID:     sessionID,
		schemaVersion: session.SchemaVersion,
		schemaHash:    session.SchemaHash,
		rulesHash:     session.RulesHash,
		accountID:     accountID,
		compiled:      session,
	}
	return sessionID
}

func (s *Session) authorizationTime() int64 {
	if s.now == nil {
		return 0
	}
	return s.now()
}

func (s *Session) writeGenericCompileResult(result model.CompileResult) {
	s.writeGenericFrame(model.FrameKindGenericCompileResult, result)
}

func (s *Session) writeGenericError(phase model.GenericErrorPhase, code model.GenericErrCode, message, schemaHash, rulesHash, sessionID string) {
	payload := engineError(phase, code, message, schemaHash, rulesHash, sessionID)
	s.writeGenericFrame(model.FrameKindGenericError, payload)
}

// 所有会话输出共用失败边界；固定短错误不带可能造成超限的请求标识或原错误文本。
func (s *Session) writeGenericFrame(kind model.FrameKind, payload any) bool {
	code := s.outbox.WriteJSON(kind, payload)
	if code == model.ErrOK {
		return true
	}
	s.outbox.Clear()
	failure := model.NewEngineError(model.GenericPhaseABI, model.GenericErrRuntimeInvariantFailed, "outbox frame write failed")
	failure.Path = "outbox"
	failure.Details = map[string]interface{}{"frameKind": kind, "writeCode": code}
	if s.outbox.WriteJSON(model.FrameKindGenericError, failure) != model.ErrOK {
		s.outbox.Clear()
	}
	return false
}

func engineError(phase model.GenericErrorPhase, code model.GenericErrCode, message, schemaHash, rulesHash, sessionID string) model.EngineError {
	err := model.NewEngineError(phase, code, message)
	err.SchemaHash = schemaHash
	err.RulesHash = rulesHash
	err.SessionID = sessionID
	return err
}
