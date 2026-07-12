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
import xyz.game.datamanage.service.combatdata.provider.ProviderCombatDataService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@RequestMapping("/api/admin/games/{gameId}/combat-data")
public class CombatDataProviderAdminController {

    private final ProviderCombatDataService service;
    private final AdminEditLogHelper logHelper;

    public CombatDataProviderAdminController(ProviderCombatDataService service, AdminEditLogHelper logHelper) {
        this.service = service;
        this.logHelper = logHelper;
    }

    @PutMapping("/providers/{providerId}")
    public ObjectNode putProvider(
        @PathVariable("gameId") String gameId,
        @PathVariable("providerId") String providerId,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = service.putProvider(gameId, providerId, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }

    @PutMapping("/providers/{providerId}/lifecycle")
    public ObjectNode putLifecycle(
        @PathVariable("gameId") String gameId,
        @PathVariable("providerId") String providerId,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = service.putLifecycle(gameId, providerId, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }

    @PutMapping("/providers/{providerId}/formulas/{formulaKey}")
    public ObjectNode putFormula(
        @PathVariable("gameId") String gameId,
        @PathVariable("providerId") String providerId,
        @PathVariable("formulaKey") String formulaKey,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = service.putFormula(gameId, providerId, formulaKey, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }

    @PutMapping("/providers/{providerId}/state-fields/{stateKey}")
    public ObjectNode putStateField(
        @PathVariable("gameId") String gameId,
        @PathVariable("providerId") String providerId,
        @PathVariable("stateKey") String stateKey,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = service.putStateField(gameId, providerId, stateKey, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }

    @PutMapping("/provider-modifiers/{modifierId}")
    public ObjectNode putModifier(
        @PathVariable("gameId") String gameId,
        @PathVariable("modifierId") String modifierId,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = service.putModifier(gameId, modifierId, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }

    @PutMapping("/provider-listeners/{listenerId}")
    public ObjectNode putListener(
        @PathVariable("gameId") String gameId,
        @PathVariable("listenerId") String listenerId,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = service.putListener(gameId, listenerId, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }

    @PutMapping("/listeners/{listenerId}/match-types/{matchModeTypeId}/{typeId}")
    public ObjectNode putMatchType(
        @PathVariable("gameId") String gameId,
        @PathVariable("listenerId") String listenerId,
        @PathVariable("matchModeTypeId") int matchModeTypeId,
        @PathVariable("typeId") int typeId,
        @RequestBody(required = false) ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = service.putMatchType(gameId, listenerId, matchModeTypeId, typeId, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }

    @PutMapping("/providers/{providerId}/tick-sequences/{sequenceId}")
    public ObjectNode putTickSequence(
        @PathVariable("gameId") String gameId,
        @PathVariable("providerId") String providerId,
        @PathVariable("sequenceId") String sequenceId,
        @RequestBody(required = false) ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = service.putTickSequence(gameId, providerId, sequenceId, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }
}
