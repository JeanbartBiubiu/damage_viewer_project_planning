package xyz.game.datamanage.service.combatdata.effect;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityControlEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityPhaseEffectSequencesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAttributeEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatDamageEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEffectSequencesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEffectStepsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEventEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatHealEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatListenerEffectSequencesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatRepeatEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatResourceEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatShieldEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatStateEffectDetailsMapper;
import xyz.game.datamanage.service.combatdata.revision.GameDataRevisionService;
import xyz.game.datamanage.service.combatdata.support.CombatDataSupport;

@Service
public class EffectCombatDataService {

    public static final String DETAIL_DAMAGE = "damageDetail";
    public static final String DETAIL_HEAL = "healDetail";
    public static final String DETAIL_RESOURCE = "resourceDetail";
    public static final String DETAIL_ATTRIBUTE = "attributeDetail";
    public static final String DETAIL_SHIELD = "shieldDetail";
    public static final String DETAIL_PROVIDER = "providerDetail";
    public static final String DETAIL_EVENT = "eventDetail";
    public static final String DETAIL_ABILITY_CONTROL = "abilityControlDetail";
    public static final String DETAIL_STATE = "stateDetail";
    public static final String DETAIL_REPEAT = "repeatDetail";

    private static final List<String> DETAIL_KEYS = List.of(
        DETAIL_DAMAGE,
        DETAIL_HEAL,
        DETAIL_RESOURCE,
        DETAIL_ATTRIBUTE,
        DETAIL_SHIELD,
        DETAIL_PROVIDER,
        DETAIL_EVENT,
        DETAIL_ABILITY_CONTROL,
        DETAIL_STATE,
        DETAIL_REPEAT
    );

    private final CombatDataSupport support;
    private final GameDataRevisionService revisionService;
    private final CombatEffectSequencesMapper sequencesMapper;
    private final CombatEffectStepsMapper stepsMapper;
    private final CombatAbilityPhaseEffectSequencesMapper phaseSequencesMapper;
    private final CombatListenerEffectSequencesMapper listenerSequencesMapper;
    private final CombatDamageEffectDetailsMapper damageDetailsMapper;
    private final CombatHealEffectDetailsMapper healDetailsMapper;
    private final CombatResourceEffectDetailsMapper resourceDetailsMapper;
    private final CombatAttributeEffectDetailsMapper attributeDetailsMapper;
    private final CombatShieldEffectDetailsMapper shieldDetailsMapper;
    private final CombatProviderEffectDetailsMapper providerDetailsMapper;
    private final CombatEventEffectDetailsMapper eventDetailsMapper;
    private final CombatAbilityControlEffectDetailsMapper abilityControlDetailsMapper;
    private final CombatStateEffectDetailsMapper stateDetailsMapper;
    private final CombatRepeatEffectDetailsMapper repeatDetailsMapper;

    public EffectCombatDataService(
        CombatDataSupport support,
        GameDataRevisionService revisionService,
        CombatEffectSequencesMapper sequencesMapper,
        CombatEffectStepsMapper stepsMapper,
        CombatAbilityPhaseEffectSequencesMapper phaseSequencesMapper,
        CombatListenerEffectSequencesMapper listenerSequencesMapper,
        CombatDamageEffectDetailsMapper damageDetailsMapper,
        CombatHealEffectDetailsMapper healDetailsMapper,
        CombatResourceEffectDetailsMapper resourceDetailsMapper,
        CombatAttributeEffectDetailsMapper attributeDetailsMapper,
        CombatShieldEffectDetailsMapper shieldDetailsMapper,
        CombatProviderEffectDetailsMapper providerDetailsMapper,
        CombatEventEffectDetailsMapper eventDetailsMapper,
        CombatAbilityControlEffectDetailsMapper abilityControlDetailsMapper,
        CombatStateEffectDetailsMapper stateDetailsMapper,
        CombatRepeatEffectDetailsMapper repeatDetailsMapper
    ) {
        this.support = support;
        this.revisionService = revisionService;
        this.sequencesMapper = sequencesMapper;
        this.stepsMapper = stepsMapper;
        this.phaseSequencesMapper = phaseSequencesMapper;
        this.listenerSequencesMapper = listenerSequencesMapper;
        this.damageDetailsMapper = damageDetailsMapper;
        this.healDetailsMapper = healDetailsMapper;
        this.resourceDetailsMapper = resourceDetailsMapper;
        this.attributeDetailsMapper = attributeDetailsMapper;
        this.shieldDetailsMapper = shieldDetailsMapper;
        this.providerDetailsMapper = providerDetailsMapper;
        this.eventDetailsMapper = eventDetailsMapper;
        this.abilityControlDetailsMapper = abilityControlDetailsMapper;
        this.stateDetailsMapper = stateDetailsMapper;
        this.repeatDetailsMapper = repeatDetailsMapper;
    }

    @Transactional(readOnly = true)
    public ObjectNode listSequences(String gameId, String providerId) {
        support.requireGame(gameId);
        return support.publicList(gameId, sequencesMapper.list(gameId, providerId));
    }

    @Transactional(readOnly = true)
    public ObjectNode listSteps(String gameId, String sequenceId) {
        support.requireGame(gameId);
        List<Map<String, Object>> steps = stepsMapper.list(gameId, sequenceId);
        ArrayNode data = JsonNodeFactory.instance.arrayNode();
        for (Map<String, Object> step : steps) {
            data.add(toStepDto(gameId, step));
        }
        return support.publicEnvelope(gameId, data);
    }

    @Transactional(readOnly = true)
    public ObjectNode listPhaseEffectSequences(String gameId, String phaseId, String sequenceId) {
        support.requireGame(gameId);
        return support.publicList(gameId, phaseSequencesMapper.list(gameId, phaseId, sequenceId));
    }

    @Transactional(readOnly = true)
    public ObjectNode listListenerEffectSequences(String gameId, String listenerId, String sequenceId) {
        support.requireGame(gameId);
        return support.publicList(gameId, listenerSequencesMapper.list(gameId, listenerId, sequenceId));
    }

    @Transactional
    public ObjectNode putSequence(String gameId, String sequenceId, ObjectNode body) {
        support.requireGame(gameId);
        ObjectNode req = support.requireBody(body);
        String providerId = support.requireText(req, "providerId");
        String sequenceKey = support.requireText(req, "sequenceKey");
        String displayName = support.optionalText(req, "displayName");
        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() ->
            sequencesMapper.upsert(gameId, revision, sequenceId, providerId, sequenceKey, displayName)
        );
        return support.adminWriteResponse(sequencesMapper.findById(gameId, sequenceId), revision);
    }

    @Transactional
    public ObjectNode putStep(String gameId, String stepId, ObjectNode body) {
        support.requireGame(gameId);
        ObjectNode req = support.requireBody(body);
        String sequenceId = support.requireText(req, "sequenceId");
        int stepOrder = support.requireInt(req, "stepOrder");
        int operationTypeId = support.requireInt(req, "operationTypeId");
        int targetSelectorTypeId = support.requireInt(req, "targetSelectorTypeId");
        String conditionFormulaKey = support.optionalText(req, "conditionFormulaKey");
        DetailChoice detail = resolveExactlyOneDetail(req);

        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() -> {
            stepsMapper.upsert(
                gameId,
                revision,
                stepId,
                sequenceId,
                stepOrder,
                operationTypeId,
                targetSelectorTypeId,
                conditionFormulaKey
            );
            clearAllDetails(gameId, stepId);
            writeDetail(gameId, stepId, revision, detail);
        });

        Map<String, Object> step = stepsMapper.findById(gameId, stepId);
        ObjectNode response = toStepDto(gameId, step);
        response.put("currentRevision", revision);
        return response;
    }

    @Transactional
    public ObjectNode putPhaseEffectSequence(
        String gameId,
        String phaseId,
        int triggerTypeId,
        String sequenceId,
        ObjectNode body
    ) {
        support.requireGame(gameId);
        support.requireBody(body == null ? JsonNodeFactory.instance.objectNode() : body);
        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() ->
            phaseSequencesMapper.upsert(gameId, revision, phaseId, triggerTypeId, sequenceId)
        );
        return support.adminWriteResponse(
            phaseSequencesMapper.findById(gameId, phaseId, triggerTypeId, sequenceId),
            revision
        );
    }

    @Transactional
    public ObjectNode putListenerEffectSequence(
        String gameId,
        String listenerId,
        String sequenceId,
        ObjectNode body
    ) {
        support.requireGame(gameId);
        support.requireBody(body == null ? JsonNodeFactory.instance.objectNode() : body);
        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() ->
            listenerSequencesMapper.upsert(gameId, revision, listenerId, sequenceId)
        );
        return support.adminWriteResponse(
            listenerSequencesMapper.findById(gameId, listenerId, sequenceId),
            revision
        );
    }

    private DetailChoice resolveExactlyOneDetail(ObjectNode body) {
        List<String> present = new ArrayList<>();
        for (String key : DETAIL_KEYS) {
            JsonNode node = body.get(key);
            if (node != null && !node.isNull()) {
                present.add(key);
            }
        }
        if (present.isEmpty()) {
            throw support.badRequest(
                "effect-step body must include exactly one detail object",
                Map.of("path", "/", "reason", "missing detail", "allowed", DETAIL_KEYS)
            );
        }
        if (present.size() > 1) {
            throw support.badRequest(
                "effect-step body must include exactly one detail object",
                Map.of("path", "/", "reason", "multiple details", "present", present)
            );
        }
        String key = present.get(0);
        JsonNode detailNode = body.get(key);
        if (!detailNode.isObject()) {
            throw support.badRequest(key + " must be a JSON object", Map.of("path", "/" + key));
        }
        return new DetailChoice(key, (ObjectNode) detailNode);
    }

    private void clearAllDetails(String gameId, String stepId) {
        damageDetailsMapper.deleteByStepId(gameId, stepId);
        healDetailsMapper.deleteByStepId(gameId, stepId);
        resourceDetailsMapper.deleteByStepId(gameId, stepId);
        attributeDetailsMapper.deleteByStepId(gameId, stepId);
        shieldDetailsMapper.deleteByStepId(gameId, stepId);
        providerDetailsMapper.deleteByStepId(gameId, stepId);
        eventDetailsMapper.deleteByStepId(gameId, stepId);
        abilityControlDetailsMapper.deleteByStepId(gameId, stepId);
        stateDetailsMapper.deleteByStepId(gameId, stepId);
        repeatDetailsMapper.deleteByStepId(gameId, stepId);
    }

    private void writeDetail(String gameId, String stepId, long revision, DetailChoice detail) {
        ObjectNode d = detail.body();
        switch (detail.key()) {
            case DETAIL_DAMAGE -> damageDetailsMapper.upsert(
                gameId,
                revision,
                stepId,
                support.requireText(d, "amountFormulaKey"),
                support.requireInt(d, "damageTypeId"),
                support.requireInt(d, "valuePolicyTypeId"),
                Boolean.TRUE.equals(support.optionalBoolean(d, "copyableOnHit"))
            );
            case DETAIL_HEAL -> healDetailsMapper.upsert(
                gameId,
                revision,
                stepId,
                support.requireText(d, "amountFormulaKey"),
                support.requireInt(d, "valuePolicyTypeId")
            );
            case DETAIL_RESOURCE -> resourceDetailsMapper.upsert(
                gameId,
                revision,
                stepId,
                support.requireText(d, "resourceKey"),
                support.requireText(d, "amountFormulaKey"),
                support.requireInt(d, "valuePolicyTypeId")
            );
            case DETAIL_ATTRIBUTE -> attributeDetailsMapper.upsert(
                gameId,
                revision,
                stepId,
                support.requireText(d, "attrKey"),
                support.requireText(d, "amountFormulaKey"),
                support.requireInt(d, "valuePolicyTypeId")
            );
            case DETAIL_SHIELD -> shieldDetailsMapper.upsert(
                gameId,
                revision,
                stepId,
                support.requireText(d, "shieldRef"),
                support.requireText(d, "amountFormulaKey"),
                support.optionalText(d, "durationFormulaKey"),
                support.requireInt(d, "valuePolicyTypeId")
            );
            case DETAIL_PROVIDER -> providerDetailsMapper.upsert(
                gameId,
                revision,
                stepId,
                support.requireInt(d, "actionTypeId"),
                support.requireText(d, "targetProviderId"),
                support.optionalText(d, "stacksFormulaKey"),
                support.optionalText(d, "durationFormulaKey")
            );
            case DETAIL_EVENT -> eventDetailsMapper.upsert(
                gameId,
                revision,
                stepId,
                support.requireInt(d, "eventTypeId"),
                support.optionalText(d, "eventRef"),
                d.has("payload")
                    ? support.requireJsonObjectString(d, "payload")
                    : "{}"
            );
            case DETAIL_ABILITY_CONTROL -> abilityControlDetailsMapper.upsert(
                gameId,
                revision,
                stepId,
                support.requireInt(d, "actionTypeId"),
                support.requireText(d, "targetAbilityId"),
                support.optionalText(d, "amountFormulaKey"),
                support.optionalInt(d, "valuePolicyTypeId")
            );
            case DETAIL_STATE -> stateDetailsMapper.upsert(
                gameId,
                revision,
                stepId,
                support.requireInt(d, "stateScopeTypeId"),
                support.requireText(d, "stateKey"),
                support.requireText(d, "amountFormulaKey"),
                support.requireInt(d, "valuePolicyTypeId")
            );
            case DETAIL_REPEAT -> repeatDetailsMapper.upsert(
                gameId,
                revision,
                stepId,
                support.requireInt(d, "repeatScopeTypeId"),
                support.requireInt(d, "repeatCount"),
                support.requireText(d, "repeatTag"),
                support.requireText(d, "triggerStateKey"),
                support.requireDecimal(d, "threshold")
            );
            default -> throw support.badRequest(
                "Unsupported detail key",
                Map.of("path", "/" + detail.key())
            );
        }
    }

    private ObjectNode toStepDto(String gameId, Map<String, Object> step) {
        ObjectNode dto = support.toObjectNode(step);
        if (step == null || step.isEmpty()) {
            return dto;
        }
        String stepId = String.valueOf(step.get("stepId"));
        attachDetail(dto, DETAIL_DAMAGE, damageDetailsMapper.findById(gameId, stepId));
        attachDetail(dto, DETAIL_HEAL, healDetailsMapper.findById(gameId, stepId));
        attachDetail(dto, DETAIL_RESOURCE, resourceDetailsMapper.findById(gameId, stepId));
        attachDetail(dto, DETAIL_ATTRIBUTE, attributeDetailsMapper.findById(gameId, stepId));
        attachDetail(dto, DETAIL_SHIELD, shieldDetailsMapper.findById(gameId, stepId));
        attachDetail(dto, DETAIL_PROVIDER, providerDetailsMapper.findById(gameId, stepId));
        attachDetail(dto, DETAIL_EVENT, eventDetailsMapper.findById(gameId, stepId));
        attachDetail(dto, DETAIL_ABILITY_CONTROL, abilityControlDetailsMapper.findById(gameId, stepId));
        attachDetail(dto, DETAIL_STATE, stateDetailsMapper.findById(gameId, stepId));
        attachDetail(dto, DETAIL_REPEAT, repeatDetailsMapper.findById(gameId, stepId));
        return dto;
    }

    private void attachDetail(ObjectNode dto, String key, Map<String, Object> detailRow) {
        if (detailRow == null || detailRow.isEmpty()) {
            return;
        }
        ObjectNode detail = support.toObjectNode(detailRow);
        detail.remove("gameId");
        detail.remove("stepId");
        detail.remove("changeRevision");
        detail.remove("updatedAt");
        dto.set(key, detail);
    }

    private record DetailChoice(String key, ObjectNode body) {
    }
}
