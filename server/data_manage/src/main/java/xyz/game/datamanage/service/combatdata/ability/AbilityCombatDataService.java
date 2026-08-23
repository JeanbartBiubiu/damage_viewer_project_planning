package xyz.game.datamanage.service.combatdata.ability;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityCooldownsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityDefinitionsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityParametersMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityPhasesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityStateFieldsMapper;
import xyz.game.datamanage.service.combatdata.revision.GameDataRevisionService;
import xyz.game.datamanage.service.combatdata.support.CombatDataSupport;

@Service
public class AbilityCombatDataService {

    private final CombatDataSupport support;
    private final GameDataRevisionService revisionService;
    private final CombatAbilityDefinitionsMapper abilitiesMapper;
    private final CombatAbilityParametersMapper parametersMapper;
    private final CombatAbilityStateFieldsMapper stateFieldsMapper;
    private final CombatAbilityPhasesMapper phasesMapper;
    private final CombatAbilityCooldownsMapper cooldownsMapper;

    public AbilityCombatDataService(
        CombatDataSupport support,
        GameDataRevisionService revisionService,
        CombatAbilityDefinitionsMapper abilitiesMapper,
        CombatAbilityParametersMapper parametersMapper,
        CombatAbilityStateFieldsMapper stateFieldsMapper,
        CombatAbilityPhasesMapper phasesMapper,
        CombatAbilityCooldownsMapper cooldownsMapper
    ) {
        this.support = support;
        this.revisionService = revisionService;
        this.abilitiesMapper = abilitiesMapper;
        this.parametersMapper = parametersMapper;
        this.stateFieldsMapper = stateFieldsMapper;
        this.phasesMapper = phasesMapper;
        this.cooldownsMapper = cooldownsMapper;
    }

    @Transactional(readOnly = true)
    public ObjectNode listAbilities(String gameId, String providerId) {
        support.requireGame(gameId);
        return support.publicList(gameId, abilitiesMapper.list(gameId, providerId));
    }

    @Transactional(readOnly = true)
    public ObjectNode listParameters(String gameId, String abilityId) {
        support.requireGame(gameId);
        return support.publicList(gameId, parametersMapper.list(gameId, abilityId));
    }

    @Transactional(readOnly = true)
    public ObjectNode listStateFields(String gameId, String abilityId) {
        support.requireGame(gameId);
        return support.publicList(gameId, stateFieldsMapper.list(gameId, abilityId));
    }

    @Transactional(readOnly = true)
    public ObjectNode listPhases(String gameId, String abilityId) {
        support.requireGame(gameId);
        return support.publicList(gameId, phasesMapper.list(gameId, abilityId));
    }

    @Transactional(readOnly = true)
    public ObjectNode listCooldowns(String gameId, String abilityId) {
        support.requireGame(gameId);
        return support.publicList(gameId, cooldownsMapper.list(gameId, abilityId));
    }

    @Transactional
    public ObjectNode putAbility(String gameId, String abilityId, ObjectNode body) {
        support.requireGame(gameId);
        ObjectNode req = support.requireBody(body);
        String providerId = support.requireText(req, "providerId");
        String abilityKey = support.requireText(req, "abilityKey");
        int abilityKindTypeId = support.requireInt(req, "abilityKindTypeId");
        String displayName = support.requireText(req, "displayName");
        String castConditionFormulaKey = support.optionalText(req, "castConditionFormulaKey");
        String castOrigin = support.optionalText(req, "castOrigin");
        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() -> abilitiesMapper.upsert(
            gameId,
            revision,
            abilityId,
            providerId,
            abilityKey,
            abilityKindTypeId,
            displayName,
            castConditionFormulaKey,
            castOrigin
        ));
        return support.adminWriteResponse(abilitiesMapper.findById(gameId, abilityId), revision);
    }

    @Transactional
    public ObjectNode putParameter(String gameId, String abilityId, String paramKey, ObjectNode body) {
        support.requireGame(gameId);
        ObjectNode req = support.requireBody(body);
        BigDecimal numericValue = support.requireDecimal(req, "numericValue");
        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() ->
            parametersMapper.upsert(gameId, revision, abilityId, paramKey, numericValue)
        );
        return support.adminWriteResponse(parametersMapper.findById(gameId, abilityId, paramKey), revision);
    }

    @Transactional
    public ObjectNode putStateField(String gameId, String abilityId, String stateKey, ObjectNode body) {
        support.requireGame(gameId);
        ObjectNode req = support.requireBody(body);
        int valueTypeId = support.requireInt(req, "valueTypeId");
        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() ->
            stateFieldsMapper.upsert(gameId, revision, abilityId, stateKey, valueTypeId)
        );
        return support.adminWriteResponse(stateFieldsMapper.findById(gameId, abilityId, stateKey), revision);
    }

    @Transactional
    public ObjectNode putPhase(String gameId, String phaseId, ObjectNode body) {
        support.requireGame(gameId);
        ObjectNode req = support.requireBody(body);
        String abilityId = support.requireText(req, "abilityId");
        int phaseOrder = support.requireInt(req, "phaseOrder");
        int phaseTypeId = support.requireInt(req, "phaseTypeId");
        String durationFormulaKey = support.optionalText(req, "durationFormulaKey");
        boolean interruptible = req.has("interruptible")
            ? support.requireBoolean(req, "interruptible")
            : true;
        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() -> phasesMapper.upsert(
            gameId,
            revision,
            phaseId,
            abilityId,
            phaseOrder,
            phaseTypeId,
            durationFormulaKey,
            interruptible
        ));
        return support.adminWriteResponse(phasesMapper.findById(gameId, phaseId), revision);
    }

    @Transactional
    public ObjectNode putCooldown(String gameId, String cooldownId, ObjectNode body) {
        support.requireGame(gameId);
        ObjectNode req = support.requireBody(body);
        String abilityId = support.requireText(req, "abilityId");
        String durationFormulaKey = support.requireText(req, "durationFormulaKey");
        String startsOnPhaseId = support.optionalText(req, "startsOnPhaseId");
        String groupKey = support.optionalText(req, "groupKey");
        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() -> cooldownsMapper.upsert(
            gameId,
            revision,
            cooldownId,
            abilityId,
            durationFormulaKey,
            startsOnPhaseId,
            groupKey
        ));
        return support.adminWriteResponse(cooldownsMapper.findById(gameId, cooldownId), revision);
    }
}
