package xyz.game.enginev2demo;

import java.util.ArrayList;
import java.util.List;

import xyz.game.enginev2demo.api.EngineRunResult;

public final class BenchmarkBattleTimingMain {

    private static final int WARMUP = 20;
    private static final int SAMPLES = 200;

    private BenchmarkBattleTimingMain() {
    }

    public static void main(String[] args) {
        EngineDemoFacade facade = new EngineDemoFacade();
        var session = facade.init(BenchmarkBattleSampleFactory.bundle());

        long firstStart = System.nanoTime();
        EngineRunResult firstResult = facade.run(session, BenchmarkBattleSampleFactory.runInput());
        double firstUs = microsSince(firstStart);

        for (int i = 0; i < WARMUP; i++) {
            facade.run(session, BenchmarkBattleSampleFactory.runInput());
        }

        List<Double> samplesUs = new ArrayList<>(SAMPLES);
        for (int i = 0; i < SAMPLES; i++) {
            long start = System.nanoTime();
            facade.run(session, BenchmarkBattleSampleFactory.runInput());
            samplesUs.add(microsSince(start));
        }

        samplesUs.sort(Double::compareTo);
        double avgUs = samplesUs.stream().mapToDouble(Double::doubleValue).average().orElse(0.0);

        System.out.println("=== Java Demo Benchmark Battle Timing ===");
        System.out.printf("first_run_us=%.3f%n", firstUs);
        System.out.printf("sample_count=%d warmup=%d%n", SAMPLES, WARMUP);
        System.out.printf("min_us=%.3f%n", samplesUs.getFirst());
        System.out.printf("p50_us=%.3f%n", percentile(samplesUs, 50.0));
        System.out.printf("avg_us=%.3f%n", avgUs);
        System.out.printf("p95_us=%.3f%n", percentile(samplesUs, 95.0));
        System.out.printf("max_us=%.3f%n", samplesUs.getLast());
        System.out.printf(
                "battle_summary final_time_ms=%d processed_events=%d stop=%s self_hp=%.3f enemy_hp=%.3f logs=%d%n",
                firstResult.finalTimeMs(),
                firstResult.processedEvents(),
                firstResult.stopReason(),
                firstResult.actors().get("self").currentHp(),
                firstResult.actors().get("enemy").currentHp(),
                firstResult.logs().size());
    }

    private static double microsSince(long startNs) {
        return (System.nanoTime() - startNs) / 1_000.0;
    }

    private static double percentile(List<Double> sorted, double p) {
        if (sorted.isEmpty()) {
            return 0.0;
        }
        int index = (int) Math.round((p / 100.0) * (sorted.size() - 1));
        return sorted.get(Math.max(0, Math.min(index, sorted.size() - 1)));
    }
}
