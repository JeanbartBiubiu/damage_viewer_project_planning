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
    private final xyz.game.datamanage.support.maintenance.MaintenanceSessions maintenance;

    public VisitStatisticsAdminController(VisitStatisticsService statistics,xyz.game.datamanage.support.maintenance.MaintenanceSessions maintenance) {
        this.statistics = statistics;
        this.maintenance=maintenance;
    }

    @GetMapping("/api/admin/visits/last30days")
    public ResponseEntity<List<DayStatistics>> last30Days(jakarta.servlet.http.HttpServletRequest request) {
        maintenance.credential(request,true);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(statistics.last30Days());
    }
}
