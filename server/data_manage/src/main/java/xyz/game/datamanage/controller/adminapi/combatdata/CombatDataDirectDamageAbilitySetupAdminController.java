package xyz.game.datamanage.controller.adminapi.combatdata;

import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.controller.adminapi.AdminEditLogHelper;
import xyz.game.datamanage.service.combatdata.ability.DirectDamageAbilitySetupService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

/**
 * Second named aggregate write exception after entity {@code :batch}:
 * one direct-damage ability graph under a single optimistic revision.
 */
@RestController
@RequestMapping("/api/admin/games/{gameId}/combat-data")
public class CombatDataDirectDamageAbilitySetupAdminController {

    private final DirectDamageAbilitySetupService service;
    private final AdminEditLogHelper logHelper;

    public CombatDataDirectDamageAbilitySetupAdminController(
        DirectDamageAbilitySetupService service,
        AdminEditLogHelper logHelper
    ) {
        this.service = service;
        this.logHelper = logHelper;
    }

    @PutMapping("/providers/{providerId}/abilities/{abilityId}:direct-damage-setup")
    public ObjectNode putDirectDamageSetup(
        @PathVariable("gameId") String gameId,
        @PathVariable("providerId") String providerId,
        @PathVariable("abilityId") String abilityId,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = service.putDirectDamageSetup(gameId, providerId, abilityId, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }
}
