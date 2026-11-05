package xyz.game.datamanage.controller.publicapi;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.service.VisitStatisticsService;

@RestController
public class VisitPublicController {
    private final VisitStatisticsService statistics;

    public VisitPublicController(VisitStatisticsService statistics) {
        this.statistics = statistics;
    }

    @PostMapping("/api/visits")
    public ResponseEntity<Void> record(@Valid @RequestBody VisitRequest request) {
        statistics.recordVisit(UUID.fromString(request.visitorId()));
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    public record VisitRequest(
        @NotNull
        @Pattern(regexp = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
        String visitorId
    ) {}
}
