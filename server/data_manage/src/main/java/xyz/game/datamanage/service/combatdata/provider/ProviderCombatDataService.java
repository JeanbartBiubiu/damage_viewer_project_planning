package xyz.game.datamanage.service.combatdata.provider;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.combatdata.CombatListenerMatchTypesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderDefinitionsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderFormulasMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderLifecyclesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderListenersMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderModifiersMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderStateFieldsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderTickSequencesMapper;
import xyz.game.datamanage.service.combatdata.revision.GameDataRevisionService;
import xyz.game.datamanage.service.combatdata.support.CombatDataSupport;

@Service
public class ProviderCombatDataService {

    private final CombatDataSupport support;
    private final GameDataRevisionService revisionService;
    private final CombatProviderDefinitionsMapper providersMapper;
    private final CombatProviderLifecyclesMapper lifecyclesMapper;
    private final CombatProviderStateFieldsMapper stateFieldsMapper;
    private final CombatProviderFormulasMapper formulasMapper;
    private final CombatProviderModifiersMapper modifiersMapper;
    private final CombatProviderListenersMapper listenersMapper;
    private final CombatListenerMatchTypesMapper matchTypesMapper;
    private final CombatProviderTickSequencesMapper tickSequencesMapper;

    public ProviderCombatDataService(
        CombatDataSupport support,
        GameDataRevisionService revisionService,
        CombatProviderDefinitionsMapper providersMapper,
        CombatProviderLifecyclesMapper lifecyclesMapper,
        CombatProviderStateFieldsMapper stateFieldsMapper,
        CombatProviderFormulasMapper formulasMapper,
        CombatProviderModifiersMapper modifiersMapper,
        CombatProviderListenersMapper listenersMapper,
        CombatListenerMatchTypesMapper matchTypesMapper,
        CombatProviderTickSequencesMapper tickSequencesMapper
    ) {
        this.support = support;
        this.revisionService = revisionService;
        this.providersMapper = providersMapper;
        this.lifecyclesMapper = lifecyclesMapper;
        this.stateFieldsMapper = stateFieldsMapper;
        this.formulasMapper = formulasMapper;
        this.modifiersMapper = modifiersMapper;
        this.listenersMapper = listenersMapper;
        this.matchTypesMapper = matchTypesMapper;
        this.tickSequencesMapper = tickSequencesMapper;
    }

    @Transactional(readOnly = true)
    public ObjectNode listProviders(String gameId) {
        support.requireGame(gameId);
        return support.publicList(gameId, providersMapper.list(gameId));
    }

    @Transactional(readOnly = true)
    public ObjectNode listLifecycles(String gameId, String providerId) {
        support.requireGame(gameId);
        return support.publicList(gameId, lifecyclesMapper.list(gameId, providerId));
    }

    @Transactional(readOnly = true)
    public ObjectNode listStateFields(String gameId, String providerId) {
        support.requireGame(gameId);
        return support.publicList(gameId, stateFieldsMapper.list(gameId, providerId));
    }

    @Transactional(readOnly = true)
    public ObjectNode listFormulas(String gameId, String providerId) {
        support.requireGame(gameId);
        return support.publicList(gameId, formulasMapper.list(gameId, providerId));
    }

    @Transactional(readOnly = true)
    public ObjectNode listModifiers(String gameId, String providerId) {
        support.requireGame(gameId);
        return support.publicList(gameId, modifiersMapper.list(gameId, providerId));
    }

    @Transactional(readOnly = true)
    public ObjectNode listListeners(String gameId, String providerId, String abilityId) {
        support.requireGame(gameId);
        return support.publicList(gameId, listenersMapper.list(gameId, providerId, abilityId));
    }

    @Transactional(readOnly = true)
    public ObjectNode listMatchTypes(String gameId, String listenerId) {
        support.requireGame(gameId);
        return support.publicList(gameId, matchTypesMapper.list(gameId, listenerId));
    }

    @Transactional(readOnly = true)
    public ObjectNode listTickSequences(String gameId, String providerId, String sequenceId) {
        support.requireGame(gameId);
        return support.publicList(gameId, tickSequencesMapper.list(gameId, providerId, sequenceId));
    }

    @Transactional
    public ObjectNode putProvider(String gameId, String providerId, ObjectNode body) {
        support.requireGame(gameId);
        ObjectNode req = support.requireBody(body);
        int providerKindTypeId = support.requireInt(req, "providerKindTypeId");
        String displayName = support.requireText(req, "displayName");
        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() ->
            providersMapper.upsert(gameId, revision, providerId, providerKindTypeId, displayName)
        );
        return support.adminWriteResponse(providersMapper.findById(gameId, providerId), revision);
    }

    @Transactional
    public ObjectNode putLifecycle(String gameId, String providerId, ObjectNode body) {
        support.requireGame(gameId);
        ObjectNode req = support.requireBody(body);
        String durationFormulaKey = support.optionalText(req, "durationFormulaKey");
        int maxStacks = req.has("maxStacks") ? support.requireInt(req, "maxStacks") : 1;
        Integer refreshPolicyTypeId = support.optionalInt(req, "refreshPolicyTypeId");
        Integer tickIntervalMs = support.optionalInt(req, "tickIntervalMs");
        Integer startDelayMs = support.optionalInt(req, "startDelayMs");
        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() -> lifecyclesMapper.upsert(
            gameId,
            revision,
            providerId,
            durationFormulaKey,
            maxStacks,
            refreshPolicyTypeId,
            tickIntervalMs,
            startDelayMs
        ));
        return support.adminWriteResponse(lifecyclesMapper.findById(gameId, providerId), revision);
    }

    @Transactional
    public ObjectNode putFormula(String gameId, String providerId, String formulaKey, ObjectNode body) {
        support.requireGame(gameId);
        ObjectNode req = support.requireBody(body);
        String expression = support.requireJsonObjectString(req, "expression");
        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() ->
            formulasMapper.upsert(gameId, revision, providerId, formulaKey, expression)
        );
        return support.adminWriteResponse(formulasMapper.findById(gameId, providerId, formulaKey), revision);
    }

    @Transactional
    public ObjectNode putStateField(String gameId, String providerId, String stateKey, ObjectNode body) {
        support.requireGame(gameId);
        ObjectNode req = support.requireBody(body);
        int valueTypeId = support.requireInt(req, "valueTypeId");
        BigDecimal maxValue = support.optionalDecimal(req, "maxValue");
        Long durationMs = null;
        if (req.has("durationMs") && !req.get("durationMs").isNull()) {
            durationMs = support.requireLong(req, "durationMs");
        }
        Integer refreshPolicyTypeId = support.optionalInt(req, "refreshPolicyTypeId");
        long revision = revisionService.nextRevision(gameId);
        Long durationMsParam = durationMs;
        support.withConstraintMapping(() ->
            stateFieldsMapper.upsert(
                gameId,
                revision,
                providerId,
                stateKey,
                valueTypeId,
                maxValue,
                durationMsParam,
                refreshPolicyTypeId
            )
        );
        return support.adminWriteResponse(stateFieldsMapper.findById(gameId, providerId, stateKey), revision);
    }

    @Transactional
    public ObjectNode putModifier(String gameId, String modifierId, ObjectNode body) {
        support.requireGame(gameId);
        ObjectNode req = support.requireBody(body);
        String providerId = support.requireText(req, "providerId");
        String modifierKey = support.requireText(req, "modifierKey");
        Integer modifierTypeId = support.optionalInt(req, "modifierTypeId");
        int targetSelectorTypeId = support.requireInt(req, "targetSelectorTypeId");
        String targetAttrKey = support.requireText(req, "targetAttrKey");
        Integer commandTypeId = support.optionalInt(req, "commandTypeId");
        Integer channelTypeId = support.optionalInt(req, "channelTypeId");
        Integer bucketTypeId = support.optionalInt(req, "bucketTypeId");
        Integer stageTypeId = support.optionalInt(req, "stageTypeId");
        int priority = req.has("priority") ? support.requireInt(req, "priority") : 0;
        int valuePolicyTypeId = support.requireInt(req, "valuePolicyTypeId");
        String valueFormulaKey = support.requireText(req, "valueFormulaKey");
        String conditionFormulaKey = support.optionalText(req, "conditionFormulaKey");
        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() -> modifiersMapper.upsert(
            gameId,
            revision,
            modifierId,
            providerId,
            modifierKey,
            modifierTypeId,
            targetSelectorTypeId,
            targetAttrKey,
            commandTypeId,
            channelTypeId,
            bucketTypeId,
            stageTypeId,
            priority,
            valuePolicyTypeId,
            valueFormulaKey,
            conditionFormulaKey
        ));
        return support.adminWriteResponse(modifiersMapper.findById(gameId, modifierId), revision);
    }

    @Transactional
    public ObjectNode putListener(String gameId, String listenerId, ObjectNode body) {
        support.requireGame(gameId);
        ObjectNode req = support.requireBody(body);
        String providerId = support.requireText(req, "providerId");
        String listenerKey = support.requireText(req, "listenerKey");
        int eventTypeId = support.requireInt(req, "eventTypeId");
        String abilityId = support.optionalText(req, "abilityId");
        Integer maxTriggersPerEvent = support.optionalInt(req, "maxTriggersPerEvent");
        String chainLimitKey = support.optionalText(req, "chainLimitKey");
        Integer perCastThrottleMs = support.optionalInt(req, "perCastThrottleMs");
        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() -> listenersMapper.upsert(
            gameId,
            revision,
            listenerId,
            providerId,
            listenerKey,
            eventTypeId,
            abilityId,
            maxTriggersPerEvent,
            chainLimitKey,
            perCastThrottleMs
        ));
        return support.adminWriteResponse(listenersMapper.findById(gameId, listenerId), revision);
    }

    @Transactional
    public ObjectNode putMatchType(
        String gameId,
        String listenerId,
        int matchModeTypeId,
        int typeId,
        ObjectNode body
    ) {
        support.requireGame(gameId);
        support.requireBody(body == null ? JsonNodeFactory.instance.objectNode() : body);
        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() ->
            matchTypesMapper.upsert(gameId, revision, listenerId, matchModeTypeId, typeId)
        );
        return support.adminWriteResponse(
            matchTypesMapper.findById(gameId, listenerId, matchModeTypeId, typeId),
            revision
        );
    }

    @Transactional
    public ObjectNode putTickSequence(String gameId, String providerId, String sequenceId, ObjectNode body) {
        support.requireGame(gameId);
        support.requireBody(body == null ? JsonNodeFactory.instance.objectNode() : body);
        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() ->
            tickSequencesMapper.upsert(gameId, revision, providerId, sequenceId)
        );
        return support.adminWriteResponse(tickSequencesMapper.findById(gameId, providerId, sequenceId), revision);
    }
}
