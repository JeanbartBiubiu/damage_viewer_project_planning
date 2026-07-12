package xyz.game.datamanage.service.combatdata.entity;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.combatdata.CombatEntityAttributeStageValuesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEntityAttributeValuesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEntityProviderMountsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEntityResourceStageValuesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEntityResourceValuesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatGameEntitiesMapper;
import xyz.game.datamanage.service.combatdata.revision.GameDataRevisionService;
import xyz.game.datamanage.service.combatdata.support.CombatDataSupport;

@Service
public class EntityCombatDataService {

    private final CombatDataSupport support;
    private final GameDataRevisionService revisionService;
    private final CombatGameEntitiesMapper entitiesMapper;
    private final CombatEntityAttributeValuesMapper attributeValuesMapper;
    private final CombatEntityAttributeStageValuesMapper attributeStageValuesMapper;
    private final CombatEntityResourceValuesMapper resourceValuesMapper;
    private final CombatEntityResourceStageValuesMapper resourceStageValuesMapper;
    private final CombatEntityProviderMountsMapper providerMountsMapper;

    public EntityCombatDataService(
        CombatDataSupport support,
        GameDataRevisionService revisionService,
        CombatGameEntitiesMapper entitiesMapper,
        CombatEntityAttributeValuesMapper attributeValuesMapper,
        CombatEntityAttributeStageValuesMapper attributeStageValuesMapper,
        CombatEntityResourceValuesMapper resourceValuesMapper,
        CombatEntityResourceStageValuesMapper resourceStageValuesMapper,
        CombatEntityProviderMountsMapper providerMountsMapper
    ) {
        this.support = support;
        this.revisionService = revisionService;
        this.entitiesMapper = entitiesMapper;
        this.attributeValuesMapper = attributeValuesMapper;
        this.attributeStageValuesMapper = attributeStageValuesMapper;
        this.resourceValuesMapper = resourceValuesMapper;
        this.resourceStageValuesMapper = resourceStageValuesMapper;
        this.providerMountsMapper = providerMountsMapper;
    }

    @Transactional(readOnly = true)
    public ObjectNode listEntities(String gameId) {
        support.requireGame(gameId);
        return support.publicList(gameId, entitiesMapper.list(gameId));
    }

    @Transactional(readOnly = true)
    public ObjectNode getEntity(String gameId, String entityId) {
        support.requireGame(gameId);
        return support.publicObject(
            gameId,
            entitiesMapper.findById(gameId, entityId),
            "Entity not found",
            Map.of("gameId", gameId, "entityId", entityId)
        );
    }

    @Transactional(readOnly = true)
    public ObjectNode listEntityAttributes(String gameId, String entityId) {
        support.requireGame(gameId);
        return support.publicList(gameId, attributeValuesMapper.list(gameId, entityId));
    }

    @Transactional(readOnly = true)
    public ObjectNode listEntityAttributeStages(String gameId, String entityId, String attrKey) {
        support.requireGame(gameId);
        return support.publicList(gameId, attributeStageValuesMapper.list(gameId, entityId, attrKey));
    }

    @Transactional(readOnly = true)
    public ObjectNode listEntityResources(String gameId, String entityId) {
        support.requireGame(gameId);
        return support.publicList(gameId, resourceValuesMapper.list(gameId, entityId));
    }

    @Transactional(readOnly = true)
    public ObjectNode listEntityResourceStages(String gameId, String entityId, String resourceKey) {
        support.requireGame(gameId);
        return support.publicList(gameId, resourceStageValuesMapper.list(gameId, entityId, resourceKey));
    }

    @Transactional(readOnly = true)
    public ObjectNode listEntityProviderMounts(String gameId, String entityId, String providerId) {
        support.requireGame(gameId);
        return support.publicList(gameId, providerMountsMapper.list(gameId, entityId, providerId));
    }

    @Transactional
    public ObjectNode putEntity(String gameId, String entityId, ObjectNode body) {
        support.requireGame(gameId);
        ObjectNode req = support.requireBody(body);
        String displayName = support.requireText(req, "displayName");
        String description = support.optionalText(req, "description");
        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() ->
            entitiesMapper.upsert(gameId, revision, entityId, displayName, description)
        );
        return support.adminWriteResponse(entitiesMapper.findById(gameId, entityId), revision);
    }

    @Transactional
    public ObjectNode putEntityAttribute(String gameId, String entityId, String attrKey, ObjectNode body) {
        support.requireGame(gameId);
        ObjectNode req = support.requireBody(body);
        BigDecimal baseValue = support.requireDecimal(req, "baseValue");
        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() ->
            attributeValuesMapper.upsert(gameId, revision, entityId, attrKey, baseValue)
        );
        return support.adminWriteResponse(attributeValuesMapper.findById(gameId, entityId, attrKey), revision);
    }

    @Transactional
    public ObjectNode putEntityAttributeStage(
        String gameId,
        String entityId,
        String attrKey,
        int stage,
        ObjectNode body
    ) {
        support.requireGame(gameId);
        ObjectNode req = support.requireBody(body);
        BigDecimal value = support.requireDecimal(req, "value");
        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() ->
            attributeStageValuesMapper.upsert(gameId, revision, entityId, attrKey, stage, value)
        );
        return support.adminWriteResponse(
            attributeStageValuesMapper.findById(gameId, entityId, attrKey, stage),
            revision
        );
    }

    @Transactional
    public ObjectNode putEntityResource(String gameId, String entityId, String resourceKey, ObjectNode body) {
        support.requireGame(gameId);
        ObjectNode req = support.requireBody(body);
        BigDecimal initialValue = support.requireDecimal(req, "initialValue");
        BigDecimal maxValue = support.requireDecimal(req, "maxValue");
        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() ->
            resourceValuesMapper.upsert(gameId, revision, entityId, resourceKey, initialValue, maxValue)
        );
        return support.adminWriteResponse(resourceValuesMapper.findById(gameId, entityId, resourceKey), revision);
    }

    @Transactional
    public ObjectNode putEntityResourceStage(
        String gameId,
        String entityId,
        String resourceKey,
        int stage,
        ObjectNode body
    ) {
        support.requireGame(gameId);
        ObjectNode req = support.requireBody(body);
        BigDecimal initialValue = support.requireDecimal(req, "initialValue");
        BigDecimal maxValue = support.requireDecimal(req, "maxValue");
        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() ->
            resourceStageValuesMapper.upsert(gameId, revision, entityId, resourceKey, stage, initialValue, maxValue)
        );
        return support.adminWriteResponse(
            resourceStageValuesMapper.findById(gameId, entityId, resourceKey, stage),
            revision
        );
    }

    @Transactional
    public ObjectNode putEntityProviderMount(String gameId, String entityId, String providerId, ObjectNode body) {
        support.requireGame(gameId);
        support.requireBody(body == null ? com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode() : body);
        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() ->
            providerMountsMapper.upsert(gameId, revision, entityId, providerId)
        );
        return support.adminWriteResponse(providerMountsMapper.findById(gameId, entityId, providerId), revision);
    }
}
