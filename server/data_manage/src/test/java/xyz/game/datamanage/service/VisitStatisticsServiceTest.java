package xyz.game.datamanage.service;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import xyz.game.datamanage.service.VisitStatisticsService.DayStatistics;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class VisitStatisticsServiceTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);

    @Test
    void reportUsesBeijingDateAcrossUtcMidnightBoundary() {
        var visitor = UUID.randomUUID();
        var before = new VisitStatisticsService(jdbc, Clock.fixed(Instant.parse("2026-11-04T15:59:59Z"), ZoneOffset.UTC));
        var after = new VisitStatisticsService(jdbc, Clock.fixed(Instant.parse("2026-11-04T16:00:00Z"), ZoneOffset.UTC));
        before.recordVisit(visitor);
        after.recordVisit(visitor);
        verify(jdbc).update(anyString(), eq(LocalDate.of(2026, 11, 4)), eq(visitor));
        verify(jdbc).update(anyString(), eq(LocalDate.of(2026, 11, 5)), eq(visitor));
    }

    @Test
    void last30DaysIncludesTodayAndFillsGapsWithoutSummingDailyUniqueVisitors() {
        var today = LocalDate.of(2026, 11, 5);
        var start = today.minusDays(29);
        when(jdbc.query(anyString(), org.mockito.ArgumentMatchers.<RowMapper<DayStatistics>>any(), eq(start), eq(today)))
            .thenReturn(List.of(new DayStatistics(start, 3, 2), new DayStatistics(today, 7, 1)));
        var service = new VisitStatisticsService(jdbc, Clock.fixed(Instant.parse("2026-11-04T16:00:00Z"), ZoneOffset.UTC));

        var days = service.last30Days();

        assertEquals(30, days.size());
        assertEquals(new DayStatistics(start, 3, 2), days.getFirst());
        assertEquals(new DayStatistics(start.plusDays(1), 0, 0), days.get(1));
        assertEquals(new DayStatistics(today, 7, 1), days.getLast());
        for (int i = 1; i < days.size(); i++) assertEquals(days.get(i - 1).date().plusDays(1), days.get(i).date());
    }
}
