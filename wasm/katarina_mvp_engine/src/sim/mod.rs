mod action;
mod battle_loop;

pub use battle_loop::{
    run_benchmark_action_sequence,
    run_minimal_benchmark_battle,
    run_single_benchmark_action,
    BenchmarkSequenceFinish,
    BenchmarkSequenceStep,
};

// Only used by benchmark test modules
#[cfg(test)]
pub use battle_loop::{run_first_basic_attack, run_until_stop};
