package xyz.game.datamanage.controller.adminapi.authoring;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.model.authoring.ConfigurationReferenceAuditResponse;
import xyz.game.datamanage.service.authoring.ConfigurationReferenceAuditService;

@RestController
@RequestMapping("/api/admin/games/{gameId}/configuration-reference-audit")
public class ConfigurationReferenceAuditAdminController {
    private final ConfigurationReferenceAuditService service;

    public ConfigurationReferenceAuditAdminController(ConfigurationReferenceAuditService service) {
        this.service = service;
    }

    @GetMapping
    public ConfigurationReferenceAuditResponse audit(@PathVariable("gameId") String gameId) {
        return service.audit(gameId);
    }
}
