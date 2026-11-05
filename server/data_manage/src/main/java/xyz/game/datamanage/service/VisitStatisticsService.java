package xyz.game.datamanage.service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class VisitStatisticsService {
    private static final ZoneId STATISTICS_ZONE = ZoneId.of("Asia/Shanghai");
    private final JdbcTemplate jdbc;
    private final Clock clock;

    @Autowired
    public VisitStatisticsService(JdbcTemplate jdbc) {
        this(jdbc, Clock.system(STATISTICS_ZONE));
    }

    VisitStatisticsService(JdbcTemplate jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock.withZone(STATISTICS_ZONE);
    }

    public void recordVisit(UUID visitorId) {
        jdbc.update("""
            INSERT INTO analytics.daily_visits AS visits (visit_date, visitor_id, pv)
            VALUES (?, ?, 1)
            ON CONFLICT (visit_date, visitor_id) DO UPDATE SET pv = visits.pv + 1
            """, LocalDate.now(clock), visitorId);
    }

    public List<DayStatistics> last30Days() {
        LocalDate today = LocalDate.now(clock);
        LocalDate start = today.minusDays(29);
        List<DayStatistics> stored = jdbc.query("""
            SELECT visit_date, sum(pv)::bigint AS pv, count(*) AS uv
            FROM analytics.daily_visits
            WHERE visit_date BETWEEN ? AND ?
            GROUP BY visit_date
            ORDER BY visit_date
            """, (row, index) -> new DayStatistics(
                row.getObject("visit_date", LocalDate.class), row.getLong("pv"), row.getLong("uv")
            ), start, today);
        Map<LocalDate, DayStatistics> byDate = new HashMap<>();
        for (DayStatistics day : stored) byDate.put(day.date(), day);
        return start.datesUntil(today.plusDays(1))
            .map(date -> byDate.getOrDefault(date, new DayStatistics(date, 0, 0)))
            .toList();
    }

    public record DayStatistics(LocalDate date, long pv, long uv) {}
}
