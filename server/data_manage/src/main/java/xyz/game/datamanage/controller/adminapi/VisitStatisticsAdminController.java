package xyz.game.datamanage.controller.adminapi;

import java.util.List;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.service.VisitStatisticsService;
import xyz.game.datamanage.service.VisitStatisticsService.DayStatistics;
import xyz.game.datamanage.support.maintenance.DeploymentCredential;

@RestController
public class VisitStatisticsAdminController {
    private final VisitStatisticsService statistics;
    private final DeploymentCredential deployment;

    public VisitStatisticsAdminController(VisitStatisticsService statistics, DeploymentCredential deployment) {
        this.statistics = statistics;
        this.deployment = deployment;
    }

    @GetMapping("/api/admin/visits/last30days")
    public ResponseEntity<List<DayStatistics>> last30Days(jakarta.servlet.http.HttpServletRequest request) {
        deployment.requireStatistics(request);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(statistics.last30Days());
    }
}
