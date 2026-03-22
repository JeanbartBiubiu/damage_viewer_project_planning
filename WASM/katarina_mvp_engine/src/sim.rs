#![allow(dead_code)]
#![allow(unsafe_op_in_unsafe_fn)]

const SAMPLE_STRIDE: usize = 5;
const RESULT_STRIDE: usize = 7;
const MAX_SAMPLES: usize = 64;

const STOP_REASON_COMPLETED: f64 = 0.0;
const STOP_REASON_ENEMY_DEAD: f64 = 1.0;
const STOP_REASON_SELF_DEAD: f64 = 2.0;
const STOP_REASON_MAX_SECONDS: f64 = 3.0;
const STOP_REASON_CANCELLED: f64 = 4.0;
const STOP_REASON_ERROR: f64 = 5.0;

static mut SAMPLE_BUFFER: [f64; MAX_SAMPLES * SAMPLE_STRIDE] = [0.0; MAX_SAMPLES * SAMPLE_STRIDE];
static mut RESULT_BUFFER: [f64; RESULT_STRIDE] = [0.0; RESULT_STRIDE];

#[unsafe(no_mangle)]
pub extern "C" fn sample_stride() -> u32 {
    SAMPLE_STRIDE as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn result_stride() -> u32 {
    RESULT_STRIDE as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn samples_ptr() -> *const f64 {
    core::ptr::addr_of!(SAMPLE_BUFFER).cast::<f64>()
}

#[unsafe(no_mangle)]
pub extern "C" fn result_ptr() -> *const f64 {
    core::ptr::addr_of!(RESULT_BUFFER).cast::<f64>()
}

#[unsafe(no_mangle)]
pub extern "C" fn run_basic_attack(
    self_hp: f64,
    self_ad: f64,
    self_attack_speed: f64,
    enemy_hp: f64,
    enemy_armor: f64,
    attack_ratio: f64,
    hit_count: u32,
    max_duration_ms: u32,
) -> u32 {
    unsafe {
        clear_buffers();

        let mut state = RunState::new(self_hp, enemy_hp, max_duration_ms as f64);
        let attack_speed = self_attack_speed.max(0.1);
        let interval_ms = 1000.0 / attack_speed;
        let damage_ratio = if attack_ratio > 0.0 { attack_ratio } else { 1.0 };
        let mut stop_reason = STOP_REASON_COMPLETED;
        let mut time_to_kill_enemy = -1.0;

        for hit_index in 0..hit_count {
            let t_ms = ((hit_index + 1) as f64 * interval_ms).round();
            if t_ms > state.max_duration_ms {
                stop_reason = STOP_REASON_MAX_SECONDS;
                state.action_duration_ms = state.max_duration_ms;
                break;
            }

            let raw_damage = self_ad.max(0.0) * damage_ratio;
            let dealt_damage = apply_mitigation(raw_damage, enemy_armor);
            state.enemy_hp = (state.enemy_hp - dealt_damage).max(0.0);
            state.total_damage_to_enemy += dealt_damage;
            state.executed_hits += 1.0;
            state.action_duration_ms = t_ms;
            state.push_sample(t_ms);

            if state.enemy_hp <= 0.0 {
                stop_reason = STOP_REASON_ENEMY_DEAD;
                time_to_kill_enemy = t_ms;
                break;
            }
        }

        write_result(stop_reason, time_to_kill_enemy, &state);
        state.sample_count
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn run_death_lotus(
    self_hp: f64,
    self_base_attack_speed: f64,
    self_attack_speed: f64,
    self_ad: f64,
    self_ap: f64,
    enemy_hp: f64,
    enemy_magic_resist: f64,
    base_damage: f64,
    ad_ratio: f64,
    ap_ratio: f64,
    bonus_attack_speed_ratio: f64,
    hit_count: u32,
    hit_interval_ms: u32,
    channel_duration_ms: u32,
    max_duration_ms: u32,
) -> u32 {
    unsafe {
        clear_buffers();

        let mut state = RunState::new(self_hp, enemy_hp, max_duration_ms as f64);
        let interval_ms = (hit_interval_ms.max(1)) as f64;
        let bonus_attack_speed = (self_attack_speed - self_base_attack_speed).max(0.0);
        let mut stop_reason = STOP_REASON_COMPLETED;
        let mut time_to_kill_enemy = -1.0;

        for hit_index in 0..hit_count {
            let t_ms = if hit_index == 0 {
                0.0
            } else {
                hit_index as f64 * interval_ms
            };

            if t_ms > state.max_duration_ms {
                stop_reason = STOP_REASON_MAX_SECONDS;
                state.action_duration_ms = state.max_duration_ms;
                break;
            }

            let raw_damage = base_damage.max(0.0)
                + self_ad.max(0.0) * ad_ratio.max(0.0) * (1.0 + bonus_attack_speed * bonus_attack_speed_ratio.max(0.0))
                + self_ap.max(0.0) * ap_ratio.max(0.0);
            let dealt_damage = apply_mitigation(raw_damage, enemy_magic_resist);
            state.enemy_hp = (state.enemy_hp - dealt_damage).max(0.0);
            state.total_damage_to_enemy += dealt_damage;
            state.executed_hits += 1.0;
            state.action_duration_ms = t_ms;
            state.push_sample(t_ms);

            if state.enemy_hp <= 0.0 {
                stop_reason = STOP_REASON_ENEMY_DEAD;
                time_to_kill_enemy = t_ms;
                break;
            }
        }

        if stop_reason == STOP_REASON_COMPLETED {
            state.action_duration_ms = state.action_duration_ms.max(channel_duration_ms as f64);
            if state.action_duration_ms > state.max_duration_ms {
                state.action_duration_ms = state.max_duration_ms;
                stop_reason = STOP_REASON_MAX_SECONDS;
            }
        }

        write_result(stop_reason, time_to_kill_enemy, &state);
        state.sample_count
    }
}

struct RunState {
    self_hp: f64,
    enemy_hp: f64,
    total_damage_to_enemy: f64,
    total_damage_to_self: f64,
    executed_hits: f64,
    action_duration_ms: f64,
    max_duration_ms: f64,
    sample_count: u32,
}

impl RunState {
    fn new(self_hp: f64, enemy_hp: f64, max_duration_ms: f64) -> Self {
        Self {
            self_hp: self_hp.max(0.0),
            enemy_hp: enemy_hp.max(0.0),
            total_damage_to_enemy: 0.0,
            total_damage_to_self: 0.0,
            executed_hits: 0.0,
            action_duration_ms: 0.0,
            max_duration_ms: max_duration_ms.max(1.0),
            sample_count: 0,
        }
    }

    unsafe fn push_sample(&mut self, t_ms: f64) {
        if self.sample_count as usize >= MAX_SAMPLES {
            return;
        }
        let offset = self.sample_count as usize * SAMPLE_STRIDE;
        SAMPLE_BUFFER[offset] = round_value(t_ms);
        SAMPLE_BUFFER[offset + 1] = round_value(self.self_hp);
        SAMPLE_BUFFER[offset + 2] = round_value(self.enemy_hp);
        SAMPLE_BUFFER[offset + 3] = round_value(self.total_damage_to_enemy);
        SAMPLE_BUFFER[offset + 4] = round_value(self.total_damage_to_self);
        self.sample_count += 1;
    }
}

unsafe fn clear_buffers() {
    for value in core::ptr::addr_of_mut!(SAMPLE_BUFFER).cast::<f64>().as_mut_slice(MAX_SAMPLES * SAMPLE_STRIDE) {
        *value = 0.0;
    }
    for value in core::ptr::addr_of_mut!(RESULT_BUFFER).cast::<f64>().as_mut_slice(RESULT_STRIDE) {
        *value = 0.0;
    }
}

unsafe fn write_result(stop_reason: f64, time_to_kill_enemy: f64, state: &RunState) {
    RESULT_BUFFER[0] = stop_reason;
    RESULT_BUFFER[1] = round_value(time_to_kill_enemy);
    RESULT_BUFFER[2] = round_value(state.total_damage_to_enemy);
    RESULT_BUFFER[3] = round_value(state.total_damage_to_self);
    RESULT_BUFFER[4] = round_value(state.executed_hits);
    RESULT_BUFFER[5] = round_value(state.action_duration_ms);
    RESULT_BUFFER[6] = state.sample_count as f64;
}

fn apply_mitigation(raw_damage: f64, resistance: f64) -> f64 {
    if resistance >= 0.0 {
        round_value(raw_damage * (100.0 / (100.0 + resistance)))
    } else {
        round_value(raw_damage * (2.0 - 100.0 / (100.0 - resistance)))
    }
}

fn round_value(value: f64) -> f64 {
    if value < 0.0 {
        -1.0
    } else {
        (value * 1000.0).round() / 1000.0
    }
}

trait PointerSliceExt<T> {
    unsafe fn as_mut_slice(self, len: usize) -> &'static mut [T];
}

impl<T> PointerSliceExt<T> for *mut T {
    unsafe fn as_mut_slice(self, len: usize) -> &'static mut [T] {
        core::slice::from_raw_parts_mut(self, len)
    }
}
