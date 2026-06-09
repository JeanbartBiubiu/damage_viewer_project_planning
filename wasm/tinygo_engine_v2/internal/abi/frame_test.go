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

func TestOutboxDropsOversizedNonPriorityFrame(t *testing.T) {
	outbox := NewOutbox(32)
	payload := make([]byte, 48)
	for i := range payload {
		payload[i] = 'x'
	}
	if code := outbox.WriteFrame(model.FrameKindLog, 0, payload); code != model.ErrOK {
		t.Fatalf("write log code = %s, want OK", code)
	}
	if outbox.Dropped() != 1 {
		t.Fatalf("dropped = %d, want 1", outbox.Dropped())
	}
	if len(outbox.Bytes()) != 0 {
		t.Fatalf("outbox len = %d, want empty buffer", len(outbox.Bytes()))
	}
}

func TestOutboxRejectsOversizedPriorityFrame(t *testing.T) {
	outbox := NewOutbox(32)
	for i := 0; i < 4; i++ {
		if code := outbox.WriteFrame(model.FrameKindLog, 0, []byte("drop")); code != model.ErrOK {
			t.Fatalf("write log failed: %s", code)
		}
	}
	payload := make([]byte, 48)
	for i := range payload {
		payload[i] = 'd'
	}
	if code := outbox.WriteFrame(model.FrameKindDone, 0, payload); code != model.ErrQueueOverflow {
		t.Fatalf("write done code = %s, want E_QUEUE_OVERFLOW", code)
	}
	if len(outbox.Bytes()) != 0 {
		t.Fatalf("outbox len = %d, want no partial frame", len(outbox.Bytes()))
	}
	if _, err := DecodeFrame(outbox.Bytes()); err == nil {
		t.Fatal("decoded invalid frame from empty outbox")
	}
}

func TestDefaultOutboxCapacityFitsLargeDoneFrame(t *testing.T) {
	outbox := NewOutbox(DefaultOutboxCapacity)
	payload := make([]byte, 300*1024)
	for i := range payload {
		payload[i] = byte('a' + (i % 26))
	}
	if code := outbox.WriteFrame(model.FrameKindDone, 0, payload); code != model.ErrOK {
		t.Fatalf("write done code = %s, want OK", code)
	}
	frame, err := DecodeFrame(outbox.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if frame.Kind != model.FrameKindDone || len(frame.Payload) != len(payload) {
		t.Fatalf("bad done frame: kind=%v payloadLen=%d", frame.Kind, len(frame.Payload))
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
