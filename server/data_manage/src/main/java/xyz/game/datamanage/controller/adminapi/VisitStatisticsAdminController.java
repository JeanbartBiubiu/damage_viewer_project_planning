package xyz.game.datamanage.controller.adminapi;

import java.util.List;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.service.VisitStatisticsService;
import xyz.game.datamanage.service.VisitStatisticsService.DayStatistics;

@RestController
public class VisitStatisticsAdminController {
    private final VisitStatisticsService statistics;

    public VisitStatisticsAdminController(VisitStatisticsService statistics) {
        this.statistics = statistics;
    }

    @GetMapping("/api/admin/visits/last30days")
    public ResponseEntity<List<DayStatistics>> last30Days() {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(statistics.last30Days());
    }
}
