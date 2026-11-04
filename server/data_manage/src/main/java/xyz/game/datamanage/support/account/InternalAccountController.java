package xyz.game.datamanage.support.account;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;
import org.springframework.web.bind.annotation.*;

@RestController
public class InternalAccountController {
    private final AccountMaintenance maintenance;
    private final InternalAccountGuard guard;
    public InternalAccountController(AccountMaintenance maintenance,InternalAccountGuard guard) { this.maintenance=maintenance; this.guard=guard; }
    @PostMapping("/internal/accounts/{accountId}/enable-login")
    public Object enable(@PathVariable UUID accountId,@RequestBody JsonNode body,jakarta.servlet.http.HttpServletRequest request) {
        guard.require(request);
        AccountController.fields(body,"enablementReference"); return maintenance.enable(accountId,AccountController.string(body,"enablementReference"));
    }
}
