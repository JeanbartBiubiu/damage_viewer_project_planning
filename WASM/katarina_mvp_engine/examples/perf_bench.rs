//! Performance benchmark harness for katarina_mvp_engine.
//! 
//! Usage:  cargo run --example perf_bench --release
//!
//! Measures:
//!   - init_session()    warmup=20  samples=2000
//!   - run_full_battle() warmup=20  samples=100
//!   - engine::run()     warmup=20  samples=100   (damage_taken_window scenario)
//!   - Multi-thread throughput at 2 / 6 / 14 / 15 / 28 threads
//!     Each thread: warmup=50, measured=200 iterations

use katarina_mvp_engine::{
    init_session, run, run_full_battle, CombatantInit, EngineActionPlan, EngineInitPayload,
    EngineRunInput, InitialCombatants, StopCondition,
};
use std::sync::Arc;
use std::time::Instant;

const PAYLOAD_PATH: &str =
    concat!(env!("CARGO_MANIFEST_DIR"), "/../benchmark_m1_init_payload.json");

const ST_WARMUP: usize = 20;
const INIT_SAMPLES: usize = 2000;
const BATTLE_SAMPLES: usize = 100;

const MT_WARMUP: usize = 50;
const MT_SAMPLES: usize = 200;
const MT_THREAD_COUNTS: &[usize] = &[2, 6, 14, 15, 28];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn sanitize_json(raw: &str) -> String {
    raw.lines()
        .map(|line| {
            let trimmed = line.trim_start();
            let indent = &line[..line.len().saturating_sub(trimmed.len())];
            if trimmed.starts_with("\"name\":") && !trimmed.ends_with("\",") && !trimmed.ends_with('"') {
                return format!(r#"{indent}"name": "sanitized_name","#);
            }
            if trimmed.starts_with("\"label\":") && !trimmed.ends_with("\",") && !trimmed.ends_with('"') {
                return format!(r#"{indent}"label": "sanitized_label","#);
            }
            line.to_string()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn load_payload(json: &str) -> EngineInitPayload {
    serde_json::from_str(json).expect("benchmark payload json should deserialize")
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let idx = ((p / 100.0) * (sorted.len().saturating_sub(1)) as f64).round() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

fn print_stats(label: &str, mut samples_us: Vec<f64>) {
    if samples_us.is_empty() {
        println!("  {label} | (no samples)");
        return;
    }
    samples_us.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = samples_us.len() as f64;
    let avg = samples_us.iter().sum::<f64>() / n;
    println!(
        "  {label:40} | min={:.3}  p50={:.3}  avg={:.3}  p95={:.3}  max={:.3}  (us)",
        samples_us.first().copied().unwrap_or(0.0),
        percentile(&samples_us, 50.0),
        avg,
        percentile(&samples_us, 95.0),
        samples_us.last().copied().unwrap_or(0.0),
    );
}

fn damage_window_input() -> EngineRunInput {
    EngineRunInput {
        seed: None,
        stop: StopCondition { max_seconds: 5.0 },
        initial: InitialCombatants {
            self_actor: CombatantInit {
                hero_id: "ignored_self".into(),
                level: None,
                item_ids: vec![],
            },
            enemy: CombatantInit {
                hero_id: "ignored_enemy".into(),
                level: None,
                item_ids: vec![],
            },
        },
        overrides: None,
        plan: EngineActionPlan::CastSkill {
            skill_id: "skill_damage_taken_window_probe".into(),
            skill_level: None,
            cast_count: None,
        },
    }
}

// ---------------------------------------------------------------------------
// Single-thread benchmarks
// ---------------------------------------------------------------------------

fn bench_init(payload_json: &str) {
    println!("\n=== 初始化时间（单线程） ===");

    // First call timing
    let start = Instant::now();
    let _ = init_session(load_payload(payload_json)).expect("init_session failed");
    let first_us = start.elapsed().as_nanos() as f64 / 1000.0;
    println!("  首次调用耗时：{:.3} us", first_us);

    // Warmup
    for _ in 0..ST_WARMUP {
        let _ = init_session(load_payload(payload_json)).expect("init_session failed");
    }

    // Measured
    let mut samples_us = Vec::with_capacity(INIT_SAMPLES);
    for _ in 0..INIT_SAMPLES {
        let start = Instant::now();
        let _ = init_session(load_payload(payload_json)).expect("init_session failed");
        samples_us.push(start.elapsed().as_nanos() as f64 / 1000.0);
    }
    println!("  采样次数：{INIT_SAMPLES}\t预热次数：{ST_WARMUP}");
    print_stats("init_session", samples_us);
}

fn bench_battle(payload_json: &str) {
    println!("\n=== 完整战斗计算时间（单线程） ===");

    let session = init_session(load_payload(payload_json)).expect("init_session failed");

    // First call timing
    let start = Instant::now();
    let result = run_full_battle(&session).expect("run_full_battle failed");
    let first_us = start.elapsed().as_nanos() as f64 / 1000.0;
    println!("  首次调用耗时：{:.3} us", first_us);
    println!(
        "  战斗结果：ttk={}ms  hits={}  stop={:?}",
        result.result.time_to_kill_enemy_ms.unwrap_or(0),
        result.result.executed_hits,
        result.result.stop_reason,
    );

    // Warmup
    for _ in 0..ST_WARMUP {
        let _ = run_full_battle(&session).expect("run_full_battle failed");
    }

    // Measured
    let mut samples_us = Vec::with_capacity(BATTLE_SAMPLES);
    for _ in 0..BATTLE_SAMPLES {
        let start = Instant::now();
        let _ = run_full_battle(&session).expect("run_full_battle failed");
        samples_us.push(start.elapsed().as_nanos() as f64 / 1000.0);
    }
    println!("  采样次数：{BATTLE_SAMPLES}\t预热次数：{ST_WARMUP}");
    print_stats("run_full_battle", samples_us);
}

fn bench_damage_window(payload_json: &str) {
    println!("\n=== 受伤窗口场景（单线程） ===");

    let session = init_session(load_payload(payload_json)).expect("init_session failed");
    let input = damage_window_input();

    let start = Instant::now();
    let result = run(&session, input.clone()).expect("run damage window scenario failed");
    let first_us = start.elapsed().as_nanos() as f64 / 1000.0;
    println!("  首次调用耗时：{:.3} us", first_us);
    println!(
        "  场景结果：events={}  damage={:.3}  stop={:?}",
        result.events.len(),
        result.result.total_damage_to_enemy,
        result.result.stop_reason,
    );

    for _ in 0..ST_WARMUP {
        let _ = run(&session, input.clone()).expect("run damage window scenario failed");
    }

    let mut samples_us = Vec::with_capacity(BATTLE_SAMPLES);
    for _ in 0..BATTLE_SAMPLES {
        let start = Instant::now();
        let _ = run(&session, input.clone()).expect("run damage window scenario failed");
        samples_us.push(start.elapsed().as_nanos() as f64 / 1000.0);
    }
    println!("  采样次数：{BATTLE_SAMPLES}\t预热次数：{ST_WARMUP}");
    print_stats("run_damage_window_probe", samples_us);
}

// ---------------------------------------------------------------------------
// Multi-thread throughput benchmark
// ---------------------------------------------------------------------------

fn bench_multi_thread(thread_count: usize, payload_json: Arc<String>) {
    println!("\n--- {thread_count} 线程 ---");

    // Pre-init one session per thread (each thread owns independent state)
    let sessions: Vec<_> = (0..thread_count)
        .map(|_| init_session(load_payload(&payload_json)).expect("init_session failed"))
        .collect();

    // Spawn all threads simultaneously
    let wall_start = Instant::now();
    let handles: Vec<_> = sessions
        .into_iter()
        .map(|session| {
            std::thread::spawn(move || {
                // Warmup (not timed)
                for _ in 0..MT_WARMUP {
                    let _ = run_full_battle(&session).expect("run_full_battle failed");
                }
                // Measured: each thread records its own measured-phase wall time
                let measured_start = Instant::now();
                let mut per_iter_us = Vec::with_capacity(MT_SAMPLES);
                for _ in 0..MT_SAMPLES {
                    let t = Instant::now();
                    let _ = run_full_battle(&session).expect("run_full_battle failed");
                    per_iter_us.push(t.elapsed().as_nanos() as f64 / 1000.0);
                }
                let measured_wall_ms = measured_start.elapsed().as_secs_f64() * 1000.0;
                (measured_wall_ms, per_iter_us)
            })
        })
        .collect();

    let results: Vec<(f64, Vec<f64>)> =
        handles.into_iter().map(|h| h.join().expect("thread panicked")).collect();
    let _ = wall_start; // wall_start captured for reference only
    let max_measured_wall_ms = results.iter().map(|(ms, _)| *ms).fold(0.0_f64, f64::max);

    let total_ops = thread_count * MT_SAMPLES;
    let throughput = total_ops as f64 / (max_measured_wall_ms / 1000.0);

    // Aggregate all latency samples across threads
    let all_latencies: Vec<f64> = results.into_iter().flat_map(|(_, lats)| lats).collect();

    println!(
        "  总操作数：{total_ops}   测量时长：{:.3} ms   并行吞吐量：{:.0} ops/s",
        max_measured_wall_ms,
        throughput,
    );
    print_stats(&format!("{thread_count}T 每次调用延迟"), all_latencies);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

fn main() {
    println!("================================================================");
    println!(" katarina_mvp_engine 性能测试报告");
    println!("================================================================");

    let payload_json = Arc::new(sanitize_json(
        &std::fs::read_to_string(PAYLOAD_PATH).expect("benchmark payload json not found"),
    ));

    // Single-thread
    bench_init(&payload_json);
    bench_battle(&payload_json);
    bench_damage_window(&payload_json);

    // Multi-thread
    println!("\n=== 多线程吞吐量测试 ===");
    println!(
        "  配置：预热 {MT_WARMUP} 次 / 线程，采样 {MT_SAMPLES} 次 / 线程"
    );
    for &tc in MT_THREAD_COUNTS {
        bench_multi_thread(tc, Arc::clone(&payload_json));
    }

    println!("\n================================================================");
    println!(" 测试完成");
    println!("================================================================");
}
