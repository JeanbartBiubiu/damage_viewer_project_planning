package xyz.game.datamanage.support.maintenance;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.bind.annotation.*;
import xyz.game.datamanage.support.account.AccountCrypto;
import xyz.game.datamanage.support.account.AccountStore;

@RestController
@RequestMapping("/internal/maintenance")
public class MaintenanceController {
    private final MaintenancePrincipals principals;
    private final DeploymentCredential deployment;
    private final MaintenanceBatches batches;
    private final MaintenanceBaseline baseline;
    private final AccountCrypto crypto;
    private final AccountStore store;
    public MaintenanceController(MaintenancePrincipals principals, DeploymentCredential deployment, MaintenanceBatches batches,
                                 MaintenanceBaseline baseline, AccountCrypto crypto, AccountStore store) {
        this.principals = principals;
        this.deployment = deployment;
        this.batches = batches;
        this.baseline = baseline;
        this.crypto = crypto;
        this.store = store;
    }
    @GetMapping("/me")
    public MaintenancePrincipal me(@RequestAttribute(MaintenancePrincipal.REQUEST_ATTRIBUTE) MaintenancePrincipal principal) {
        return principal;
    }
    @PostMapping("/wasm-grant")
    public Object grant(@RequestBody JsonNode body, @RequestAttribute(MaintenancePrincipal.REQUEST_ATTRIBUTE) MaintenancePrincipal principal) {
        MaintenanceJson.fields(body);
        return store.tx(() -> {
            principals.lock(principal);
            Instant now = store.now();
            return crypto.grant(principal.principalId(), "MAINTENANCE", now, now.plusSeconds(1800));
        });
    }
    @GetMapping("/games/{gameId}/baseline")
    public Object baseline(@PathVariable String gameId, @RequestAttribute(MaintenancePrincipal.REQUEST_ATTRIBUTE) MaintenancePrincipal principal) {
        return Map.of("gameId", gameId, "baselineDigest", baseline.digest(gameId));
    }
    @PostMapping("/batches")
    public Object batch(@RequestBody JsonNode body, @RequestAttribute(MaintenancePrincipal.REQUEST_ATTRIBUTE) MaintenancePrincipal principal) {
        return batches.create(principal, body);
    }
    @GetMapping("/batches/{batchId}")
    public Object batch(@PathVariable UUID batchId, @RequestAttribute(MaintenancePrincipal.REQUEST_ATTRIBUTE) MaintenancePrincipal principal) {
        return batches.view(batchId, principal);
    }
    @PostMapping("/batches/{batchId}/open")
    public Object open(@PathVariable UUID batchId, @RequestBody JsonNode body, HttpServletRequest request) {
        deployment.requireWindowOperation(request);
        MaintenanceJson.fields(body);
        return batches.open(batchId);
    }
    @PostMapping("/batches/{batchId}/complete")
    public Object complete(@PathVariable UUID batchId, @RequestBody JsonNode body, HttpServletRequest request) {
        deployment.requireWindowOperation(request);
        MaintenanceJson.fields(body);
        return batches.complete(batchId);
    }
    @PostMapping("/batches/{batchId}/renew")
    public Object renew(@PathVariable UUID batchId, @RequestBody JsonNode receipt,
                        @RequestAttribute(MaintenancePrincipal.REQUEST_ATTRIBUTE) MaintenancePrincipal principal) {
        return batches.renew(batchId, principal, receipt);
    }
    @PostMapping("/batches/{batchId}/recover/{recoveryId}")
    public Object recover(@PathVariable UUID batchId, @PathVariable UUID recoveryId, @RequestBody JsonNode body, HttpServletRequest request) {
        deployment.requireWindowOperation(request);
        MaintenanceJson.fields(body);
        return batches.recover(batchId, recoveryId);
    }
}
