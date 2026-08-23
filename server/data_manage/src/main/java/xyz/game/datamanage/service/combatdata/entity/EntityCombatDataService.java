package xyz.game.datamanage.service.combatdata.entity;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.ImagesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEntityAttributeStageValuesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEntityAttributeValuesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEntityProviderMountsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatGameEntitiesMapper;
import xyz.game.datamanage.service.combatdata.revision.GameDataRevisionService;
import xyz.game.datamanage.service.combatdata.support.CombatDataImageReference;
import xyz.game.datamanage.service.combatdata.support.CombatDataSupport;

@Service
public class EntityCombatDataService {

    /** LoL entity-editor contract only; not a generic schema/DDL rule. */
    private static final int LOL_STAGE_MIN = 1;
    private static final int LOL_STAGE_MAX = 18;
    private static final int LOL_STAGE_COUNT = LOL_STAGE_MAX - LOL_STAGE_MIN + 1;

    private static final Set<String> BATCH_TOP_FIELDS = Set.of(
        "expectedCurrentRevision",
        "entityId",
        "displayName",
        "description",
        "imageUri",
        "attributes",
        "providerMounts"
    );
    private static final Set<String> BATCH_ATTR_FIELDS = Set.of("entityId", "attrKey", "baseValue", "stages");
    private static final Set<String> BATCH_ATTR_STAGE_FIELDS = Set.of("stage", "value");
    private static final Set<String> BATCH_MOUNT_FIELDS = Set.of("entityId", "providerId");

    private final CombatDataSupport support;
    private final GameDataRevisionService revisionService;
    private final ImagesMapper imagesMapper;
    private final CombatGameEntitiesMapper entitiesMapper;
    private final CombatEntityAttributeValuesMapper attributeValuesMapper;
    private final CombatEntityAttributeStageValuesMapper attributeStageValuesMapper;
    private final CombatEntityProviderMountsMapper providerMountsMapper;

    public EntityCombatDataService(
        CombatDataSupport support,
        GameDataRevisionService revisionService,
        ImagesMapper imagesMapper,
        CombatGameEntitiesMapper entitiesMapper,
        CombatEntityAttributeValuesMapper attributeValuesMapper,
        CombatEntityAttributeStageValuesMapper attributeStageValuesMapper,
        CombatEntityProviderMountsMapper providerMountsMapper
    ) {
        this.support = support;
        this.revisionService = revisionService;
        this.imagesMapper = imagesMapper;
        this.entitiesMapper = entitiesMapper;
        this.attributeValuesMapper = attributeValuesMapper;
        this.attributeStageValuesMapper = attributeStageValuesMapper;
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
        CombatDataImageReference.Input imageUriInput = CombatDataImageReference.read(req, support);
        String imageUri = CombatDataImageReference.resolve(
            imageUriInput,
            CombatDataImageReference.existingOf(entitiesMapper.findById(gameId, entityId)),
            gameId,
            imagesMapper,
            support
        );
        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() ->
            entitiesMapper.upsert(gameId, revision, entityId, displayName, description, imageUri)
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
    public ObjectNode putEntityProviderMount(String gameId, String entityId, String providerId, ObjectNode body) {
        support.requireGame(gameId);
        support.requireBody(body == null ? JsonNodeFactory.instance.objectNode() : body);
        long revision = revisionService.nextRevision(gameId);
        support.withConstraintMapping(() ->
            providerMountsMapper.upsert(gameId, revision, entityId, providerId)
        );
        return support.adminWriteResponse(providerMountsMapper.findById(gameId, entityId, providerId), revision);
    }

    /**
     * Entity-editor aggregate write: metadata + submitted attributes (exactly stages 1..18)
     * + additive provider mounts, one transaction and one revision. Omitted sections stay untouched.
     */
    @Transactional
    public ObjectNode putEntityBatch(String gameId, String entityId, ObjectNode body) {
        support.requireGame(gameId);
        ParsedEntityBatch parsed = parseAndValidateBatch(entityId, body);
        String imageUri = CombatDataImageReference.resolve(
            parsed.imageUriInput(),
            CombatDataImageReference.existingOf(entitiesMapper.findById(gameId, entityId)),
            gameId,
            imagesMapper,
            support
        );
        long revision = revisionService.nextRevisionIfExpected(gameId, parsed.expectedCurrentRevision());
        support.withConstraintMapping(() -> {
            entitiesMapper.upsert(
                gameId,
                revision,
                entityId,
                parsed.displayName(),
                parsed.description(),
                imageUri
            );
            for (ParsedAttribute attr : parsed.attributes()) {
                attributeValuesMapper.upsert(gameId, revision, entityId, attr.attrKey(), attr.baseValue());
                for (ParsedAttributeStage stage : attr.stages()) {
                    attributeStageValuesMapper.upsert(
                        gameId,
                        revision,
                        entityId,
                        attr.attrKey(),
                        stage.stage(),
                        stage.value()
                    );
                }
            }
            for (String providerId : parsed.providerIds()) {
                providerMountsMapper.upsert(gameId, revision, entityId, providerId);
            }
        });
        return buildBatchResponse(gameId, entityId, revision, parsed);
    }

    private ParsedEntityBatch parseAndValidateBatch(String entityId, ObjectNode body) {
        ObjectNode req = support.requireBody(body);
        support.validateAllowedFields(req, BATCH_TOP_FIELDS, "");
        if (req.has("entityId")) {
            support.requireIdentityMatch(entityId, support.requireTextAt(req, "entityId", ""), "/entityId");
        }
        long expectedCurrentRevision = support.requireLong(req, "expectedCurrentRevision");
        String displayName = support.requireText(req, "displayName");
        String description = support.optionalText(req, "description");
        CombatDataImageReference.Input imageUriInput = CombatDataImageReference.read(req, support);

        List<ParsedAttribute> attributes = List.of();
        if (req.has("attributes")) {
            attributes = parseAttributes(entityId, support.requireArray(req, "attributes", ""));
        }
        List<String> providerIds = List.of();
        if (req.has("providerMounts")) {
            providerIds = parseProviderMounts(entityId, support.requireArray(req, "providerMounts", ""));
        }
        return new ParsedEntityBatch(
            expectedCurrentRevision,
            displayName,
            description,
            imageUriInput,
            attributes,
            providerIds
        );
    }

    private List<ParsedAttribute> parseAttributes(String entityId, ArrayNode array) {
        List<ParsedAttribute> result = new ArrayList<>();
        Set<String> seenKeys = new HashSet<>();
        for (int i = 0; i < array.size(); i++) {
            String path = "/attributes/" + i;
            ObjectNode item = support.requireObjectAt(array.get(i), path);
            support.validateAllowedFields(item, BATCH_ATTR_FIELDS, path);
            if (item.has("entityId")) {
                support.requireIdentityMatch(
                    entityId,
                    support.requireTextAt(item, "entityId", path),
                    path + "/entityId"
                );
            }
            String attrKey = support.requireTextAt(item, "attrKey", path);
            if (!seenKeys.add(attrKey)) {
                throw support.badRequest("Duplicate attrKey in attributes", Map.of("path", path + "/attrKey"));
            }
            BigDecimal baseValue = support.requireDecimalAt(item, "baseValue", path);
            if (!item.has("stages") || item.get("stages") == null || item.get("stages").isNull()) {
                throw support.badRequest("stages is required", Map.of("path", path + "/stages"));
            }
            if (!item.get("stages").isArray()) {
                throw support.badRequest("stages must be a JSON array", Map.of("path", path + "/stages"));
            }
            List<ParsedAttributeStage> stages = parseAttributeStages(path, (ArrayNode) item.get("stages"));
            result.add(new ParsedAttribute(attrKey, baseValue, stages));
        }
        return result;
    }

    private List<ParsedAttributeStage> parseAttributeStages(String attrPath, ArrayNode stages) {
        if (stages.size() != LOL_STAGE_COUNT) {
            throw support.badRequest(
                "stages must contain exactly levels " + LOL_STAGE_MIN + ".." + LOL_STAGE_MAX,
                Map.of("path", attrPath + "/stages", "expectedCount", LOL_STAGE_COUNT, "actualCount", stages.size())
            );
        }
        boolean[] seen = new boolean[LOL_STAGE_MAX + 1];
        List<ParsedAttributeStage> result = new ArrayList<>(LOL_STAGE_COUNT);
        for (int i = 0; i < stages.size(); i++) {
            String path = attrPath + "/stages/" + i;
            ObjectNode item = support.requireObjectAt(stages.get(i), path);
            support.validateAllowedFields(item, BATCH_ATTR_STAGE_FIELDS, path);
            int stage = support.requireIntAt(item, "stage", path);
            if (stage < LOL_STAGE_MIN || stage > LOL_STAGE_MAX) {
                throw support.badRequest(
                    "stage must be between " + LOL_STAGE_MIN + " and " + LOL_STAGE_MAX,
                    Map.of("path", path + "/stage")
                );
            }
            if (seen[stage]) {
                throw support.badRequest("Duplicate stage in stages", Map.of("path", path + "/stage"));
            }
            seen[stage] = true;
            BigDecimal value = support.requireDecimalAt(item, "value", path);
            result.add(new ParsedAttributeStage(stage, value));
        }
        for (int stage = LOL_STAGE_MIN; stage <= LOL_STAGE_MAX; stage++) {
            if (!seen[stage]) {
                throw support.badRequest(
                    "Missing stage " + stage + " in stages",
                    Map.of("path", attrPath + "/stages", "missingStage", stage)
                );
            }
        }
        return result;
    }

    private List<String> parseProviderMounts(String entityId, ArrayNode array) {
        List<String> result = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < array.size(); i++) {
            String path = "/providerMounts/" + i;
            ObjectNode item = support.requireObjectAt(array.get(i), path);
            support.validateAllowedFields(item, BATCH_MOUNT_FIELDS, path);
            if (item.has("entityId")) {
                support.requireIdentityMatch(
                    entityId,
                    support.requireTextAt(item, "entityId", path),
                    path + "/entityId"
                );
            }
            String providerId = support.requireTextAt(item, "providerId", path);
            if (!seen.add(providerId)) {
                throw support.badRequest(
                    "Duplicate providerId in providerMounts",
                    Map.of("path", path + "/providerId")
                );
            }
            result.add(providerId);
        }
        return result;
    }

    private ObjectNode buildBatchResponse(String gameId, String entityId, long revision, ParsedEntityBatch parsed) {
        ObjectNode response = support.toObjectNode(entitiesMapper.findById(gameId, entityId));
        response.put("gameId", gameId);
        response.put("entityId", entityId);
        response.put("currentRevision", revision);

        ArrayNode attributes = JsonNodeFactory.instance.arrayNode();
        for (ParsedAttribute attr : parsed.attributes()) {
            ObjectNode attrNode = support.toObjectNode(
                attributeValuesMapper.findById(gameId, entityId, attr.attrKey())
            );
            ArrayNode stages = JsonNodeFactory.instance.arrayNode();
            List<Map<String, Object>> stageRows =
                attributeStageValuesMapper.list(gameId, entityId, attr.attrKey());
            if (stageRows != null) {
                for (Map<String, Object> row : stageRows) {
                    stages.add(support.toObjectNode(row));
                }
            }
            attrNode.set("stages", stages);
            attributes.add(attrNode);
        }
        response.set("attributes", attributes);

        ArrayNode mounts = JsonNodeFactory.instance.arrayNode();
        for (String providerId : parsed.providerIds()) {
            mounts.add(support.toObjectNode(providerMountsMapper.findById(gameId, entityId, providerId)));
        }
        response.set("providerMounts", mounts);
        return response;
    }

    private record ParsedEntityBatch(
        long expectedCurrentRevision,
        String displayName,
        String description,
        CombatDataImageReference.Input imageUriInput,
        List<ParsedAttribute> attributes,
        List<String> providerIds
    ) {
    }

    private record ParsedAttribute(String attrKey, BigDecimal baseValue, List<ParsedAttributeStage> stages) {
    }

    private record ParsedAttributeStage(int stage, BigDecimal value) {
    }

}
