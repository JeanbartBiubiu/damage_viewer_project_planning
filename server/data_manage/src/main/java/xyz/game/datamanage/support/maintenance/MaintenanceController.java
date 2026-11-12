package xyz.game.datamanage.support.maintenance;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.bind.annotation.*;
import xyz.game.datamanage.support.account.AccountCrypto;
import xyz.game.datamanage.support.account.AccountStore;

@RestController
@RequestMapping("/internal/maintenance")
public class MaintenanceController {
    private final MaintenanceSessions sessions;
    private final MaintenanceBatches batches;
    private final MaintenanceBaseline baseline;
    private final AccountCrypto crypto;
    private final AccountStore store;
    public MaintenanceController(MaintenanceSessions sessions,MaintenanceBatches batches,MaintenanceBaseline baseline,AccountCrypto crypto,AccountStore store) {
        this.sessions=sessions;this.batches=batches;this.baseline=baseline;this.crypto=crypto;this.store=store;
    }
    @PostMapping("/sessions") public Object create(@RequestBody JsonNode body,HttpServletRequest request,HttpServletResponse response) {
        MaintenanceJson.fields(body);return sessions.create(request,response);
    }
    @GetMapping("/me") public Object me(HttpServletRequest request) { return MaintenanceSessions.view(sessions.require(request,false).context()); }
    @PostMapping("/logout") public void logout(@RequestBody JsonNode body,HttpServletRequest request,HttpServletResponse response) {
        MaintenanceJson.fields(body);sessions.logout(sessions.require(request,true).context(),response);
    }
    @PostMapping("/revoke") public void revoke(@RequestBody JsonNode body,HttpServletRequest request) {MaintenanceJson.fields(body);sessions.revoke(request);}
    @PostMapping("/wasm-grant") public Object grant(@RequestBody JsonNode body,HttpServletRequest request) {
        MaintenanceJson.fields(body);var auth=sessions.require(request,true).context();
        return store.tx(()-> { sessions.lock(auth);Instant now=store.now();return crypto.grant(auth.accountId(),"MAINTENANCE",now,auth.expiresAt()); });
    }
    @GetMapping("/games/{gameId}/baseline") public Object baseline(@PathVariable String gameId,HttpServletRequest request) {
        sessions.require(request,false);return Map.of("gameId",gameId,"baselineDigest",baseline.digest(gameId));
    }
    @PostMapping("/batches") public Object batch(@RequestBody JsonNode body,HttpServletRequest request) {return batches.create(sessions.require(request,true).context(),body);}
    @GetMapping("/batches/{batchId}") public Object batch(@PathVariable UUID batchId,HttpServletRequest request) {return batches.view(batchId,sessions.require(request,false).context());}
    @PostMapping("/batches/{batchId}/open") public Object open(@PathVariable UUID batchId,@RequestBody JsonNode body,HttpServletRequest request) {
        MaintenanceJson.fields(body);sessions.credential(request,true);return batches.open(batchId);
    }
    @PostMapping("/batches/{batchId}/complete") public Object complete(@PathVariable UUID batchId,@RequestBody JsonNode body,HttpServletRequest request) {
        MaintenanceJson.fields(body);sessions.credential(request,true);return batches.complete(batchId);
    }
    @PostMapping("/batches/{batchId}/renew") public Object renew(@PathVariable UUID batchId,@RequestBody JsonNode receipt,HttpServletRequest request) {
        return batches.renew(batchId,sessions.require(request,true).context(),receipt);
    }
    @PostMapping("/batches/{batchId}/recover/{recoveryId}") public Object recover(@PathVariable UUID batchId,@PathVariable UUID recoveryId,@RequestBody JsonNode body,HttpServletRequest request) {
        MaintenanceJson.fields(body);sessions.credential(request,true);return batches.recover(batchId,recoveryId);
    }
}
