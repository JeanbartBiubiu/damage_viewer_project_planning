package abi

import (
	"bytes"
	"encoding/json"
	"math"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestOutboxJSONKeepsMarshalBytes(t *testing.T) {
	for _, payload := range []any{
		nil, true, 1.25, "line\n<>&中文\u2028", []byte{0, 255},
		map[string]any{"empty": []int{}, "number": json.Number("1.20"), "null": nil},
		json.RawMessage("\n {\"value\": 1} \n"),
	} {
		encoded, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		outbox := NewOutbox(HeaderLen + len(encoded))
		if code := outbox.WriteJSON(model.FrameKindGenericDone, payload); code != model.ErrOK {
			t.Fatalf("write %T at exact capacity: %s", payload, code)
		}
		if !bytes.Equal(outbox.Bytes(), EncodeFrame(model.FrameKindGenericDone, 0, encoded)) {
			t.Fatalf("frame for %T differs from Marshal", payload)
		}
	}
}

func TestOutboxJSONCapacityAndRecovery(t *testing.T) {
	payload := "value"
	encoded, _ := json.Marshal(payload)
	for _, kind := range []model.FrameKind{model.FrameKindGenericDone, nonPriorityTestKind} {
		for _, capacity := range []int{HeaderLen - 1, HeaderLen + len(encoded) - 1} {
			outbox := NewOutbox(capacity)
			code := outbox.WriteJSON(kind, payload)
			if isPriorityFrame(kind) {
				if code != model.ErrQueueOverflow || outbox.Dropped() != 0 {
					t.Fatalf("priority capacity %d: code=%s dropped=%d", capacity, code, outbox.Dropped())
				}
			} else if code != model.ErrOK || outbox.Dropped() != 1 {
				t.Fatalf("non-priority capacity %d: code=%s dropped=%d", capacity, code, outbox.Dropped())
			}
			if len(outbox.Bytes()) != 0 || cap(outbox.Bytes()) != capacity {
				t.Fatal("overflow left a partial frame or grew the buffer")
			}
			if capacity >= HeaderLen+1 {
				if code := outbox.WriteJSON(model.FrameKindGenericDone, 0); code != model.ErrOK {
					t.Fatalf("valid write after overflow: %s", code)
				}
			}
		}
	}
}

func TestOutboxJSONEncodingFailurePreservesQueuedFrames(t *testing.T) {
	for _, payload := range []any{math.NaN(), json.RawMessage("{"), make(chan int)} {
		outbox := NewOutbox(64)
		outbox.WriteFrame(model.FrameKindGenericCompileResult, 3, []byte("queued"))
		outbox.WriteFrame(nonPriorityTestKind, 0, make([]byte, 64))
		before := append([]byte(nil), outbox.Bytes()...)
		if code := outbox.WriteJSON(model.FrameKindGenericDone, payload); code != model.ErrInvalidInput {
			t.Fatalf("invalid %T: %s", payload, code)
		}
		if !bytes.Equal(before, outbox.Bytes()) || outbox.Dropped() != 1 {
			t.Fatal("encoding failure changed queued data or drop count")
		}
		if code := outbox.WriteJSON(model.FrameKindGenericDone, "next"); code != model.ErrOK {
			t.Fatalf("valid write after encoding failure: %s", code)
		}
		frames, err := DecodeFrame(outbox.Bytes()[len(before):])
		if err != nil || string(frames.Payload) != `"next"` {
			t.Fatalf("recovery frame: %q %v", frames.Payload, err)
		}
	}
}

func TestOutboxJSONPriorityReplacementAndReuse(t *testing.T) {
	outbox := NewOutbox(64)
	if code := outbox.WriteJSON(nonPriorityTestKind, strings.Repeat("x", 24)); code != model.ErrOK {
		t.Fatal(code)
	}
	if code := outbox.WriteJSON(model.FrameKindGenericDone, strings.Repeat("y", 24)); code != model.ErrOK {
		t.Fatal(code)
	}
	frame, err := DecodeFrame(outbox.Bytes())
	if err != nil || frame.Kind != model.FrameKindGenericDone || string(frame.Payload) != `"`+strings.Repeat("y", 24)+`"` {
		t.Fatal("priority did not replace previous contents")
	}
	if code := outbox.WriteJSON(nonPriorityTestKind, strings.Repeat("z", 24)); code != model.ErrOK || outbox.Dropped() != 1 {
		t.Fatalf("full non-priority write: %s, %d", code, outbox.Dropped())
	}
	if code := outbox.WriteJSON(model.FrameKindGenericDone, strings.Repeat("z", 64)); code != model.ErrQueueOverflow || len(outbox.Bytes()) != 0 || outbox.Dropped() != 1 {
		t.Fatalf("oversized priority: %s", code)
	}
	for i := 0; i < 10; i++ {
		outbox.Clear()
		payload := strings.Repeat(string(rune('a'+i)), 30-i)
		if code := outbox.WriteJSON(model.FrameKindGenericDone, payload); code != model.ErrOK {
			t.Fatal(code)
		}
		frame, err := DecodeFrame(outbox.Bytes())
		encoded, _ := json.Marshal(payload)
		if err != nil || !bytes.Equal(frame.Payload, encoded) || outbox.Dropped() != 0 || cap(outbox.Bytes()) != 64 {
			t.Fatalf("changing output on reuse %d: %v", i, err)
		}
	}
}

func TestOutboxFrameReplacementKeepsAliasedPayload(t *testing.T) {
	outbox := NewOutbox(64)
	if code := outbox.WriteFrame(nonPriorityTestKind, 3, []byte("a queued frame body")); code != model.ErrOK {
		t.Fatal(code)
	}
	payload := outbox.Bytes()
	expected := append([]byte(nil), payload...)
	if code := outbox.WriteFrame(model.FrameKindGenericDone, 7, payload); code != model.ErrOK {
		t.Fatal(code)
	}
	frame, err := DecodeFrame(outbox.Bytes())
	if err != nil || frame.Flags != 7 || !bytes.Equal(frame.Payload, expected) {
		t.Fatalf("overlapping input corrupted on priority replacement: %v", err)
	}
}

func BenchmarkOutboxLargeJSON(b *testing.B) {
	payload := struct {
		Records string `json:"records"`
	}{Records: strings.Repeat("x", 616000)}
	outbox := NewOutbox(DefaultOutboxCapacity)
	if code := outbox.WriteJSON(model.FrameKindGenericDone, payload); code != model.ErrOK {
		b.Fatal(code)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		outbox.Clear()
		if code := outbox.WriteJSON(model.FrameKindGenericDone, payload); code != model.ErrOK {
			b.Fatal(code)
		}
	}
}
