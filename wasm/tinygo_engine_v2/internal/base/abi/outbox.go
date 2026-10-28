// 固定容量 outbox：宿主经 engine_outbox_ptr/len 读取，WriteJSON 追加 frame。
//
// 不变量：generic compile_result/done/error/snapshot/release_result（210..214）为优先帧，
// 与已有内容冲突时清空缓冲后重试；单帧超过 capacity 的优先帧返回 E_QUEUE_OVERFLOW；
// 非优先帧可丢弃（dropped 计数）。
package abi

import (
	"encoding/json"

	"tinygo_engine_v2/internal/model"
)

const DefaultOutboxCapacity = 1024 * 1024

// OutboxAPI 集中声明有界输出缓冲的借用、写入和清理，保持原帧及错误运输格式。
// 声明用于阅读与编译检查；实际调用继续使用具体类型。
type OutboxAPI interface {
	// Bytes 借用当前输出字节，只在缓冲下次写入或清理之前有效，调用方不得修改。
	Bytes() []byte
	// Clear 清空本轮输出字节和丢弃计数，供宿主完成读取后复用缓冲。
	Clear()
	// Dropped 返回自上次清理以来累计丢弃的输出帧数。
	Dropped() int
	// WriteFrame 写入原格式帧；普通帧容量不足时计丢弃并返回成功，优先帧按既有规则清空旧缓冲或返回溢出。
	WriteFrame(kind model.FrameKind, flags uint32, payload []byte) model.ErrCode
	// WriteJSON 编码载荷并写入指定类型帧，失败返回现有错误码。
	WriteJSON(kind model.FrameKind, payload any) model.ErrCode
}

type Outbox struct {
	buf     []byte
	dropped int
}

type outboxJSONWriter struct {
	outbox *Outbox
	kind   model.FrameKind
	code   model.ErrCode
}

var _ OutboxAPI = (*Outbox)(nil)

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
	writer := outboxJSONWriter{outbox: o, kind: kind, code: model.ErrOK}
	// Encoder 借用编码池缓冲，避免 Marshal 为每次完整结果分配副本。
	// 完成编码后才写出箱；编码失败不会改变已有帧。
	if err := json.NewEncoder(&writer).Encode(payload); err != nil {
		return model.ErrInvalidInput
	}
	return writer.code
}

func (w *outboxJSONWriter) Write(encoded []byte) (int, error) {
	written := len(encoded)
	// Encoder 追加的分隔换行不属于协议中的 JSON payload。
	if written > 0 && encoded[written-1] == '\n' {
		encoded = encoded[:written-1]
	}
	w.code = w.outbox.WriteFrame(w.kind, 0, encoded)
	return written, nil
}

func (o *Outbox) WriteFrame(kind model.FrameKind, flags uint32, payload []byte) model.ErrCode {
	capacity := cap(o.buf)

	// 先比较可用 payload 容量，避免头长度相加溢出，也不分配临时帧。
	if len(payload) > capacity-HeaderLen {
		if isPriorityFrame(kind) {
			o.buf = o.buf[:0]
			return model.ErrQueueOverflow
		}
		o.dropped++
		return model.ErrOK
	}

	frameLen := HeaderLen + len(payload)
	if frameLen > capacity-len(o.buf) {
		if isPriorityFrame(kind) {
			o.buf = o.buf[:0]
		} else {
			o.dropped++
			return model.ErrOK
		}
	}

	start := len(o.buf)
	o.buf = o.buf[:start+frameLen]
	// payload 可能引用原出箱；先移动正文，再写头，保留重叠输入。
	copy(o.buf[start+HeaderLen:], payload)
	writeFrameHeader(o.buf[start:start+HeaderLen], kind, flags, len(payload))
	return model.ErrOK
}

func isPriorityFrame(kind model.FrameKind) bool {
	return kind == model.FrameKindGenericCompileResult ||
		kind == model.FrameKindGenericDone ||
		kind == model.FrameKindGenericError ||
		kind == model.FrameKindGenericSnapshot ||
		kind == model.FrameKindGenericReleaseResult
}
