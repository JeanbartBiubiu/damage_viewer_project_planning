package xyz.game.datamanage.support.maintenance;

import java.util.UUID;

public record MaintenancePrincipal(UUID principalId, String displayName) {
    public static final String REQUEST_ATTRIBUTE = "xyz.game.datamanage.maintenance.principal";
}
