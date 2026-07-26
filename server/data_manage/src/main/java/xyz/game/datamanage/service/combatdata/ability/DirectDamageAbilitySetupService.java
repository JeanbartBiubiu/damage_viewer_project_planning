package xyz.game.datamanage.service.combatdata.ability;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityControlEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityDefinitionsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityPhaseEffectSequencesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityPhasesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAttributeEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatDamageEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEffectSequencesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEffectStepsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEventEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatExecuteEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatHealEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatRepeatEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatResourceEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatShieldEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatStateEffectDetailsMapper;
import xyz.game.datamanage.service.combatdata.effect.EffectCombatDataService;
import xyz.game.datamanage.service.combatdata.revision.GameDataRevisionService;
import xyz.game.datamanage.service.combatdata.support.CombatDataSupport;

/**
 * Named aggregate write for one direct-damage ability graph:
 * Ability → AbilityPhase → EffectSequence → EffectStep(damageDetail) → phase-effect-sequence binding.
 * Does not call granular put* methods (those allocate their own revisions).
 */
@Service
public class DirectDamageAbilitySetupService {

    private static final Set<String> TOP_FIELDS = Set.of(
        "expectedCurrentRevision",
        "ability",
        "phase",
        "effectSequence",
        "effectStep",
        "phaseEffectSequenceBinding"
    );
    private static final Set<String> ABILITY_FIELDS = Set.of(
        "abilityId",
        "providerId",
        "abilityKey",
        "abilityKindTypeId",
        "displayName",
        "castConditionFormulaKey",
        "castOrigin"
    );
    private static final Set<String> PHASE_FIELDS = Set.of(
        "phaseId",
        "abilityId",
        "phaseOrder",
        "phaseTypeId",
        "durationFormulaKey",
        "interruptible"
    );
    private static final Set<String> SEQUENCE_FIELDS = Set.of(
        "sequenceId",
        "providerId",
        "sequenceKey",
        "displayName"
    );
    private static final Set<String> STEP_FIELDS = Set.of(
        "stepId",
        "sequenceId",
        "stepOrder",
        "operationTypeId",
        "targetSelectorTypeId",
        "conditionFormulaKey",
        EffectCombatDataService.DETAIL_DAMAGE
    );
    private static final Set<String> DAMAGE_DETAIL_FIELDS = Set.of(
        "amountFormulaKey",
        "damageTypeId",
        "valuePolicyTypeId",
        "copyableOnHit",
        "critEligible"
    );
    private static final Set<String> BINDING_FIELDS = Set.of("phaseId", "triggerTypeId", "sequenceId");

    private static final List<String> DETAIL_KEYS = List.of(
        EffectCombatDataService.DETAIL_DAMAGE,
        EffectCombatDataService.DETAIL_HEAL,
        EffectCombatDataService.DETAIL_RESOURCE,
        EffectCombatDataService.DETAIL_ATTRIBUTE,
        EffectCombatDataService.DETAIL_SHIELD,
        EffectCombatDataService.DETAIL_PROVIDER,
        EffectCombatDataService.DETAIL_EVENT,
        EffectCombatDataService.DETAIL_ABILITY_CONTROL,
        EffectCombatDataService.DETAIL_STATE,
        EffectCombatDataService.DETAIL_REPEAT,
        EffectCombatDataService.DETAIL_EXECUTE
    );

    private final CombatDataSupport support;
    private final GameDataRevisionService revisionService;
    private final CombatAbilityDefinitionsMapper abilitiesMapper;
    private final CombatAbilityPhasesMapper phasesMapper;
    private final CombatEffectSequencesMapper sequencesMapper;
    private final CombatEffectStepsMapper stepsMapper;
    private final CombatAbilityPhaseEffectSequencesMapper phaseSequencesMapper;
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
    private final CombatExecuteEffectDetailsMapper executeDetailsMapper;

    public DirectDamageAbilitySetupService(
        CombatDataSupport support,
        GameDataRevisionService revisionService,
        CombatAbilityDefinitionsMapper abilitiesMapper,
        CombatAbilityPhasesMapper phasesMapper,
        CombatEffectSequencesMapper sequencesMapper,
        CombatEffectStepsMapper stepsMapper,
        CombatAbilityPhaseEffectSequencesMapper phaseSequencesMapper,
        CombatDamageEffectDetailsMapper damageDetailsMapper,
        CombatHealEffectDetailsMapper healDetailsMapper,
        CombatResourceEffectDetailsMapper resourceDetailsMapper,
        CombatAttributeEffectDetailsMapper attributeDetailsMapper,
        CombatShieldEffectDetailsMapper shieldDetailsMapper,
        CombatProviderEffectDetailsMapper providerDetailsMapper,
        CombatEventEffectDetailsMapper eventDetailsMapper,
        CombatAbilityControlEffectDetailsMapper abilityControlDetailsMapper,
        CombatStateEffectDetailsMapper stateDetailsMapper,
        CombatRepeatEffectDetailsMapper repeatDetailsMapper,
        CombatExecuteEffectDetailsMapper executeDetailsMapper
    ) {
        this.support = support;
        this.revisionService = revisionService;
        this.abilitiesMapper = abilitiesMapper;
        this.phasesMapper = phasesMapper;
        this.sequencesMapper = sequencesMapper;
        this.stepsMapper = stepsMapper;
        this.phaseSequencesMapper = phaseSequencesMapper;
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
        this.executeDetailsMapper = executeDetailsMapper;
    }

    @Transactional
    public ObjectNode putDirectDamageSetup(
        String gameId,
        String providerId,
        String abilityId,
        ObjectNode body
    ) {
        support.requireGame(gameId);
        ParsedSetup parsed = parseAndValidate(providerId, abilityId, body);
        long revision = revisionService.nextRevisionIfExpected(gameId, parsed.expectedCurrentRevision());
        support.withConstraintMapping(() -> {
            abilitiesMapper.upsert(
                gameId,
                revision,
                parsed.ability().abilityId(),
                parsed.ability().providerId(),
                parsed.ability().abilityKey(),
                parsed.ability().abilityKindTypeId(),
                parsed.ability().displayName(),
                parsed.ability().castConditionFormulaKey(),
                parsed.ability().castOrigin()
            );
            phasesMapper.upsert(
                gameId,
                revision,
                parsed.phase().phaseId(),
                parsed.phase().abilityId(),
                parsed.phase().phaseOrder(),
                parsed.phase().phaseTypeId(),
                parsed.phase().durationFormulaKey(),
                parsed.phase().interruptible()
            );
            sequencesMapper.upsert(
                gameId,
                revision,
                parsed.sequence().sequenceId(),
                parsed.sequence().providerId(),
                parsed.sequence().sequenceKey(),
                parsed.sequence().displayName()
            );
            stepsMapper.upsert(
                gameId,
                revision,
                parsed.step().stepId(),
                parsed.step().sequenceId(),
                parsed.step().stepOrder(),
                parsed.step().operationTypeId(),
                parsed.step().targetSelectorTypeId(),
                parsed.step().conditionFormulaKey()
            );
            clearAllDetails(gameId, parsed.step().stepId());
            damageDetailsMapper.upsert(
                gameId,
                revision,
                parsed.step().stepId(),
                parsed.damage().amountFormulaKey(),
                parsed.damage().damageTypeId(),
                parsed.damage().valuePolicyTypeId(),
                parsed.damage().copyableOnHit(),
                parsed.damage().critEligible()
            );
            phaseSequencesMapper.upsert(
                gameId,
                revision,
                parsed.binding().phaseId(),
                parsed.binding().triggerTypeId(),
                parsed.binding().sequenceId()
            );
        });
        return buildResponse(gameId, providerId, abilityId, revision, parsed);
    }

    private ParsedSetup parseAndValidate(String pathProviderId, String pathAbilityId, ObjectNode body) {
        ObjectNode req = support.requireBody(body);
        support.validateAllowedFields(req, TOP_FIELDS, "");
        long expectedCurrentRevision = support.requireLong(req, "expectedCurrentRevision");

        ObjectNode abilityNode = requireNestedObject(req, "ability");
        support.validateAllowedFields(abilityNode, ABILITY_FIELDS, "/ability");
        String abilityId = support.requireTextAt(abilityNode, "abilityId", "/ability");
        support.requireIdentityMatch(pathAbilityId, abilityId, "/ability/abilityId");
        String abilityProviderId = support.requireTextAt(abilityNode, "providerId", "/ability");
        support.requireIdentityMatch(pathProviderId, abilityProviderId, "/ability/providerId");
        ParsedAbility ability = new ParsedAbility(
            abilityId,
            abilityProviderId,
            support.requireTextAt(abilityNode, "abilityKey", "/ability"),
            support.requireIntAt(abilityNode, "abilityKindTypeId", "/ability"),
            support.requireTextAt(abilityNode, "displayName", "/ability"),
            optionalTextAt(abilityNode, "castConditionFormulaKey", "/ability"),
            optionalTextAt(abilityNode, "castOrigin", "/ability")
        );

        ObjectNode phaseNode = requireNestedObject(req, "phase");
        support.validateAllowedFields(phaseNode, PHASE_FIELDS, "/phase");
        String phaseAbilityId = support.requireTextAt(phaseNode, "abilityId", "/phase");
        support.requireIdentityMatch(ability.abilityId(), phaseAbilityId, "/phase/abilityId");
        ParsedPhase phase = new ParsedPhase(
            support.requireTextAt(phaseNode, "phaseId", "/phase"),
            phaseAbilityId,
            support.requireIntAt(phaseNode, "phaseOrder", "/phase"),
            support.requireIntAt(phaseNode, "phaseTypeId", "/phase"),
            optionalTextAt(phaseNode, "durationFormulaKey", "/phase"),
            interruptibleAt(phaseNode, "/phase")
        );

        ObjectNode sequenceNode = requireNestedObject(req, "effectSequence");
        support.validateAllowedFields(sequenceNode, SEQUENCE_FIELDS, "/effectSequence");
        String sequenceProviderId = support.requireTextAt(sequenceNode, "providerId", "/effectSequence");
        support.requireIdentityMatch(pathProviderId, sequenceProviderId, "/effectSequence/providerId");
        support.requireIdentityMatch(ability.providerId(), sequenceProviderId, "/effectSequence/providerId");
        ParsedSequence sequence = new ParsedSequence(
            support.requireTextAt(sequenceNode, "sequenceId", "/effectSequence"),
            sequenceProviderId,
            support.requireTextAt(sequenceNode, "sequenceKey", "/effectSequence"),
            optionalTextAt(sequenceNode, "displayName", "/effectSequence")
        );

        ObjectNode stepNode = requireNestedObject(req, "effectStep");
        support.validateAllowedFields(stepNode, STEP_FIELDS, "/effectStep");
        requireExactlyDamageDetail(stepNode);
        String stepSequenceId = support.requireTextAt(stepNode, "sequenceId", "/effectStep");
        support.requireIdentityMatch(sequence.sequenceId(), stepSequenceId, "/effectStep/sequenceId");
        ObjectNode damageNode = support.requireObjectAt(
            stepNode.get(EffectCombatDataService.DETAIL_DAMAGE),
            "/effectStep/" + EffectCombatDataService.DETAIL_DAMAGE
        );
        support.validateAllowedFields(
            damageNode,
            DAMAGE_DETAIL_FIELDS,
            "/effectStep/" + EffectCombatDataService.DETAIL_DAMAGE
        );
        ParsedStep step = new ParsedStep(
            support.requireTextAt(stepNode, "stepId", "/effectStep"),
            stepSequenceId,
            support.requireIntAt(stepNode, "stepOrder", "/effectStep"),
            support.requireIntAt(stepNode, "operationTypeId", "/effectStep"),
            support.requireIntAt(stepNode, "targetSelectorTypeId", "/effectStep"),
            optionalTextAt(stepNode, "conditionFormulaKey", "/effectStep")
        );
        ParsedDamage damage = new ParsedDamage(
            support.requireTextAt(
                damageNode,
                "amountFormulaKey",
                "/effectStep/" + EffectCombatDataService.DETAIL_DAMAGE
            ),
            support.requireIntAt(
                damageNode,
                "damageTypeId",
                "/effectStep/" + EffectCombatDataService.DETAIL_DAMAGE
            ),
            support.requireIntAt(
                damageNode,
                "valuePolicyTypeId",
                "/effectStep/" + EffectCombatDataService.DETAIL_DAMAGE
            ),
            Boolean.TRUE.equals(
                optionalBooleanAt(
                    damageNode,
                    "copyableOnHit",
                    "/effectStep/" + EffectCombatDataService.DETAIL_DAMAGE
                )
            ),
            Boolean.TRUE.equals(
                optionalBooleanAt(
                    damageNode,
                    "critEligible",
                    "/effectStep/" + EffectCombatDataService.DETAIL_DAMAGE
                )
            )
        );

        ObjectNode bindingNode = requireNestedObject(req, "phaseEffectSequenceBinding");
        support.validateAllowedFields(bindingNode, BINDING_FIELDS, "/phaseEffectSequenceBinding");
        String bindingPhaseId = support.requireTextAt(bindingNode, "phaseId", "/phaseEffectSequenceBinding");
        support.requireIdentityMatch(phase.phaseId(), bindingPhaseId, "/phaseEffectSequenceBinding/phaseId");
        String bindingSequenceId = support.requireTextAt(
            bindingNode,
            "sequenceId",
            "/phaseEffectSequenceBinding"
        );
        support.requireIdentityMatch(
            sequence.sequenceId(),
            bindingSequenceId,
            "/phaseEffectSequenceBinding/sequenceId"
        );
        ParsedBinding binding = new ParsedBinding(
            bindingPhaseId,
            support.requireIntAt(bindingNode, "triggerTypeId", "/phaseEffectSequenceBinding"),
            bindingSequenceId
        );

        return new ParsedSetup(expectedCurrentRevision, ability, phase, sequence, step, damage, binding);
    }

    private ObjectNode requireNestedObject(ObjectNode body, String field) {
        JsonNode value = body.get(field);
        if (value == null || value.isNull()) {
            throw support.badRequest(
                field + " is required and must be a JSON object",
                Map.of("path", "/" + field)
            );
        }
        return support.requireObjectAt(value, "/" + field);
    }

    private void requireExactlyDamageDetail(ObjectNode stepNode) {
        List<String> present = new ArrayList<>();
        for (String key : DETAIL_KEYS) {
            JsonNode node = stepNode.get(key);
            if (node != null && !node.isNull()) {
                present.add(key);
            }
        }
        if (present.isEmpty()) {
            throw support.badRequest(
                "effectStep must include exactly damageDetail",
                Map.of(
                    "path",
                    "/effectStep",
                    "reason",
                    "missing detail",
                    "allowed",
                    List.of(EffectCombatDataService.DETAIL_DAMAGE)
                )
            );
        }
        if (present.size() > 1 || !EffectCombatDataService.DETAIL_DAMAGE.equals(present.get(0))) {
            throw support.badRequest(
                "effectStep must include exactly damageDetail",
                Map.of(
                    "path",
                    "/effectStep",
                    "reason",
                    present.size() > 1 ? "multiple details" : "unsupported detail",
                    "present",
                    present
                )
            );
        }
        JsonNode detailNode = stepNode.get(EffectCombatDataService.DETAIL_DAMAGE);
        if (!detailNode.isObject()) {
            throw support.badRequest(
                EffectCombatDataService.DETAIL_DAMAGE + " must be a JSON object",
                Map.of("path", "/effectStep/" + EffectCombatDataService.DETAIL_DAMAGE)
            );
        }
    }

    private String optionalTextAt(ObjectNode body, String field, String pathPrefix) {
        JsonNode value = body.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        if (!value.isTextual()) {
            throw support.badRequest(
                field + " must be a string",
                Map.of("path", pathPrefix + "/" + field)
            );
        }
        String text = value.asText();
        return text.isBlank() ? null : text;
    }

    private Boolean optionalBooleanAt(ObjectNode body, String field, String pathPrefix) {
        JsonNode value = body.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        if (!value.isBoolean()) {
            throw support.badRequest(
                field + " must be a boolean",
                Map.of("path", pathPrefix + "/" + field)
            );
        }
        return value.booleanValue();
    }

    /** Matches granular putPhase: absent → true; present → required boolean. */
    private boolean interruptibleAt(ObjectNode body, String pathPrefix) {
        if (!body.has("interruptible")) {
            return true;
        }
        Boolean value = optionalBooleanAt(body, "interruptible", pathPrefix);
        if (value == null) {
            throw support.badRequest(
                "interruptible is required and must be a boolean",
                Map.of("path", pathPrefix + "/interruptible")
            );
        }
        return value;
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
        executeDetailsMapper.deleteByStepId(gameId, stepId);
    }

    private ObjectNode buildResponse(
        String gameId,
        String providerId,
        String abilityId,
        long revision,
        ParsedSetup parsed
    ) {
        ObjectNode response = JsonNodeFactory.instance.objectNode();
        response.put("gameId", gameId);
        response.put("providerId", providerId);
        response.put("abilityId", abilityId);
        response.put("currentRevision", revision);
        response.set("ability", support.toObjectNode(abilitiesMapper.findById(gameId, abilityId)));
        response.set("phase", support.toObjectNode(phasesMapper.findById(gameId, parsed.phase().phaseId())));
        response.set(
            "effectSequence",
            support.toObjectNode(sequencesMapper.findById(gameId, parsed.sequence().sequenceId()))
        );

        ObjectNode stepDto = support.toObjectNode(stepsMapper.findById(gameId, parsed.step().stepId()));
        Map<String, Object> damageRow = damageDetailsMapper.findById(gameId, parsed.step().stepId());
        if (damageRow != null && !damageRow.isEmpty()) {
            ObjectNode detail = support.toObjectNode(damageRow);
            detail.remove("gameId");
            detail.remove("stepId");
            detail.remove("changeRevision");
            detail.remove("updatedAt");
            stepDto.set(EffectCombatDataService.DETAIL_DAMAGE, detail);
        }
        response.set("effectStep", stepDto);

        response.set(
            "phaseEffectSequenceBinding",
            support.toObjectNode(
                phaseSequencesMapper.findById(
                    gameId,
                    parsed.binding().phaseId(),
                    parsed.binding().triggerTypeId(),
                    parsed.binding().sequenceId()
                )
            )
        );
        return response;
    }

    private record ParsedSetup(
        long expectedCurrentRevision,
        ParsedAbility ability,
        ParsedPhase phase,
        ParsedSequence sequence,
        ParsedStep step,
        ParsedDamage damage,
        ParsedBinding binding
    ) {
    }

    private record ParsedAbility(
        String abilityId,
        String providerId,
        String abilityKey,
        int abilityKindTypeId,
        String displayName,
        String castConditionFormulaKey,
        String castOrigin
    ) {
    }

    private record ParsedPhase(
        String phaseId,
        String abilityId,
        int phaseOrder,
        int phaseTypeId,
        String durationFormulaKey,
        boolean interruptible
    ) {
    }

    private record ParsedSequence(
        String sequenceId,
        String providerId,
        String sequenceKey,
        String displayName
    ) {
    }

    private record ParsedStep(
        String stepId,
        String sequenceId,
        int stepOrder,
        int operationTypeId,
        int targetSelectorTypeId,
        String conditionFormulaKey
    ) {
    }

    private record ParsedDamage(
        String amountFormulaKey,
        int damageTypeId,
        int valuePolicyTypeId,
        boolean copyableOnHit,
        boolean critEligible
    ) {
    }

    private record ParsedBinding(String phaseId, int triggerTypeId, String sequenceId) {
    }
}
