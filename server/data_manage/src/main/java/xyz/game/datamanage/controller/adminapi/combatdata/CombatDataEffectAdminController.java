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
import xyz.game.datamanage.service.combatdata.effect.EffectCombatDataService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@RequestMapping("/api/admin/games/{gameId}/combat-data")
public class CombatDataEffectAdminController {

    private final EffectCombatDataService service;
    private final AdminEditLogHelper logHelper;

    public CombatDataEffectAdminController(EffectCombatDataService service, AdminEditLogHelper logHelper) {
        this.service = service;
        this.logHelper = logHelper;
    }

    @PutMapping("/effect-sequences/{sequenceId}")
    public ObjectNode putSequence(
        @PathVariable("gameId") String gameId,
        @PathVariable("sequenceId") String sequenceId,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = service.putSequence(gameId, sequenceId, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }

    @PutMapping("/effect-steps/{stepId}")
    public ObjectNode putStep(
        @PathVariable("gameId") String gameId,
        @PathVariable("stepId") String stepId,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = service.putStep(gameId, stepId, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }

    @PutMapping("/ability-phases/{phaseId}/effect-sequences/{triggerTypeId}/{sequenceId}")
    public ObjectNode putPhaseEffectSequence(
        @PathVariable("gameId") String gameId,
        @PathVariable("phaseId") String phaseId,
        @PathVariable("triggerTypeId") int triggerTypeId,
        @PathVariable("sequenceId") String sequenceId,
        @RequestBody(required = false) ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = service.putPhaseEffectSequence(gameId, phaseId, triggerTypeId, sequenceId, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }

    @PutMapping("/listeners/{listenerId}/effect-sequences/{sequenceId}")
    public ObjectNode putListenerEffectSequence(
        @PathVariable("gameId") String gameId,
        @PathVariable("listenerId") String listenerId,
        @PathVariable("sequenceId") String sequenceId,
        @RequestBody(required = false) ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = service.putListenerEffectSequence(gameId, listenerId, sequenceId, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }
}
