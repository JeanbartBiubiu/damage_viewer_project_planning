package testkit

import (
	"encoding/json"

	"tinygo_engine_v2/internal/abi"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/runtime"
)

func EncodeGenericFrame(kind model.FrameKind, payload any) []byte {
	encoded := mustJSON(payload)
	return abi.EncodeFrame(kind, 0, encoded)
}

func CanonicalBasicDamageCompileRequest() model.CompileRequest {
	fixture, err := LoadGenericFixture("generic_p0_basic_damage.json")
	if err != nil {
		panic(err)
	}
	return fixture.CompileRequest
}

func CanonicalCompileMultiErrorRequest() model.CompileRequest {
	fixture, err := LoadGenericFixture("generic_p0_compile_multi_error.json")
	if err != nil {
		panic(err)
	}
	return fixture.CompileRequest
}

func GenericRunRequest(sessionID, expectedRulesHash string) model.GenericRunRequest {
	return model.GenericRunRequest{
		SessionID:         sessionID,
		ExpectedRulesHash: expectedRulesHash,
	}
}

func CompileGenericSession(session *runtime.Session) model.CompileResult {
	session.ClearOutbox()
	must(session.CompileFrame(EncodeGenericFrame(model.FrameKindGenericCompile, CanonicalBasicDamageCompileRequest())))
	return LastGenericCompileResult(session.OutboxBytes())
}

func LastGenericCompileResult(outbox []byte) model.CompileResult {
	var result model.CompileResult
	offset := 0
	for offset+abi.HeaderLen <= len(outbox) {
		frame, err := abi.DecodeFrame(outbox[offset:])
		if err != nil {
			break
		}
		if frame.Kind == model.FrameKindGenericCompileResult {
			_ = json.Unmarshal(frame.Payload, &result)
		}
		offset += abi.HeaderLen + len(frame.Payload)
	}
	return result
}

func LastGenericError(outbox []byte) model.EngineError {
	var payload model.EngineError
	offset := 0
	for offset+abi.HeaderLen <= len(outbox) {
		frame, err := abi.DecodeFrame(outbox[offset:])
		if err != nil {
			break
		}
		if frame.Kind == model.FrameKindGenericError {
			_ = json.Unmarshal(frame.Payload, &payload)
		}
		offset += abi.HeaderLen + len(frame.Payload)
	}
	return payload
}

func LastGenericRunDone(outbox []byte) model.DoneResult {
	var payload model.DoneResult
	offset := 0
	for offset+abi.HeaderLen <= len(outbox) {
		frame, err := abi.DecodeFrame(outbox[offset:])
		if err != nil {
			break
		}
		if frame.Kind == model.FrameKindGenericDone {
			var probe map[string]json.RawMessage
			if json.Unmarshal(frame.Payload, &probe) == nil {
				if _, hasSummary := probe["summary"]; hasSummary {
					_ = json.Unmarshal(frame.Payload, &payload)
				}
			}
		}
		offset += abi.HeaderLen + len(frame.Payload)
	}
	return payload
}

func LastGenericReleaseDone(outbox []byte) model.GenericReleaseDonePayload {
	var payload model.GenericReleaseDonePayload
	offset := 0
	for offset+abi.HeaderLen <= len(outbox) {
		frame, err := abi.DecodeFrame(outbox[offset:])
		if err != nil {
			break
		}
		if frame.Kind == model.FrameKindGenericReleaseResult {
			_ = json.Unmarshal(frame.Payload, &payload)
		}
		offset += abi.HeaderLen + len(frame.Payload)
	}
	return payload
}
