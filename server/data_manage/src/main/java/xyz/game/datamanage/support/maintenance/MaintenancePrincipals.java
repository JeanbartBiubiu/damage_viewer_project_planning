package xyz.game.datamanage.support.maintenance;

import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import xyz.game.datamanage.support.account.AccountStore;

@Component
public class MaintenancePrincipals {
    private final AccountStore store;
    private final MaintenanceProperties properties;
    private final MaintenanceIngress ingress;

    public MaintenancePrincipals(AccountStore store, MaintenanceProperties properties, MaintenanceIngress ingress) {
        this.store = store;
        this.properties = properties;
        this.ingress = ingress;
    }

    public MaintenancePrincipal require(HttpServletRequest request, boolean mutation) {
        ingress.require(request, mutation);
        if (request.getAttribute(MaintenancePrincipal.REQUEST_ATTRIBUTE) instanceof MaintenancePrincipal resolved) {
            return resolved;
        }
        UUID principalId = properties.getPrincipalId();
        if (principalId == null) throw MaintenanceJson.denied();
        MaintenancePrincipal principal = store.first(
            "SELECT id, display_name FROM auth.maintenance_principals WHERE id=? AND NOT disabled",
            (row, index) -> new MaintenancePrincipal(row.getObject("id", UUID.class), row.getString("display_name")), principalId);
        if (principal == null) throw MaintenanceJson.denied();
        request.setAttribute(MaintenancePrincipal.REQUEST_ATTRIBUTE, principal);
        return principal;
    }

    public void lock(MaintenancePrincipal principal) {
        lock(principal.principalId());
    }

    void lock(UUID principalId) {
        if (!principalId.equals(properties.getPrincipalId())
            || !TransactionSynchronizationManager.isActualTransactionActive()) throw MaintenanceJson.denied();
        UUID enabled = store.first("SELECT id FROM auth.maintenance_principals WHERE id=? AND NOT disabled FOR SHARE",
            (row, index) -> row.getObject(1, UUID.class), principalId);
        if (enabled == null) throw MaintenanceJson.denied();
    }
}
