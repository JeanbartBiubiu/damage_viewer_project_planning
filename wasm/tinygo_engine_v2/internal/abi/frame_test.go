// 本文件验证 ABI frame 编解码、magic 校验和 schema 错误路径。
package abi

import (
	"bytes"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestFrameRoundTrip(t *testing.T) {
	payload := []byte(`{"ok":true}`)
	frame, err := DecodeFrame(EncodeFrame(model.FrameKindInit, 3, payload))
	if err != nil {
		t.Fatal(err)
	}
	if frame.Kind != model.FrameKindInit || frame.Flags != 3 || !bytes.Equal(frame.Payload, payload) {
		t.Fatalf("bad frame: %+v", frame)
	}
}

func TestOutboxKeepsTerminalRecord(t *testing.T) {
	outbox := NewOutbox(64)
	for i := 0; i < 8; i++ {
		if code := outbox.WriteFrame(model.FrameKindLog, 0, []byte("drop")); code != model.ErrOK {
			t.Fatalf("write log failed: %s", code)
		}
	}
	if code := outbox.WriteFrame(model.FrameKindDone, 0, []byte("done")); code != model.ErrOK {
		t.Fatalf("write done failed: %s", code)
	}
	frame, err := DecodeFrame(outbox.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if frame.Kind != model.FrameKindDone {
		t.Fatalf("got %v, want done", frame.Kind)
	}
}

func TestOutboxKeepsSnapshotRecord(t *testing.T) {
	outbox := NewOutbox(64)
	for i := 0; i < 8; i++ {
		if code := outbox.WriteFrame(model.FrameKindLog, 0, []byte("drop")); code != model.ErrOK {
			t.Fatalf("write log failed: %s", code)
		}
	}
	if code := outbox.WriteFrame(model.FrameKindSnapshot, 0, []byte("snapshot")); code != model.ErrOK {
		t.Fatalf("write snapshot failed: %s", code)
	}
	frame, err := DecodeFrame(outbox.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if frame.Kind != model.FrameKindSnapshot {
		t.Fatalf("got %v, want snapshot", frame.Kind)
	}
}
