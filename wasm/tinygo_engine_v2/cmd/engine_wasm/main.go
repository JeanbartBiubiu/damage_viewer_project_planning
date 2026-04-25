// 本文件是 TinyGo Wasm 导出入口，只保留 ABI 函数、内存分配桥接和全局 session 装配。
package main

import (
	"tinygo_engine_v2/internal/abi"
	"tinygo_engine_v2/internal/runtime"
)

var session = runtime.NewSession()
var allocations = map[uint32][]byte{}

func main() {
}

//export alloc
func alloc(size uint32) uint32 {
	if size == 0 {
		return 0
	}
	buf := make([]byte, size)
	ptr := abi.Ptr(buf)
	allocations[ptr] = buf
	return ptr
}

//export dealloc
func dealloc(ptr uint32, size uint32) {
	delete(allocations, ptr)
}

//export engine_init
func engine_init(ptr uint32, size uint32) int32 {
	return session.InitFrame(abi.Bytes(ptr, size))
}

//export engine_begin_run
func engine_begin_run(ptr uint32, size uint32) int32 {
	return session.BeginRunFrame(abi.Bytes(ptr, size))
}

//export engine_step
func engine_step(maxEvents uint32) int32 {
	return session.Step(maxEvents)
}

//export engine_abort_run
func engine_abort_run() int32 {
	return session.AbortRun()
}

//export engine_outbox_ptr
func engine_outbox_ptr() uint32 {
	return abi.Ptr(session.OutboxBytes())
}

//export engine_outbox_len
func engine_outbox_len() uint32 {
	return uint32(len(session.OutboxBytes()))
}

//export engine_outbox_clear
func engine_outbox_clear() {
	session.ClearOutbox()
}
