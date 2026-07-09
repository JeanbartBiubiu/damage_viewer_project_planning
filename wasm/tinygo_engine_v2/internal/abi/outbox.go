// 固定容量 outbox：宿主经 engine_outbox_ptr/len 读取，WriteJSON 追加 frame。
//
// 不变量：done/error/snapshot/action_snapshot 为优先帧，与已有内容冲突时清空缓冲后重试；
// 单帧超过 capacity 的优先帧返回 E_QUEUE_OVERFLOW；tick/log/sample 可丢弃（dropped 计数）。
package abi

import (
	"encoding/json"

	"tinygo_engine_v2/internal/model"
)

const DefaultOutboxCapacity = 1024 * 1024

type Outbox struct {
	buf     []byte
	dropped int
}

func NewOutbox(capacity int) Outbox {
	if capacity <= 0 {
		capacity = DefaultOutboxCapacity
	}
	return Outbox{buf: make([]byte, 0, capacity)}
}

func (o *Outbox) Bytes() []byte {
	return o.buf
}

func (o *Outbox) Clear() {
	o.buf = o.buf[:0]
	o.dropped = 0
}

func (o *Outbox) Dropped() int {
	return o.dropped
}

func (o *Outbox) WriteJSON(kind model.FrameKind, payload any) model.ErrCode {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return model.ErrInvalidInput
	}
	return o.WriteFrame(kind, 0, encoded)
}

func (o *Outbox) WriteFrame(kind model.FrameKind, flags uint32, payload []byte) model.ErrCode {
	frame := EncodeFrame(kind, flags, payload)
	capacity := cap(o.buf)

	if len(frame) > capacity {
		if isPriorityFrame(kind) {
			o.buf = o.buf[:0]
			return model.ErrQueueOverflow
		}
		o.dropped++
		return model.ErrOK
	}

	if len(o.buf)+len(frame) > capacity {
		if isPriorityFrame(kind) {
			o.buf = o.buf[:0]
		} else {
			o.dropped++
			return model.ErrOK
		}
	}

	o.buf = append(o.buf, frame...)
	return model.ErrOK
}

func isPriorityFrame(kind model.FrameKind) bool {
	return kind == model.FrameKindDone ||
		kind == model.FrameKindError ||
		kind == model.FrameKindSnapshot ||
		kind == model.FrameKindActionSnapshot ||
		kind == model.FrameKindGenericCompileResult ||
		kind == model.FrameKindGenericDone ||
		kind == model.FrameKindGenericError ||
		kind == model.FrameKindGenericSnapshot ||
		kind == model.FrameKindGenericReleaseResult
}
