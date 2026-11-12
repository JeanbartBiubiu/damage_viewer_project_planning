package runtime

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"os"
	"testing"

	"tinygo_engine_v2/internal/authorization"
	"tinygo_engine_v2/internal/base/abi"
	"tinygo_engine_v2/internal/model"
)

const authorizationAccount = "56dc352d-d46e-4380-8d64-083738221b3c"

func authorizationFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	data, err := os.ReadFile("../testkit/fixtures/formula_phase4_explicit_basic_damage.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Compile model.CompileRequest `json:"compileRequest"`
		Run     model.RunRequest     `json:"runRequest"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture.Compile, fixture.Run
}

func authorizationJSON(t *testing.T, value any) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func authorizationPayload(t *testing.T, session *Session, target any) {
	t.Helper()
	frame, err := abi.DecodeFrame(session.OutboxBytes())
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(frame.Payload, target); err != nil {
		t.Fatal(err)
	}
	session.ClearOutbox()
}

func assertAuthorizationError(t *testing.T, session *Session, code int32, want model.GenericErrCode) {
	t.Helper()
	if code != -1 {
		t.Fatalf("code=%d want -1", code)
	}
	var result model.EngineError
	authorizationPayload(t, session, &result)
	if result.Code != want {
		t.Fatalf("error=%q want %q", result.Code, want)
	}
}

func sessionGrant(t *testing.T, key ed25519.PrivateKey, account string, iat int64) string {
	t.Helper()
	return sessionSubjectGrant(t, key, account, "PLAYER", iat)
}

func sessionSubjectGrant(t *testing.T, key ed25519.PrivateKey, subject, subjectType string, iat int64) string {
	t.Helper()
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"Ed25519","typ":"dv-wasm-grant+jwt","kid":"runtime-isolated-key"}`))
	claims := map[string]any{
		"iss": "damage-viewer", "aud": "damage-viewer-wasm", "sub": subject, "subjectType": subjectType,
		"scope": []string{"engine:compute"}, "iat": iat, "nbf": iat, "exp": iat + 86_400,
		"authorizationVersion": 2, "jti": "ae08810a-aec8-4635-9d7d-06080818262d",
	}
	if subjectType == "PLAYER" {
		claims["canLogin"] = 1
	} else {
		claims["exp"] = iat + 1800
	}
	body := authorizationJSON(t, claims)
	message := header + "." + base64.RawURLEncoding.EncodeToString(body)
	return message + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, []byte(message)))
}

func TestMaintenanceCompileRunExpiryAndCrossSubjectIsolation(t *testing.T) {
	publicKey, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := int64(1000)
	session := newSession(authorization.NewPolicy(true, "runtime-isolated-key", publicKey), func() int64 { return now })
	for _, subjectType := range []string{"PLAYER", "MAINTENANCE"} {
		t.Run(subjectType, func(t *testing.T) {
			compileRequest, runRequest := authorizationFixture(t)
			compileRequest.Authorization = sessionSubjectGrant(t, key, authorizationAccount, subjectType, 1000)
			if code := session.CompileJSON(authorizationJSON(t, compileRequest)); code != 0 {
				t.Fatal("authorized subject could not compile")
			}
			var compiled model.CompileResult
			authorizationPayload(t, session, &compiled)
			runRequest.SessionID, runRequest.ExpectedRulesHash = compiled.SessionID, compiled.RulesHash
			otherType := "PLAYER"
			if subjectType == "PLAYER" {
				otherType = "MAINTENANCE"
			}
			runRequest.Authorization = sessionSubjectGrant(t, key, authorizationAccount, otherType, 1000)
			assertAuthorizationError(t, session, session.RunJSON(authorizationJSON(t, runRequest)), model.GenericErrAuthorizationAccountMismatch)
			runRequest.Authorization = compileRequest.Authorization
			if code := session.RunJSON(authorizationJSON(t, runRequest)); code != 0 {
				t.Fatal("same subject could not run")
			}
			var done model.DoneResult
			authorizationPayload(t, session, &done)
			if !done.OK || done.Summary.TargetFinalHp != 900 {
				t.Fatal("subject type changed the mathematical result")
			}
			if subjectType == "MAINTENANCE" {
				now = 2800
				assertAuthorizationError(t, session, session.RunJSON(authorizationJSON(t, runRequest)), model.GenericErrAuthorizationExpired)
				runRequest.Authorization = sessionSubjectGrant(t, key, authorizationAccount, subjectType, now)
				if code := session.RunJSON(authorizationJSON(t, runRequest)); code != 0 {
					t.Fatal("same maintenance subject could not renew")
				}
				session.ClearOutbox()
			}
			if code := session.ReleaseSessionJSON(authorizationJSON(t, model.ReleaseSessionRequest{SessionID: compiled.SessionID, ExpectedRulesHash: compiled.RulesHash})); code != 0 {
				t.Fatal("release failed")
			}
			session.ClearOutbox()
		})
	}
}

func TestAuthorizedCompileRunRenewalAndRelease(t *testing.T) {
	publicKey, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := int64(1000)
	session := newSession(authorization.NewPolicy(true, "runtime-isolated-key", publicKey), func() int64 { return now })
	compileRequest, runRequest := authorizationFixture(t)
	assertAuthorizationError(t, session, session.CompileJSON(authorizationJSON(t, compileRequest)), model.GenericErrAuthorizationRequired)
	if len(session.genericSessions) != 0 {
		t.Fatal("unauthorized compile created a session")
	}
	compileRequest.Authorization = sessionGrant(t, key, authorizationAccount, 1000)
	if code := session.CompileFrame(abi.EncodeFrame(model.FrameKindGenericCompile, 0, authorizationJSON(t, compileRequest))); code != 0 {
		t.Fatal("signed compile failed")
	}
	var compiled model.CompileResult
	authorizationPayload(t, session, &compiled)
	runRequest.SessionID, runRequest.ExpectedRulesHash = compiled.SessionID, compiled.RulesHash
	assertAuthorizationError(t, session, session.RunJSON(authorizationJSON(t, runRequest)), model.GenericErrAuthorizationRequired)
	// 账号字段或运行选项中的关闭标记都不能替代顶层票据。
	runRequest.RuntimeOptions = json.RawMessage(`{"authorizationRequired":false,"canLogin":1}`)
	assertAuthorizationError(t, session, session.RunJSON(authorizationJSON(t, runRequest)), model.GenericErrAuthorizationRequired)
	runRequest.RuntimeOptions = nil
	runRequest.Authorization = sessionGrant(t, key, "a232fa99-f93a-4517-8bbf-cfd8f8a9b0ea", 1000)
	assertAuthorizationError(t, session, session.RunJSON(authorizationJSON(t, runRequest)), model.GenericErrAuthorizationAccountMismatch)
	runRequest.Authorization = compileRequest.Authorization
	runRequest.ExpectedRulesHash = "wrong-rules"
	assertAuthorizationError(t, session, session.RunJSON(authorizationJSON(t, runRequest)), model.GenericErrHashMismatch)
	runRequest.ExpectedRulesHash = compiled.RulesHash
	var baseline model.DoneResult
	for iteration, authorizedAt := range []int64{1300, 87_399} {
		now = authorizedAt
		if code := session.RunFrame(abi.EncodeFrame(model.FrameKindGenericRun, 0, authorizationJSON(t, runRequest))); code != 0 {
			t.Fatal("signed run failed")
		}
		var done model.DoneResult
		authorizationPayload(t, session, &done)
		if !done.OK || done.Summary.TargetFinalHp != 900 {
			t.Fatal("authorization changed the mathematical result")
		}
		if iteration == 0 {
			baseline = done
		} else if string(authorizationJSON(t, done)) != string(authorizationJSON(t, baseline)) {
			t.Fatal("reusing a grant changed the result")
		}
	}
	now = 87_400
	assertAuthorizationError(t, session, session.RunJSON(authorizationJSON(t, runRequest)), model.GenericErrAuthorizationExpired)
	runRequest.Authorization = sessionGrant(t, key, authorizationAccount, now)
	if code := session.RunJSON(authorizationJSON(t, runRequest)); code != 0 {
		t.Fatal("same-account grant renewal failed")
	}
	var renewed model.DoneResult
	authorizationPayload(t, session, &renewed)
	if string(authorizationJSON(t, renewed)) != string(authorizationJSON(t, baseline)) {
		t.Fatal("renewal changed result or rule identity")
	}
	// 过期后释放不读取时钟或票据，也保留非幂等的第二次释放错误。
	session.now = func() int64 { panic("release must not check authorization") }
	release := model.ReleaseSessionRequest{SessionID: compiled.SessionID, ExpectedRulesHash: compiled.RulesHash}
	if code := session.ReleaseSessionJSON(authorizationJSON(t, release)); code != 0 {
		t.Fatal("release without authorization failed")
	}
	session.ClearOutbox()
	assertAuthorizationError(t, session, session.ReleaseSessionJSON(authorizationJSON(t, release)), model.GenericErrSessionNotFound)
}

func TestDisabledAuthorizationKeepsInputAndSessionChecks(t *testing.T) {
	session := NewMathSession()
	compileRequest, runRequest := authorizationFixture(t)
	compileRequest.Authorization = "malformed ignored in explicitly disabled mode"
	if code := session.CompileJSON(authorizationJSON(t, compileRequest)); code != 0 {
		t.Fatal("disabled compile rejected an unused grant")
	}
	var compiled model.CompileResult
	authorizationPayload(t, session, &compiled)
	runRequest.SessionID, runRequest.ExpectedRulesHash = compiled.SessionID, "wrong"
	assertAuthorizationError(t, session, session.RunJSON(authorizationJSON(t, runRequest)), model.GenericErrHashMismatch)
	runRequest.ExpectedRulesHash = compiled.RulesHash
	if code := session.RunJSON(authorizationJSON(t, runRequest)); code != 0 {
		t.Fatal("disabled run requires authorization")
	}
	session.ClearOutbox()
	runRequest.InitialSnapshot.RulesHash = "wrong"
	assertAuthorizationError(t, session, session.RunJSON(authorizationJSON(t, runRequest)), model.GenericErrHashMismatch)
	runRequest.SessionID = "absent"
	assertAuthorizationError(t, session, session.RunJSON(authorizationJSON(t, runRequest)), model.GenericErrSessionNotFound)
}

func TestDefaultSessionFailsClosedWithoutBuildKey(t *testing.T) {
	session := NewSession()
	compileRequest, _ := authorizationFixture(t)
	assertAuthorizationError(t, session, session.CompileJSON(authorizationJSON(t, compileRequest)), model.GenericErrAuthorizationRequired)
	compileRequest.Authorization = "untrusted"
	assertAuthorizationError(t, session, session.CompileJSON(authorizationJSON(t, compileRequest)), model.GenericErrAuthorizationInvalid)
}
