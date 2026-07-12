package xyz.game.datamanage.service.combatdata.type;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.combatdata.CombatAttributeDefinitionsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatGameProgressionSchemaMapper;
import xyz.game.datamanage.mapper.combatdata.CombatResourceDefinitionsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatTypeRelationsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatTypesMapper;
import xyz.game.datamanage.service.combatdata.revision.GameDataRevisionService;
import xyz.game.datamanage.service.combatdata.support.CombatDataSupport;

@Service
public class CombatTypeService {

    private static final Set<String> TARGET_CATEGORIES = Set.of(
        "entity",
        "attribute",
        "resource",
        "provider",
        "ability",
        "ability_phase",
        "modifier",
        "listener",
        "effect_step",
        "type",
        "equipment",
        "skill",
        "character"
    );

    private final CombatDataSupport support;
    private final GameDataRevisionService revisionService;
    private final CombatGameProgressionSchemaMapper progressionSchemaMapper;
    private final CombatAttributeDefinitionsMapper attributeDefinitionsMapper;
    private final CombatResourceDefinitionsMapper resourceDefinitionsMapper;
    private final CombatTypesMapper typesMapper;
    private final CombatTypeRelationsMapper typeRelationsMapper;

    public CombatTypeService(
        CombatDataSupport support,
        GameDataRevisionService revisionService,
        CombatGameProgressionSchemaMapper progressionSchemaMapper,
        CombatAttributeDefinitionsMapper attributeDefinitionsMapper,
        CombatResourceDefinitionsMapper resourceDefinitionsMapper,
        CombatTypesMapper typesMapper,
        CombatTypeRelationsMapper typeRelationsMapper
    ) {
        this.support = support;
        this.revisionService = revisionService;
        this.progressionSchemaMapper = progressionSchemaMapper;
        this.attributeDefinitionsMapper = attributeDefinitionsMapper;
        this.resourceDefinitionsMapper = resourceDefinitionsMapper;
        this.typesMapper = typesMapper;
        this.typeRelationsMapper = typeRelationsMapper;
    }

    @Transactional(readOnly = true)
    public ObjectNode getState(String gameId) {
        support.requireGame(gameId);
        var view = revisionService.getState(gameId);
        ObjectNode data = com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode();
        data.put("gameId", view.gameId());
        data.put("currentRevision", view.currentRevision());
        data.put("publishedRevision", view.publishedRevision());
        support.putValue(data, "updatedAt", view.updatedAt());
        return support.publicEnvelope(gameId, data);
    }

    @Transactional(readOnly = true)
    public ObjectNode getProgressionSchema(String gameId) {
        support.requireGame(gameId);
        Map<String, Object> row = progressionSchemaMapper.findByGameId(gameId);
        if (row == null || row.isEmpty()) {
            throw support.notFound("Progression schema not found", Map.of("gameId", gameId));
        }
        return support.publicEnvelope(gameId, support.toObjectNode(row));
    }

    @Transactional(readOnly = true)
    public ObjectNode listAttributeDefinitions(String gameId) {
        support.requireGame(gameId);
        return support.publicList(gameId, attributeDefinitionsMapper.list(gameId));
    }

    @Transactional(readOnly = true)
    public ObjectNode listResourceDefinitions(String gameId) {
        support.requireGame(gameId);
        return support.publicList(gameId, resourceDefinitionsMapper.list(gameId));
    }

    @Transactional(readOnly = true)
    public ObjectNode listTypes(String gameId) {
        support.requireGame(gameId);
        return support.publicList(gameId, typesMapper.list(gameId));
    }

    @Transactional(readOnly = true)
    public ObjectNode listTypeRelations(String gameId, Integer typeId, String targetCategory, String targetId) {
        support.requireGame(gameId);
        return support.publicList(gameId, typeRelationsMapper.list(gameId, typeId, targetCategory, targetId));
    }

    @Transactional
    public ObjectNode putProgressionSchema(String gameId, ObjectNode body) {
        support.requireGame(gameId);
        ObjectNode req = support.requireBody(body);
        String progressionKind = support.requireText(req, "progressionKind");
        int stageMin = support.requireInt(req, "stageMin");
        int stageMax = support.requireInt(req, "stageMax");
        String stageLabel = support.requireText(req, "stageLabel");
        boolean requireAllStages = req.has("requireAllStages")
            ? support.requireBoolean(req, "requireAllStages")
            : true;
        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() -> progressionSchemaMapper.upsert(
            gameId,
            revision,
            progressionKind,
            stageMin,
            stageMax,
            stageLabel,
            requireAllStages
        ));
        return support.adminWriteResponse(progressionSchemaMapper.findByGameId(gameId), revision);
    }

    @Transactional
    public ObjectNode putAttributeDefinition(String gameId, String attrKey, ObjectNode body) {
        support.requireGame(gameId);
        ObjectNode req = support.requireBody(body);
        int sortOrder = req.has("sortOrder") ? support.requireInt(req, "sortOrder") : 0;
        String attrName = support.optionalText(req, "attrName");
        String attrType = support.optionalText(req, "attrType");
        BigDecimal defaultValue = support.optionalDecimal(req, "defaultValue");
        String valueKind = req.has("valueKind") ? support.requireText(req, "valueKind") : "scalar";
        String rateTargetAttrKey = support.optionalText(req, "rateTargetAttrKey");
        BigDecimal minValue = support.optionalDecimal(req, "minValue");
        BigDecimal maxValue = support.optionalDecimal(req, "maxValue");
        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() -> attributeDefinitionsMapper.upsert(
            gameId,
            revision,
            attrKey,
            sortOrder,
            attrName,
            attrType,
            defaultValue,
            valueKind,
            rateTargetAttrKey,
            minValue,
            maxValue
        ));
        return support.adminWriteResponse(attributeDefinitionsMapper.findById(gameId, attrKey), revision);
    }

    @Transactional
    public ObjectNode putResourceDefinition(String gameId, String resourceKey, ObjectNode body) {
        support.requireGame(gameId);
        ObjectNode req = support.requireBody(body);
        String displayName = support.requireText(req, "displayName");
        BigDecimal defaultInitialValue = req.has("defaultInitialValue")
            ? support.requireDecimal(req, "defaultInitialValue")
            : BigDecimal.ZERO;
        BigDecimal defaultMaxValue = req.has("defaultMaxValue")
            ? support.requireDecimal(req, "defaultMaxValue")
            : BigDecimal.ZERO;
        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() -> resourceDefinitionsMapper.upsert(
            gameId,
            revision,
            resourceKey,
            displayName,
            defaultInitialValue,
            defaultMaxValue
        ));
        return support.adminWriteResponse(resourceDefinitionsMapper.findById(gameId, resourceKey), revision);
    }

    @Transactional
    public ObjectNode putType(String gameId, int typeId, ObjectNode body) {
        support.requireGame(gameId);
        ObjectNode req = support.requireBody(body);
        String typeKey = support.requireText(req, "typeKey");
        String name = support.optionalText(req, "name");
        String description = support.optionalText(req, "description");
        Integer reservedTypeId = support.optionalInt(req, "reservedTypeId");
        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() -> typesMapper.upsert(
            gameId,
            revision,
            typeId,
            typeKey,
            name,
            description,
            reservedTypeId
        ));
        return support.adminWriteResponse(typesMapper.findById(gameId, typeId), revision);
    }

    @Transactional
    public ObjectNode putTypeRelation(
        String gameId,
        int typeId,
        String targetCategory,
        String targetId,
        ObjectNode body
    ) {
        support.requireGame(gameId);
        ObjectNode req = support.requireBody(body == null
            ? com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode()
            : body);
        if (targetCategory == null || !TARGET_CATEGORIES.contains(targetCategory)) {
            throw support.badRequest(
                "targetCategory is invalid",
                Map.of("path", "/targetCategory", "targetCategory", targetCategory == null ? "" : targetCategory)
            );
        }
        String extendJson = support.optionalJsonObjectString(req, "extend");
        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() -> typeRelationsMapper.upsert(
            gameId,
            revision,
            typeId,
            targetCategory,
            targetId,
            extendJson
        ));
        return support.adminWriteResponse(
            typeRelationsMapper.findById(gameId, typeId, targetCategory, targetId),
            revision
        );
    }
}
