package runtime_test

import (
	"encoding/binary"
	"testing"

	"tinygo_engine_v2/internal/base/abi"
	"tinygo_engine_v2/internal/model"
)

func TestGenericOutboxReadersRejectMalformedFrames(t *testing.T) {
	readers := []struct {
		name    string
		kind    model.FrameKind
		payload string
		read    func([]byte)
	}{
		{"compile", model.FrameKindGenericCompileResult, `{"ok":true,"sessionId":"last"}`, func(outbox []byte) { lastGenericCompileResult(outbox) }},
		{"error", model.FrameKindGenericError, `{"ok":false,"code":"last"}`, func(outbox []byte) { lastGenericError(outbox) }},
		{"release", model.FrameKindGenericReleaseResult, `{"ok":true,"sessionId":"last","released":true}`, func(outbox []byte) { lastGenericReleaseDone(outbox) }},
		{"run", model.FrameKindGenericDone, `{"ok":true,"summary":{"durationMs":5}}`, func(outbox []byte) { lastGenericRunDone(outbox) }},
	}
	for _, reader := range readers {
		t.Run(reader.name, func(t *testing.T) {
			valid := abi.EncodeFrame(reader.kind, 0, []byte(reader.payload))
			badMagic := append([]byte(nil), valid...)
			badMagic[0] ^= 0xff
			badSchema := append([]byte(nil), valid...)
			binary.LittleEndian.PutUint16(badSchema[4:6], model.SchemaVersion+1)
			otherKind := model.FrameKindGenericError
			if reader.kind == otherKind {
				otherKind = model.FrameKindGenericCompileResult
			}
			cases := []struct {
				name   string
				outbox []byte
			}{
				{"empty", nil},
				{"target_missing", abi.EncodeFrame(otherKind, 0, []byte(`{"ok":false}`))},
				{"bad_magic", badMagic},
				{"bad_schema", badSchema},
				{"short_header", valid[:abi.HeaderLen-1]},
				{"truncated_payload", valid[:len(valid)-1]},
				{"trailing_byte", append(append([]byte(nil), valid...), 0)},
				{"valid_then_bad_header", append(append([]byte(nil), valid...), badMagic...)},
			}
			for _, payload := range []string{"{", "null", "[]", "true", `{"ok":"true"}`} {
				invalid := abi.EncodeFrame(reader.kind, 0, []byte(payload))
				cases = append(cases, struct {
					name   string
					outbox []byte
				}{"invalid_payload_" + payload, invalid})
				cases = append(cases, struct {
					name   string
					outbox []byte
				}{"valid_then_invalid_payload_" + payload, append(append([]byte(nil), valid...), invalid...)})
				cases = append(cases, struct {
					name   string
					outbox []byte
				}{"invalid_then_valid_payload_" + payload, append(invalid, valid...)})
			}
			for _, tc := range cases {
				t.Run(tc.name, func(t *testing.T) {
					requireGenericReaderPanic(t, func() { reader.read(tc.outbox) })
				})
			}
		})
	}
}

func TestGenericOutboxReadersDecodeEachTargetIndependently(t *testing.T) {
	t.Run("compile", func(t *testing.T) {
		outbox := append(encodeGenericFrame(model.FrameKindGenericCompileResult, model.CompileResult{OK: true, SessionID: "old"}),
			abi.EncodeFrame(model.FrameKindGenericCompileResult, 0, []byte(`{"ok":false}`))...)
		got := lastGenericCompileResult(outbox)
		if got.OK || got.SessionID != "" {
			t.Fatalf("last compile retained previous fields: %+v", got)
		}
	})
	t.Run("error", func(t *testing.T) {
		outbox := append(abi.EncodeFrame(model.FrameKindGenericError, 0, []byte(`{"code":"old","message":"old"}`)),
			abi.EncodeFrame(model.FrameKindGenericError, 0, []byte(`{"code":"last"}`))...)
		got := lastGenericError(outbox)
		if got.Code != "last" || got.Message != "" {
			t.Fatalf("last error retained previous fields: %+v", got)
		}
	})
	t.Run("release", func(t *testing.T) {
		outbox := append(encodeGenericFrame(model.FrameKindGenericReleaseResult, model.GenericReleaseDonePayload{OK: true, SessionID: "old", Released: true}),
			abi.EncodeFrame(model.FrameKindGenericReleaseResult, 0, []byte(`{"ok":false}`))...)
		got := lastGenericReleaseDone(outbox)
		if got.OK || got.SessionID != "" || got.Released {
			t.Fatalf("last release retained previous fields: %+v", got)
		}
	})
	t.Run("run", func(t *testing.T) {
		outbox := append(abi.EncodeFrame(model.FrameKindGenericDone, 0, []byte(`{"ok":true,"summary":{"durationMs":5,"targetHpLoss":10}}`)),
			abi.EncodeFrame(model.FrameKindGenericDone, 0, []byte(`{"ok":false,"summary":{"durationMs":7}}`))...)
		got := lastGenericRunDone(outbox)
		if got.OK || got.Summary.DurationMs != 7 || got.Summary.TargetHpLoss != 0 {
			t.Fatalf("last run retained previous fields: %+v", got)
		}
	})
}

func TestGenericOutboxReadersRequireRunSummary(t *testing.T) {
	valid := abi.EncodeFrame(model.FrameKindGenericDone, 0, []byte(`{"ok":true,"summary":{"durationMs":5}}`))
	for _, payload := range []string{`{"ok":true}`, `{"summary":null}`, `{"summary":{}}`, `{"summary":[]}`, `{"summary":"bad"}`} {
		t.Run(payload, func(t *testing.T) {
			invalid := abi.EncodeFrame(model.FrameKindGenericDone, 0, []byte(payload))
			requireGenericReaderPanic(t, func() { lastGenericRunDone(invalid) })
			requireGenericReaderPanic(t, func() { lastGenericRunDone(append(append([]byte(nil), valid...), invalid...)) })
			requireGenericReaderPanic(t, func() { lastGenericRunDone(append(invalid, valid...)) })
		})
	}
}

func requireGenericReaderPanic(t *testing.T, read func()) {
	t.Helper()
	defer func() {
		if recover() == nil {
			t.Fatal("malformed or missing output must fail immediately")
		}
	}()
	read()
}
