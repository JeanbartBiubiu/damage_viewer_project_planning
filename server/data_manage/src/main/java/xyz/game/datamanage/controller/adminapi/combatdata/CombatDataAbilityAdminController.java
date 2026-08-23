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
import xyz.game.datamanage.service.combatdata.ability.AbilityCombatDataService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@RequestMapping("/api/admin/games/{gameId}/combat-data")
public class CombatDataAbilityAdminController {

    private final AbilityCombatDataService service;
    private final AdminEditLogHelper logHelper;

    public CombatDataAbilityAdminController(AbilityCombatDataService service, AdminEditLogHelper logHelper) {
        this.service = service;
        this.logHelper = logHelper;
    }

    @PutMapping("/abilities/{abilityId}")
    public ObjectNode putAbility(
        @PathVariable("gameId") String gameId,
        @PathVariable("abilityId") String abilityId,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = service.putAbility(gameId, abilityId, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }

    @PutMapping("/abilities/{abilityId}/parameters/{paramKey}")
    public ObjectNode putParameter(
        @PathVariable("gameId") String gameId,
        @PathVariable("abilityId") String abilityId,
        @PathVariable("paramKey") String paramKey,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = service.putParameter(gameId, abilityId, paramKey, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }

    @PutMapping("/abilities/{abilityId}/state-fields/{stateKey}")
    public ObjectNode putStateField(
        @PathVariable("gameId") String gameId,
        @PathVariable("abilityId") String abilityId,
        @PathVariable("stateKey") String stateKey,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = service.putStateField(gameId, abilityId, stateKey, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }

    @PutMapping("/ability-phases/{phaseId}")
    public ObjectNode putPhase(
        @PathVariable("gameId") String gameId,
        @PathVariable("phaseId") String phaseId,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = service.putPhase(gameId, phaseId, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }

    @PutMapping("/ability-cooldowns/{cooldownId}")
    public ObjectNode putCooldown(
        @PathVariable("gameId") String gameId,
        @PathVariable("cooldownId") String cooldownId,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = service.putCooldown(gameId, cooldownId, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }
}
