//go:build js && wasm

package main

import (
	"encoding/json"
	"syscall/js"

	"go_engine_v2_demo/enginev2demo"
)

var registered []js.Func

func main() {
	session, err := enginev2demo.NewBenchmarkSession()
	if err != nil {
		panic(err)
	}

	api := js.Global().Get("Object").New()
	registerFunc(api, "runBenchmarkBattle", func(this js.Value, args []js.Value) any {
		result, err := session.Run(enginev2demo.BenchmarkInput())
		return encodeResult(enginev2demo.Summarize(result), err)
	})
	registerFunc(api, "measureBenchmark", func(this js.Value, args []js.Value) any {
		warmup := 20
		samples := 200
		if len(args) >= 1 {
			warmup = args[0].Int()
		}
		if len(args) >= 2 {
			samples = args[1].Int()
		}
		report, err := enginev2demo.MeasureBenchmark(warmup, samples)
		return encodeResult(report, err)
	})
	js.Global().Set("goEngineV2Demo", api)

	select {}
}

func registerFunc(target js.Value, name string, fn func(this js.Value, args []js.Value) any) {
	wrapped := js.FuncOf(func(this js.Value, args []js.Value) any {
		return fn(this, args)
	})
	registered = append(registered, wrapped)
	target.Set(name, wrapped)
}

func encodeResult(value any, err error) string {
	if err != nil {
		payload, marshalErr := json.Marshal(map[string]any{
			"ok":    false,
			"error": err.Error(),
		})
		if marshalErr != nil {
			return `{"ok":false,"error":"marshal failure"}`
		}
		return string(payload)
	}

	payload, marshalErr := json.Marshal(map[string]any{
		"ok":    true,
		"value": value,
	})
	if marshalErr != nil {
		return `{"ok":false,"error":"marshal failure"}`
	}
	return string(payload)
}
