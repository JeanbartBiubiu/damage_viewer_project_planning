package xyz.game.datamanage.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import org.springframework.context.annotation.Lazy;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.AttributeDefinitionsMapper;
import xyz.game.datamanage.mapper.CoefficientBucketsMapper;
import xyz.game.datamanage.mapper.ControlStateProfilesMapper;
import xyz.game.datamanage.mapper.EditLogMapper;
import xyz.game.datamanage.mapper.FormulaBindingsMapper;
import xyz.game.datamanage.mapper.FormulaProfilesMapper;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.GameVersionsMapper;
import xyz.game.datamanage.mapper.GameProgressionSchemaMapper;
import xyz.game.datamanage.mapper.HeroesMapper;
import xyz.game.datamanage.mapper.ImagesMapper;
import xyz.game.datamanage.mapper.ItemStatModifiersMapper;
import xyz.game.datamanage.mapper.ItemsMapper;
import xyz.game.datamanage.mapper.OwnerCategoriesMapper;
import xyz.game.datamanage.mapper.PublishedBundleSnapshotsMapper;
import xyz.game.datamanage.mapper.SkillMountsMapper;
import xyz.game.datamanage.mapper.SkillsMapper;
import xyz.game.datamanage.mapper.StatusActionControlRulesMapper;
import xyz.game.datamanage.mapper.StatusAttributeModifiersMapper;
import xyz.game.datamanage.mapper.StatusDefinitionsMapper;
import xyz.game.datamanage.mapper.StatusModifierGroupsMapper;
import xyz.game.datamanage.mapper.StatusPeriodicHpEffectsMapper;
import xyz.game.datamanage.mapper.TypeRelationsMapper;
import xyz.game.datamanage.mapper.TypesMapper;
import xyz.game.datamanage.support.error.ApiException;

@Component
public class PostgresWriteStore {

    private static final String WORKSPACE_VERSION_CODE = "__workspace__";

    private static final Pattern OWNER_TYPE_PATTERN = Pattern.compile("^[a-z0-9_]+$");
    private static final Set<String> TARGET_CATEGORIES = Set.of("equipment", "attribute", "skill", "character", "type");
    private static final Set<String> ATTRIBUTE_VALUE_KINDS = Set.of("scalar", "ratio", "rate", "flag");
    private static final Set<String> FORMULA_TYPES = Set.of("cooldown", "regen", "attribute", "damage", "resource_cost", "other");
    private static final Set<String> FORMULA_BINDING_TARGET_CATEGORIES = Set.of("skill", "hero", "item", "global");
    private static final Set<String> SKILL_MOUNT_TARGET_CATEGORIES = Set.of("hero", "item", "global", "skill", "type");
    private static final Set<String> COEFFICIENT_BUCKET_RESOLUTION_DOMAINS = Set.of("attribute", "hp_change");
    private static final Set<String> COEFFICIENT_BUCKET_AGGREGATION_MODES = Set.of("add", "multiply", "pick_max", "set_final");
    private static final Set<String> STATUS_ACTION_CONTROL_RULE_KINDS = Set.of("forbid", "interrupt");
    private static final Set<String> STATUS_KINDS = Set.of("buff", "debuff", "control", "dot", "hot", "shield", "special");
    private static final Set<String> STATUS_SOURCE_SCOPES = Set.of("any_source", "same_source", "same_target_source");
    private static final Set<String> STATUS_STACK_MODES = Set.of(
        "refresh",
        "replace",
        "stack",
        "independent",
        "take_max_duration",
        "take_max_magnitude"
    );
    private static final Set<String> STATUS_DURATION_MODES = Set.of("timed", "permanent");
    private static final Set<String> STATUS_SNAPSHOT_POLICIES = Set.of("on_apply", "dynamic");
    private static final Set<String> STATUS_GROUP_PHASE_KEYS = Set.of("while_active", "on_apply", "on_expire", "on_interval");
    private static final Set<String> STATUS_GROUP_SNAPSHOT_POLICIES = Set.of("on_apply", "dynamic", "per_tick");
    private static final Set<String> STATUS_MODIFIER_MODES = Set.of("flat", "percent", "bucket_add", "bucket_mul", "set_final");
    private static final Set<String> STATUS_PERIODIC_EFFECT_KINDS = Set.of("damage", "heal");
    private static final Set<String> STATUS_PERIODIC_CRIT_CHANCE_SOURCES = Set.of("none", "attacker_crit_chance", "fixed");
    private static final Set<String> DAMAGE_TYPES = Set.of("physical", "magic", "true");
    private static final Set<String> CONTROL_KINDS = Set.of(
        "stun",
        "root",
        "silence",
        "disarm",
        "taunt",
        "fear",
        "charm",
        "airborne",
        "grounded",
        "knockback",
        "pull",
        "suppress",
        "special"
    );
    private static final Set<String> MOVEMENT_LOCK_MODES = Set.of("none", "forbid_move", "force_move", "forbid_turn");
    private static final Set<String> CAST_LOCK_MODES = Set.of("none", "forbid_cast", "interrupt_cast", "forbid_channel", "interrupt_and_forbid");
    private static final Set<String> ATTACK_LOCK_MODES = Set.of("none", "forbid_attack", "interrupt_attack", "interrupt_and_forbid");
    private static final Set<String> INPUT_OVERRIDE_MODES = Set.of(
        "none",
        "force_to_source",
        "force_from_source",
        "force_to_target",
        "force_along_path",
        "force_stop"
    );
    private static final Set<String> DISPLACEMENT_KINDS = Set.of("none", "knockup", "knockback", "pull", "forced_dash");
    private static final Set<String> PROGRESSION_KINDS = Set.of("LEVEL", "STAR");
    private static final Set<String> DPS_PASSIVE_OWNER_ROLES = Set.of("attacker", "target");
    private static final Set<String> DPS_PASSIVE_TRIGGER_EVENTS = Set.of(
        "on_basic_attack_hit",
        "on_spell_hit",
        "on_hit",
        "on_damage_dealt",
        "on_damage_taken",
        "dot_tick"
    );
    private static final Set<String> DPS_PASSIVE_TARGET_ROLES = Set.of("attacker", "target");

    private final HeroesMapper heroesMapper;
    private final SkillsMapper skillsMapper;
    private final SkillMountsMapper skillMountsMapper;
    private final DefaultBasicAttackProvisioner defaultBasicAttackProvisioner;
    private final ItemsMapper itemsMapper;
    private final ItemStatModifiersMapper itemStatModifiersMapper;
    private final FormulaProfilesMapper formulaProfilesMapper;
    private final FormulaBindingsMapper formulaBindingsMapper;
    private final StatusActionControlRulesMapper statusActionControlRulesMapper;
    private final StatusDefinitionsMapper statusDefinitionsMapper;
    private final StatusModifierGroupsMapper statusModifierGroupsMapper;
    private final StatusAttributeModifiersMapper statusAttributeModifiersMapper;
    private final StatusPeriodicHpEffectsMapper statusPeriodicHpEffectsMapper;
    private final ControlStateProfilesMapper controlStateProfilesMapper;
    private final CoefficientBucketsMapper coefficientBucketsMapper;
    private final AttributeDefinitionsMapper attributeDefinitionsMapper;
    private final TypesMapper typesMapper;
    private final TypeRelationsMapper typeRelationsMapper;
    private final ImagesMapper imagesMapper;
    private final OwnerCategoriesMapper ownerCategoriesMapper;
    private final PublishedBundleSnapshotsMapper publishedBundleSnapshotsMapper;
    private final GamesMapper gamesMapper;
    private final GameProgressionSchemaMapper gameProgressionSchemaMapper;
    private final GameVersionsMapper gameVersionsMapper;
    private final EditLogMapper editLogMapper;
    private final ObjectMapper objectMapper;
    private final PostgresReadStore readStore;
    private final PostgresJsonSupport jsonSupport;
    private final Set<String> ensuredPartitionGames = ConcurrentHashMap.newKeySet();

    public PostgresWriteStore(
        HeroesMapper heroesMapper,
        SkillsMapper skillsMapper,
        SkillMountsMapper skillMountsMapper,
        @Lazy DefaultBasicAttackProvisioner defaultBasicAttackProvisioner,
        ItemsMapper itemsMapper,
        ItemStatModifiersMapper itemStatModifiersMapper,
        FormulaProfilesMapper formulaProfilesMapper,
        FormulaBindingsMapper formulaBindingsMapper,
        StatusActionControlRulesMapper statusActionControlRulesMapper,
        StatusDefinitionsMapper statusDefinitionsMapper,
        StatusModifierGroupsMapper statusModifierGroupsMapper,
        StatusAttributeModifiersMapper statusAttributeModifiersMapper,
        StatusPeriodicHpEffectsMapper statusPeriodicHpEffectsMapper,
        ControlStateProfilesMapper controlStateProfilesMapper,
        CoefficientBucketsMapper coefficientBucketsMapper,
        AttributeDefinitionsMapper attributeDefinitionsMapper,
        TypesMapper typesMapper,
        TypeRelationsMapper typeRelationsMapper,
        ImagesMapper imagesMapper,
        OwnerCategoriesMapper ownerCategoriesMapper,
        PublishedBundleSnapshotsMapper publishedBundleSnapshotsMapper,
        GamesMapper gamesMapper,
        GameProgressionSchemaMapper gameProgressionSchemaMapper,
        GameVersionsMapper gameVersionsMapper,
        EditLogMapper editLogMapper,
        ObjectMapper objectMapper,
        PostgresReadStore readStore,
        PostgresJsonSupport jsonSupport
    ) {
        this.heroesMapper = heroesMapper;
        this.skillsMapper = skillsMapper;
        this.skillMountsMapper = skillMountsMapper;
        this.defaultBasicAttackProvisioner = defaultBasicAttackProvisioner;
        this.itemsMapper = itemsMapper;
        this.itemStatModifiersMapper = itemStatModifiersMapper;
        this.formulaProfilesMapper = formulaProfilesMapper;
        this.formulaBindingsMapper = formulaBindingsMapper;
        this.statusActionControlRulesMapper = statusActionControlRulesMapper;
        this.statusDefinitionsMapper = statusDefinitionsMapper;
        this.statusModifierGroupsMapper = statusModifierGroupsMapper;
        this.statusAttributeModifiersMapper = statusAttributeModifiersMapper;
        this.statusPeriodicHpEffectsMapper = statusPeriodicHpEffectsMapper;
        this.controlStateProfilesMapper = controlStateProfilesMapper;
        this.coefficientBucketsMapper = coefficientBucketsMapper;
        this.attributeDefinitionsMapper = attributeDefinitionsMapper;
        this.typesMapper = typesMapper;
        this.typeRelationsMapper = typeRelationsMapper;
        this.imagesMapper = imagesMapper;
        this.ownerCategoriesMapper = ownerCategoriesMapper;
        this.publishedBundleSnapshotsMapper = publishedBundleSnapshotsMapper;
        this.gamesMapper = gamesMapper;
        this.gameProgressionSchemaMapper = gameProgressionSchemaMapper;
        this.gameVersionsMapper = gameVersionsMapper;
        this.editLogMapper = editLogMapper;
        this.objectMapper = objectMapper;
        this.readStore = readStore;
        this.jsonSupport = jsonSupport;
    }

    @Transactional
    public ObjectNode upsertHero(String gameId, String heroId, ObjectNode body) {
        ObjectNode merged = mergeUpsert(body, "heroId", heroId);
        jsonSupport.requireText(merged, "name", "hero");
        JsonNode baseStats = merged.get("baseStats");
        if (baseStats == null || !baseStats.isObject()) {
            throw badRequest("hero.baseStats is required and must be object", Map.of("path", "/baseStats"));
        }
        validateHeroStatsByLevelAgainstSchema(gameId, merged);

        long versionId = resolveVersionIdForWrite(gameId);
        heroesMapper.upsertHero(
            gameId,
            heroId,
            versionId,
            merged.path("name").asText(),
            nullableText(merged, "title"),
            nullableText(merged, "avatarUrl"),
            jsonSupport.toJsonString(merged.get("baseStats"), "/baseStats"),
            jsonSupport.toJsonStringOrNull(merged.get("statsByLevel"))
        );
        defaultBasicAttackProvisioner.ensureHeroMount(gameId, heroId);
        return merged;
    }

    @Transactional
    public ObjectNode upsertProgressionSchema(String gameId, ObjectNode body) {
        if (body == null || body.isEmpty()) {
            throw badRequest("Request body cannot be empty", Map.of("path", "/", "reason", "empty body"));
        }

        String progressionKindRaw = requireTextField(body, "progressionKind", "/progressionKind");
        String progressionKind = progressionKindRaw.toUpperCase(Locale.ROOT);
        if (!PROGRESSION_KINDS.contains(progressionKind)) {
            throw badRequest("progressionSchema.progressionKind invalid", Map.of("path", "/progressionKind"));
        }

        int stageMin = requireIntegerField(body, "stageMin", "/stageMin");
        if (stageMin < 1) {
            throw badRequest("progressionSchema.stageMin must be >= 1", Map.of("path", "/stageMin"));
        }

        int stageMax = requireIntegerField(body, "stageMax", "/stageMax");
        if (stageMax < stageMin) {
            throw badRequest("progressionSchema.stageMax must be >= stageMin", Map.of("path", "/stageMax"));
        }
        if (stageMax > 100) {
            throw badRequest("progressionSchema.stageMax must be <= 100", Map.of("path", "/stageMax"));
        }

        String stageLabel = requireTextField(body, "stageLabel", "/stageLabel");

        JsonNode requireAllStagesNode = body.get("requireAllStages");
        if (requireAllStagesNode == null || !requireAllStagesNode.isBoolean()) {
            throw badRequest("progressionSchema.requireAllStages must be boolean", Map.of("path", "/requireAllStages"));
        }
        boolean requireAllStages = requireAllStagesNode.asBoolean();

        gameProgressionSchemaMapper.upsert(gameId, progressionKind, stageMin, stageMax, stageLabel, requireAllStages);

        ObjectNode response = objectMapper.createObjectNode();
        response.put("progressionKind", progressionKind);
        response.put("stageMin", stageMin);
        response.put("stageMax", stageMax);
        response.put("stageLabel", stageLabel);
        response.put("requireAllStages", requireAllStages);
        return response;
    }

    @Transactional
    public ObjectNode upsertSkill(String gameId, String skillId, ObjectNode body) {
        ObjectNode merged = mergeUpsert(body, "skillId", skillId);
        String ownerType = nullableText(merged, "ownerType");
        String ownerId = nullableText(merged, "ownerId");
        boolean ownerTypeMissing = ownerType == null || ownerType.isBlank();
        boolean ownerIdMissing = ownerId == null || ownerId.isBlank();
        if (ownerTypeMissing != ownerIdMissing) {
            throw badRequest(
                "skill.ownerType and skill.ownerId must both be null or both be set",
                Map.of("path", "/ownerType")
            );
        }
        if (!ownerTypeMissing) {
        if (!OWNER_TYPE_PATTERN.matcher(ownerType).matches()) {
            throw badRequest("skill.ownerType format invalid", Map.of("path", "/ownerType"));
        }
        if (!ownerTypeExists(gameId, ownerType)) {
            throw semantic("skill.ownerType not registered", Map.of("path", "/ownerType", "ownerType", ownerType));
        }
        if ("hero".equals(ownerType) && readStore.loadHero(gameId, ownerId) == null) {
            throw semantic("skill.ownerId hero not found", Map.of("path", "/ownerId", "ownerId", ownerId));
        }
        if ("item".equals(ownerType) && readStore.loadItem(gameId, ownerId) == null) {
            throw semantic("skill.ownerId item not found", Map.of("path", "/ownerId", "ownerId", ownerId));
        }
        } else {
            ownerType = null;
            ownerId = null;
            merged.putNull("ownerType");
            merged.putNull("ownerId");
        }

        JsonNode mechanicsConfig = merged.get("mechanicsConfig");
        if (mechanicsConfig == null || !mechanicsConfig.isObject()) {
            throw badRequest("skill.mechanicsConfig is required and must be object", Map.of("path", "/mechanicsConfig"));
        }
        validateOptionalObject(merged, "skill", "params", "/params");
        validateOptionalObject(merged, "skill", "timingProfile", "/timingProfile");
        validateMechanicsConfig((ObjectNode) mechanicsConfig);

        long versionId = resolveVersionIdForWrite(gameId);
        skillsMapper.upsertSkill(
            gameId,
            skillId,
            versionId,
            ownerId,
            ownerType,
            nullableText(merged, "skillKey"),
            nullableText(merged, "name"),
            nullableText(merged, "description"),
            jsonSupport.toJsonStringOrNull(merged.get("resourceCosts")),
            jsonSupport.toJsonStringOrNull(merged.get("cooldowns")),
            jsonSupport.toJsonStringOrNull(merged.get("params")),
            jsonSupport.toJsonStringOrNull(merged.get("timingProfile")),
            jsonSupport.toJsonString(merged.get("mechanicsConfig"), "/mechanicsConfig")
        );
        return merged;
    }

    @Transactional
    public ObjectNode upsertSkillMount(
        String gameId,
        String targetCategory,
        String targetId,
        String skillId,
        ObjectNode body
    ) {
        String normalizedTargetCategory = targetCategory == null ? "" : targetCategory.toLowerCase(Locale.ROOT);
        ObjectNode merged = mergeUpsert(body, "skillId", skillId);
        merged.put("targetCategory", normalizedTargetCategory);
        merged.put("targetId", targetId);
        merged.put("skillId", skillId);
        if (!SKILL_MOUNT_TARGET_CATEGORIES.contains(normalizedTargetCategory)) {
            throw badRequest(
                "skillMount.targetCategory invalid",
                Map.of("path", "/targetCategory", "targetCategory", normalizedTargetCategory)
            );
        }
        if (readStore.loadSkill(gameId, skillId) == null) {
            throw semantic("skillMount.skillId not found", Map.of("path", "/skillId", "skillId", skillId));
        }
        validateSkillMountTarget(gameId, normalizedTargetCategory, targetId);

        boolean enabled = true;
        JsonNode enabledNode = merged.get("enabled");
        if (enabledNode != null && !enabledNode.isNull()) {
            if (!enabledNode.isBoolean()) {
                throw badRequest("skillMount.enabled must be boolean", Map.of("path", "/enabled"));
            }
            enabled = enabledNode.asBoolean();
        }
        merged.put("enabled", enabled);

        JsonNode extend = merged.get("extend");
        if (extend == null || extend.isNull()) {
            extend = objectMapper.createObjectNode();
            merged.set("extend", extend);
        }
        if (!extend.isObject()) {
            throw badRequest("skillMount.extend must be object", Map.of("path", "/extend"));
        }

        long versionId = resolveVersionIdForWrite(gameId);
        skillMountsMapper.upsertSkillMount(
            gameId,
            versionId,
            normalizedTargetCategory,
            targetId,
            skillId,
            enabled,
            jsonSupport.toJsonString(extend, "/extend")
        );
        return merged;
    }

    @Transactional
    public ObjectNode upsertItem(String gameId, String itemId, ObjectNode body) {
        ObjectNode merged = mergeUpsert(body, "itemId", itemId);
        ArrayNode statModifiers = validateAndNormalizeItemStatModifiersForWrite(gameId, merged);
        validateItemRefs(gameId, merged);

        long versionId = resolveVersionIdForWrite(gameId);
        itemsMapper.upsertItem(
            gameId,
            itemId,
            versionId,
            nullableText(merged, "name"),
            nullableInteger(merged, "goldCost"),
            nullableText(merged, "iconUrl"),
            jsonSupport.toJsonStringOrNull(merged.get("skillRefs")),
            jsonSupport.toJsonStringOrNull(merged.get("recipeIds"))
        );
        itemStatModifiersMapper.deleteItemStatModifiersByItemId(gameId, itemId);
        for (JsonNode node : statModifiers) {
            ObjectNode modifier = (ObjectNode) node;
            itemStatModifiersMapper.upsertItemStatModifier(
                gameId,
                itemId,
                modifier.path("attrKey").asText(),
                versionId,
                modifier.path("value").decimalValue()
            );
        }
        merged.set("statModifiers", statModifiers);
        return merged;
    }

    @Transactional
    public ObjectNode upsertFormulaProfile(String gameId, String formulaId, ObjectNode body) {
        ObjectNode merged = mergeUpsert(body, "formulaId", formulaId);
        String formulaType = jsonSupport.requireText(merged, "formulaType", "formulaProfile").toLowerCase(Locale.ROOT);
        if (!FORMULA_TYPES.contains(formulaType)) {
            throw badRequest("formulaProfile.formulaType invalid", Map.of("path", "/formulaType", "formulaType", formulaType));
        }
        String formulaKind = jsonSupport.requireText(merged, "formulaKind", "formulaProfile");
        JsonNode params = merged.get("params");
        if (params == null || params.isNull()) {
            params = objectMapper.createObjectNode();
            merged.set("params", params);
        }
        if (!params.isObject()) {
            throw badRequest("formulaProfile.params must be object", Map.of("path", "/params"));
        }
        merged.put("formulaType", formulaType);

        long versionId = resolveVersionIdForWrite(gameId);
        formulaProfilesMapper.upsertFormulaProfile(
            gameId,
            formulaId,
            versionId,
            formulaType,
            formulaKind,
            jsonSupport.toJsonString(params, "/params"),
            nullableText(merged, "description")
        );
        return merged;
    }

    @Transactional
    public ObjectNode upsertFormulaBinding(
        String gameId,
        String targetCategory,
        String targetId,
        String bindingKey,
        ObjectNode body
    ) {
        String normalizedTargetCategory = targetCategory == null ? "" : targetCategory.toLowerCase(Locale.ROOT);
        ObjectNode merged = mergeUpsert(body, "bindingKey", bindingKey);
        merged.put("targetCategory", normalizedTargetCategory);
        merged.put("targetId", targetId);
        merged.put("bindingKey", bindingKey);
        validateFormulaBindingTarget(gameId, merged);
        String formulaId = jsonSupport.requireText(merged, "formulaId", "formulaBinding");
        if (readStore.loadFormulaProfile(gameId, formulaId) == null) {
            throw semantic("formulaBinding.formulaId not found", Map.of("path", "/formulaId", "formulaId", formulaId));
        }
        validateOptionalObject(merged, "formulaBinding", "overrideParams", "/overrideParams");

        long versionId = resolveVersionIdForWrite(gameId);
        formulaBindingsMapper.upsertFormulaBinding(
            gameId,
            normalizedTargetCategory,
            targetId,
            bindingKey,
            versionId,
            formulaId,
            jsonSupport.toJsonStringOrNull(merged.get("overrideParams"))
        );
        return merged;
    }

    @Transactional
    public ObjectNode upsertCoefficientBucket(String gameId, String bucketKey, ObjectNode body) {
        ObjectNode merged = mergeUpsert(body, "bucketKey", bucketKey);

        String resolutionDomain = jsonSupport.requireText(merged, "resolutionDomain", "coefficientBucket").toLowerCase(Locale.ROOT);
        if (!COEFFICIENT_BUCKET_RESOLUTION_DOMAINS.contains(resolutionDomain)) {
            throw badRequest("coefficientBucket.resolutionDomain invalid", Map.of("path", "/resolutionDomain", "resolutionDomain", resolutionDomain));
        }
        merged.put("resolutionDomain", resolutionDomain);

        String stageKey = jsonSupport.requireText(merged, "stageKey", "coefficientBucket");
        String aggregationMode = jsonSupport.requireText(merged, "aggregationMode", "coefficientBucket").toLowerCase(Locale.ROOT);
        if (!COEFFICIENT_BUCKET_AGGREGATION_MODES.contains(aggregationMode)) {
            throw badRequest("coefficientBucket.aggregationMode invalid", Map.of("path", "/aggregationMode", "aggregationMode", aggregationMode));
        }
        merged.put("aggregationMode", aggregationMode);

        String targetAttrKey = nullableText(merged, "targetAttrKey");
        if ("attribute".equals(resolutionDomain)) {
            if (targetAttrKey == null || targetAttrKey.isBlank()) {
                throw badRequest("coefficientBucket.targetAttrKey is required when resolutionDomain=attribute", Map.of("path", "/targetAttrKey"));
            }
            if (readStore.loadAttributeDefinition(gameId, targetAttrKey) == null) {
                throw semantic(
                    "coefficientBucket.targetAttrKey not found",
                    Map.of("path", "/targetAttrKey", "targetAttrKey", targetAttrKey)
                );
            }
        } else if (targetAttrKey != null) {
            throw badRequest("coefficientBucket.targetAttrKey must be null when resolutionDomain=hp_change", Map.of("path", "/targetAttrKey"));
        }

        Boolean provisional = nullableBoolean(merged, "provisional");
        if (provisional == null) {
            provisional = false;
            merged.put("provisional", false);
        }

        validateOptionalText(merged, "name", "/name");
        validateOptionalText(merged, "description", "/description");
        validateOptionalObject(merged, "coefficientBucket", "editorHint", "/editorHint");
        validateOptionalObject(merged, "coefficientBucket", "bucketConfig", "/bucketConfig");

        long versionId = resolveVersionIdForWrite(gameId);
        coefficientBucketsMapper.upsertCoefficientBucket(
            gameId,
            bucketKey,
            versionId,
            resolutionDomain,
            stageKey,
            targetAttrKey,
            aggregationMode,
            provisional,
            nullableText(merged, "name"),
            nullableText(merged, "description"),
            jsonSupport.toJsonStringOrNull(merged.get("editorHint")),
            jsonSupport.toJsonStringOrNull(merged.get("bucketConfig"))
        );
        return merged;
    }

    @Transactional
    public ObjectNode upsertStatusActionControlRule(String gameId, String ruleId, ObjectNode body) {
        ObjectNode merged = mergeUpsert(body, "ruleId", ruleId);

        int statusTypeId = requireExistingTypeId(gameId, merged.get("statusTypeId"), "/statusTypeId", "statusActionControlRule.statusTypeId");
        String ruleKind = jsonSupport.requireText(merged, "ruleKind", "statusActionControlRule").toLowerCase(Locale.ROOT);
        if (!STATUS_ACTION_CONTROL_RULE_KINDS.contains(ruleKind)) {
            throw badRequest("statusActionControlRule.ruleKind invalid", Map.of("path", "/ruleKind", "ruleKind", ruleKind));
        }
        merged.put("ruleKind", ruleKind);

        ArrayNode actionTypeIds = requireTypeIdArray(gameId, merged, "actionTypeIds", "/actionTypeIds", false);
        ArrayNode actionMatchTypeIds = requireTypeIdArray(gameId, merged, "actionMatchTypeIds", "/actionMatchTypeIds", true);
        ArrayNode interruptPhaseTypeIds = requireTypeIdArray(gameId, merged, "interruptPhaseTypeIds", "/interruptPhaseTypeIds", true);

        if ("forbid".equals(ruleKind) && interruptPhaseTypeIds.size() > 0) {
            throw badRequest(
                "interruptPhaseTypeIds must be empty when ruleKind=forbid",
                Map.of("path", "/interruptPhaseTypeIds", "ruleKind", ruleKind)
            );
        }
        if ("interrupt".equals(ruleKind) && interruptPhaseTypeIds.isEmpty()) {
            throw badRequest(
                "interruptPhaseTypeIds must be non-empty when ruleKind=interrupt",
                Map.of("path", "/interruptPhaseTypeIds", "ruleKind", ruleKind)
            );
        }

        Integer priority = nullableInteger(merged, "priority");
        if (priority == null) {
            priority = 0;
            merged.put("priority", priority);
        }
        validateOptionalText(merged, "description", "/description");

        long versionId = resolveVersionIdForWrite(gameId);
        statusActionControlRulesMapper.upsertStatusActionControlRule(
            gameId,
            ruleId,
            versionId,
            statusTypeId,
            ruleKind,
            jsonSupport.toJsonString(actionTypeIds, "/actionTypeIds"),
            jsonSupport.toJsonString(actionMatchTypeIds, "/actionMatchTypeIds"),
            jsonSupport.toJsonString(interruptPhaseTypeIds, "/interruptPhaseTypeIds"),
            priority,
            nullableText(merged, "description"),
            jsonSupport.toJsonStringOrNull(merged.get("extend"))
        );
        return merged;
    }

    @Transactional
    public ObjectNode upsertStatusDefinition(String gameId, String statusId, ObjectNode body) {
        ObjectNode merged = mergeUpsert(body, "statusId", statusId);
        String name = jsonSupport.requireText(merged, "name", "statusDefinition");
        String statusKind = requireEnum(merged, "statusKind", "statusDefinition", STATUS_KINDS);
        Integer statusTypeId = nullableExistingTypeId(gameId, merged.get("statusTypeId"), "/statusTypeId", "statusDefinition.statusTypeId");
        String controlProfileId = nullableText(merged, "controlProfileId");
        if (controlProfileId != null && readStore.loadControlStateProfile(gameId, controlProfileId) == null) {
            throw semantic("statusDefinition.controlProfileId not found", Map.of("path", "/controlProfileId", "controlProfileId", controlProfileId));
        }
        String stackGroupKey = jsonSupport.requireText(merged, "stackGroupKey", "statusDefinition");
        String sourceScope = defaultEnum(merged, "sourceScope", "any_source", "statusDefinition", STATUS_SOURCE_SCOPES);
        String stackMode = defaultEnum(merged, "stackMode", "refresh", "statusDefinition", STATUS_STACK_MODES);
        int maxStacks = defaultPositiveInteger(merged, "maxStacks", 1);
        Integer maxInstances = nullablePositiveInteger(merged, "maxInstances");
        String durationMode = defaultEnum(merged, "durationMode", "timed", "statusDefinition", STATUS_DURATION_MODES);
        Integer durationMs = nullablePositiveInteger(merged, "durationMs");
        String durationFormulaId = nullableText(merged, "durationFormulaId");
        requireFormulaIfPresent(gameId, durationFormulaId, "/durationFormulaId", "statusDefinition.durationFormulaId");
        String defaultMagnitudeFormulaId = nullableText(merged, "defaultMagnitudeFormulaId");
        requireFormulaIfPresent(gameId, defaultMagnitudeFormulaId, "/defaultMagnitudeFormulaId", "statusDefinition.defaultMagnitudeFormulaId");
        validateStatusDuration(durationMode, durationMs, durationFormulaId, "");
        String snapshotPolicy = defaultEnum(merged, "snapshotPolicy", "on_apply", "statusDefinition", STATUS_SNAPSHOT_POLICIES);
        boolean dispellable = defaultBoolean(merged, "isDispellable", true);
        int cleansePriority = defaultInteger(merged, "cleansePriority", 0);
        validateOptionalText(merged, "description", "/description");
        validateOptionalObject(merged, "statusDefinition", "extend", "/extend");

        long versionId = resolveVersionIdForWrite(gameId);
        statusDefinitionsMapper.upsertStatusDefinition(
            gameId,
            statusId,
            versionId,
            name,
            nullableText(merged, "description"),
            statusKind,
            statusTypeId,
            controlProfileId,
            stackGroupKey,
            sourceScope,
            stackMode,
            maxStacks,
            maxInstances,
            durationMode,
            durationMs,
            durationFormulaId,
            defaultMagnitudeFormulaId,
            snapshotPolicy,
            dispellable,
            cleansePriority,
            jsonSupport.toJsonStringOrNull(merged.get("extend"))
        );
        return merged;
    }

    @Transactional
    public ObjectNode upsertControlStateProfile(String gameId, String controlProfileId, ObjectNode body) {
        ObjectNode merged = mergeUpsert(body, "controlProfileId", controlProfileId);
        String name = jsonSupport.requireText(merged, "name", "controlStateProfile");
        String controlKind = requireEnum(merged, "controlKind", "controlStateProfile", CONTROL_KINDS);
        String movementLockMode = defaultEnum(merged, "movementLockMode", "none", "controlStateProfile", MOVEMENT_LOCK_MODES);
        String castLockMode = defaultEnum(merged, "castLockMode", "none", "controlStateProfile", CAST_LOCK_MODES);
        String attackLockMode = defaultEnum(merged, "attackLockMode", "none", "controlStateProfile", ATTACK_LOCK_MODES);
        String inputOverrideMode = defaultEnum(merged, "inputOverrideMode", "none", "controlStateProfile", INPUT_OVERRIDE_MODES);
        String displacementKind = defaultEnum(merged, "displacementKind", "none", "controlStateProfile", DISPLACEMENT_KINDS);
        boolean blocksControlInput = defaultBoolean(merged, "blocksControlInput", false);
        boolean grantsUnstoppable = defaultBoolean(merged, "grantsUnstoppable", false);
        boolean breaksOnDamage = defaultBoolean(merged, "breaksOnDamage", false);
        boolean tenacityReducible = defaultBoolean(merged, "tenacityReducible", true);
        int priority = defaultInteger(merged, "priority", 0);
        validateOptionalText(merged, "description", "/description");
        validateOptionalObject(merged, "controlStateProfile", "extend", "/extend");

        long versionId = resolveVersionIdForWrite(gameId);
        controlStateProfilesMapper.upsertControlStateProfile(
            gameId,
            controlProfileId,
            versionId,
            name,
            nullableText(merged, "description"),
            controlKind,
            movementLockMode,
            castLockMode,
            attackLockMode,
            inputOverrideMode,
            displacementKind,
            blocksControlInput,
            grantsUnstoppable,
            breaksOnDamage,
            tenacityReducible,
            priority,
            jsonSupport.toJsonStringOrNull(merged.get("extend"))
        );
        return merged;
    }

    @Transactional
    public ObjectNode upsertStatusModifierGroup(String gameId, String statusId, String groupKey, ObjectNode body) {
        ObjectNode merged = mergeUpsert(body, "groupKey", groupKey);
        merged.put("statusId", statusId);
        requireStatusDefinition(gameId, statusId, "/statusId");
        validateOptionalText(merged, "groupName", "/groupName");
        String phaseKey = requireEnum(merged, "phaseKey", "statusModifierGroup", STATUS_GROUP_PHASE_KEYS);
        String snapshotPolicy = defaultEnum(merged, "snapshotPolicy", "on_apply", "statusModifierGroup", STATUS_GROUP_SNAPSHOT_POLICIES);
        Integer intervalMs = nullablePositiveInteger(merged, "intervalMs");
        Integer maxTicks = nullablePositiveInteger(merged, "maxTicks");
        validateStatusGroupInterval(phaseKey, intervalMs, maxTicks, "");
        int priority = defaultInteger(merged, "priority", 0);
        validateOptionalObject(merged, "statusModifierGroup", "extend", "/extend");

        long versionId = resolveVersionIdForWrite(gameId);
        statusModifierGroupsMapper.upsertStatusModifierGroup(
            gameId,
            statusId,
            groupKey,
            versionId,
            nullableText(merged, "groupName"),
            phaseKey,
            snapshotPolicy,
            intervalMs,
            maxTicks,
            priority,
            jsonSupport.toJsonStringOrNull(merged.get("extend"))
        );
        return merged;
    }

    @Transactional
    public ObjectNode upsertStatusAttributeModifier(String gameId, String statusId, String groupKey, String modifierId, ObjectNode body) {
        ObjectNode merged = mergeUpsert(body, "modifierId", modifierId);
        merged.put("statusId", statusId);
        merged.put("groupKey", groupKey);
        requireStatusModifierGroup(gameId, statusId, groupKey, "/groupKey");
        String attrKey = jsonSupport.requireText(merged, "attrKey", "statusAttributeModifier");
        if (readStore.loadAttributeDefinition(gameId, attrKey) == null) {
            throw semantic("statusAttributeModifier.attrKey not found", Map.of("path", "/attrKey", "attrKey", attrKey));
        }
        String modifierMode = requireEnum(merged, "modifierMode", "statusAttributeModifier", STATUS_MODIFIER_MODES);
        BigDecimal value = nullableBigDecimal(merged, "value");
        String formulaId = nullableText(merged, "formulaId");
        requireFormulaIfPresent(gameId, formulaId, "/formulaId", "statusAttributeModifier.formulaId");
        if (value == null && formulaId == null) {
            throw badRequest("statusAttributeModifier.value or formulaId is required", Map.of("path", "/value"));
        }
        String bucketKey = nullableText(merged, "bucketKey");
        validateStatusModifierBucket(gameId, modifierMode, bucketKey);
        boolean perStack = defaultBoolean(merged, "perStack", false);
        int priority = defaultInteger(merged, "priority", 0);
        validateOptionalObject(merged, "statusAttributeModifier", "extend", "/extend");

        long versionId = resolveVersionIdForWrite(gameId);
        statusAttributeModifiersMapper.upsertStatusAttributeModifier(
            gameId,
            statusId,
            groupKey,
            modifierId,
            versionId,
            attrKey,
            modifierMode,
            value,
            formulaId,
            bucketKey,
            perStack,
            priority,
            jsonSupport.toJsonStringOrNull(merged.get("extend"))
        );
        return merged;
    }

    @Transactional
    public ObjectNode upsertStatusPeriodicHpEffect(String gameId, String statusId, String groupKey, String effectId, ObjectNode body) {
        ObjectNode merged = mergeUpsert(body, "effectId", effectId);
        merged.put("statusId", statusId);
        merged.put("groupKey", groupKey);
        requireStatusModifierGroup(gameId, statusId, groupKey, "/groupKey");
        String effectKind = requireEnum(merged, "effectKind", "statusPeriodicHpEffect", STATUS_PERIODIC_EFFECT_KINDS);
        String tickFormulaId = jsonSupport.requireText(merged, "tickFormulaId", "statusPeriodicHpEffect");
        requireFormulaIfPresent(gameId, tickFormulaId, "/tickFormulaId", "statusPeriodicHpEffect.tickFormulaId");
        String damageType = nullableText(merged, "damageType");
        Boolean affectedByHealModifier = nullableBoolean(merged, "affectedByHealModifier");
        validatePeriodicHpEffectKind(effectKind, damageType, affectedByHealModifier, "");
        boolean canCrit = defaultBoolean(merged, "canCrit", false);
        String critChanceSource = resolveStatusPeriodicCritChanceSource(merged, canCrit);
        BigDecimal critChance = nullableBigDecimal(merged, "critChance");
        BigDecimal critMultiplier = nullableBigDecimal(merged, "critMultiplier");
        validateStatusPeriodicHpEffectCrit(canCrit, critChanceSource, critChance, critMultiplier, "");
        merged.put("critChanceSource", critChanceSource);
        if (critChance != null) {
            merged.put("critChance", critChance);
        } else {
            merged.remove("critChance");
        }
        if (critMultiplier != null) {
            merged.put("critMultiplier", critMultiplier);
        } else {
            merged.remove("critMultiplier");
        }
        boolean perStack = defaultBoolean(merged, "perStack", false);
        validateOptionalObject(merged, "statusPeriodicHpEffect", "extend", "/extend");

        long versionId = resolveVersionIdForWrite(gameId);
        statusPeriodicHpEffectsMapper.upsertStatusPeriodicHpEffect(
            gameId,
            statusId,
            groupKey,
            effectId,
            versionId,
            effectKind,
            tickFormulaId,
            damageType,
            canCrit,
            critChanceSource,
            critChance,
            critMultiplier,
            affectedByHealModifier,
            perStack,
            jsonSupport.toJsonStringOrNull(merged.get("extend"))
        );
        return merged;
    }

    @Transactional
    public ObjectNode upsertAttributeDefinition(String gameId, String attrKey, ObjectNode body) {
        ObjectNode merged = mergeUpsert(body, "attrKey", attrKey);
        int sortOrder = defaultInteger(merged, "sortOrder", 0);
        if (sortOrder < 0) {
            throw badRequest("sortOrder must be non-negative integer", Map.of("path", "/sortOrder"));
        }
        String valueKind = normalizeAttributeDefinitionValueKind(merged);
        String rateTargetAttrKey = validateAttributeDefinitionRateTarget(gameId, merged, valueKind);
        AttributeDefinitionBounds bounds = validateAttributeDefinitionBounds(
            merged,
            "/minValue",
            "/maxValue",
            "/defaultValue",
            false
        );

        long versionId = resolveVersionIdForWrite(gameId);
        attributeDefinitionsMapper.upsertAttributeDefinition(
            gameId,
            attrKey,
            versionId,
            sortOrder,
            nullableText(merged, "attrName"),
            nullableText(merged, "attrType"),
            bounds.defaultValue(),
            valueKind,
            rateTargetAttrKey,
            bounds.minValue(),
            bounds.maxValue()
        );
        return merged;
    }

    @Transactional
    public ObjectNode upsertType(String gameId, int typeId, ObjectNode body) {
        ObjectNode merged = mergeUpsert(body, "typeId", Integer.toString(typeId));
        merged.put("typeId", typeId);

        long versionId = resolveVersionIdForWrite(gameId);
        typesMapper.upsertType(
            gameId,
            typeId,
            versionId,
            nullableText(merged, "name"),
            nullableText(merged, "description"),
            nullableInteger(merged, "reservedTypeId")
        );
        return merged;
    }

    @Transactional
    public ObjectNode upsertTypeRelation(
        String gameId,
        int typeId,
        String targetCategory,
        String targetId,
        ObjectNode body
    ) {
        ObjectNode merged = mergeUpsert(body, "targetId", targetId);
        merged.remove("deleted");
        merged.put("typeId", typeId);
        merged.put("targetCategory", targetCategory);
        merged.put("targetId", targetId);
        validateTypeRelationTarget(gameId, merged);

        long versionId = resolveVersionIdForWrite(gameId);
        boolean hasTypeRelationsDeletedColumn = typeRelationsMapper.hasTypeRelationsDeletedColumn();
        typeRelationsMapper.upsertTypeRelation(
            gameId,
            typeId,
            versionId,
            targetCategory,
            targetId,
            jsonSupport.toJsonStringOrNull(merged.get("extend")),
            false,
            hasTypeRelationsDeletedColumn
        );
        return merged;
    }

    @Transactional
    public ObjectNode replaceTypeRelationsForTarget(
        String gameId,
        String targetCategory,
        String targetId,
        ObjectNode body
    ) {
        if (body == null || body.isEmpty()) {
            throw badRequest("Request body cannot be empty", Map.of("path", "/", "reason", "empty body"));
        }

        String normalizedTargetCategory = targetCategory == null ? "" : targetCategory.toLowerCase(Locale.ROOT);
        validateTypeRelationTargetRef(gameId, normalizedTargetCategory, targetId, "/targetId");

        JsonNode relationsNode = body.get("relations");
        if (relationsNode == null || !relationsNode.isArray()) {
            throw badRequest("typeRelationReplace.relations must be array", Map.of("path", "/relations"));
        }

        Map<Integer, ObjectNode> desiredRelationsByTypeId = new LinkedHashMap<>();
        for (int index = 0; index < relationsNode.size(); index++) {
            JsonNode relationNode = relationsNode.get(index);
            if (relationNode == null || !relationNode.isObject()) {
                throw badRequest("typeRelationReplace.relations must contain objects", Map.of("path", "/relations/" + index));
            }

            ObjectNode relation = objectMapper.createObjectNode();
            JsonNode typeIdNode = relationNode.get("typeId");
            if (typeIdNode == null || !typeIdNode.canConvertToInt()) {
                throw badRequest("typeRelationReplace.relations.typeId must be integer", Map.of("path", "/relations/" + index + "/typeId"));
            }
            int relationTypeId = typeIdNode.asInt();
            if (desiredRelationsByTypeId.containsKey(relationTypeId)) {
                throw badRequest(
                    "typeRelationReplace.relations contains duplicate typeId",
                    Map.of("path", "/relations/" + index + "/typeId", "typeId", relationTypeId)
                );
            }

            relation.put("typeId", relationTypeId);
            relation.put("targetCategory", normalizedTargetCategory);
            relation.put("targetId", targetId);
            JsonNode extendNode = relationNode.get("extend");
            if (extendNode != null && !extendNode.isNull()) {
                if (!extendNode.isObject()) {
                    throw badRequest("typeRelationReplace.relations.extend must be object", Map.of("path", "/relations/" + index + "/extend"));
                }
                relation.set("extend", extendNode.deepCopy());
            }
            validateTypeRelationTarget(gameId, relation);
            desiredRelationsByTypeId.put(relationTypeId, relation);
        }

        long versionId = resolveVersionIdForWrite(gameId);
        boolean hasTypeRelationsDeletedColumn = typeRelationsMapper.hasTypeRelationsDeletedColumn();
        List<Map<String, Object>> currentRelations = typeRelationsMapper.listTypeRelationsByTarget(gameId, normalizedTargetCategory, targetId);
        for (Map<String, Object> currentRelation : currentRelations) {
            Integer existingTypeId = mapInteger(currentRelation, "typeId");
            int safeTypeId = existingTypeId == null ? -1 : existingTypeId;
            if (desiredRelationsByTypeId.containsKey(safeTypeId)) {
                continue;
            }
            ensureUpdated(
                typeRelationsMapper.markTypeRelationDeleted(
                    gameId,
                    safeTypeId,
                    normalizedTargetCategory,
                    targetId,
                    versionId,
                    hasTypeRelationsDeletedColumn
                ),
                "typeRelation not found while deleting",
                Map.of("gameId", gameId, "typeId", safeTypeId, "targetCategory", normalizedTargetCategory, "targetId", targetId)
            );
        }

        for (ObjectNode relation : desiredRelationsByTypeId.values()) {
            int relationTypeId = relation.path("typeId").asInt();
            typeRelationsMapper.upsertTypeRelation(
                gameId,
                relationTypeId,
                versionId,
                normalizedTargetCategory,
                targetId,
                jsonSupport.toJsonStringOrNull(relation.get("extend")),
                false,
                hasTypeRelationsDeletedColumn
            );
        }

        ObjectNode response = objectMapper.createObjectNode();
        response.put("gameId", gameId);
        response.put("targetCategory", normalizedTargetCategory);
        response.put("targetId", targetId);
        ArrayNode responseRelations = response.putArray("typeRelations");
        desiredRelationsByTypeId.values()
            .stream()
            .sorted((left, right) -> Integer.compare(left.path("typeId").asInt(), right.path("typeId").asInt()))
            .forEach(responseRelations::add);
        return response;
    }

    @Transactional
    public ObjectNode upsertImage(String gameId, String uri, ObjectNode body) {
        if (body == null || body.isEmpty()) {
            throw badRequest("Request body cannot be empty", Map.of("path", "/", "reason", "empty body"));
        }

        ObjectNode merged = objectMapper.createObjectNode();
        mergeObject(merged, body);
        merged.put("uri", uri);
        String imageBase64 = jsonSupport.requireText(merged, "imageBase64", "image");
        if (!imageBase64.startsWith("data:image/") || !imageBase64.contains("base64,")) {
            throw badRequest("imageBase64 must be data URI base64", Map.of("path", "/imageBase64"));
        }

        imagesMapper.upsertImage(gameId, uri, imageBase64);
        ObjectNode stored = readStore.loadImage(gameId, uri);
        return stored == null ? merged : stored;
    }

    @Transactional
    public ObjectNode publishVersion(String gameId, ObjectNode requestBody) {
        ensureGamePartitions(gameId);
        if (requestBody == null || requestBody.isEmpty()) {
            throw badRequest("Request body cannot be empty", Map.of("path", "/", "reason", "empty body"));
        }

        String versionCode = jsonSupport.requireText(requestBody, "versionCode", "version");
        if (WORKSPACE_VERSION_CODE.equals(versionCode)) {
            throw badRequest("versionCode is reserved", Map.of("path", "/versionCode"));
        }
        LocalDate releaseDate = null;
        if (requestBody.hasNonNull("releaseDate")) {
            try {
                releaseDate = LocalDate.parse(requestBody.path("releaseDate").asText());
            } catch (DateTimeParseException ex) {
                throw badRequest("releaseDate must be ISO date", Map.of("path", "/releaseDate"));
            }
        }
        if (readStore.findVersionByCode(gameId, versionCode) != null) {
            throw conflict("Version code already exists", Map.of("gameId", gameId, "versionCode", versionCode));
        }

        Long versionId;
        try {
            versionId = gameVersionsMapper.createVersion(
                gameId,
                versionCode,
                releaseDate == null ? null : java.sql.Date.valueOf(releaseDate)
            );
        } catch (DataIntegrityViolationException ex) {
            throw conflict("Version code already exists", Map.of("gameId", gameId, "versionCode", versionCode));
        }
        PostgresReadStore.VersionRecord version = readStore.findVersionById(gameId, versionId == null ? -1L : versionId);
        if (version == null) {
            throw notFound("Version not found", Map.of("gameId", gameId, "versionCode", versionCode));
        }

        PostgresReadStore.VersionRecord currentVersion = readStore.findCurrentPublishedVersion(gameId);
        Instant prevPublishedAt = currentVersion == null || currentVersion.publishedAt() == null
            ? Instant.EPOCH
            : currentVersion.publishedAt();
        Timestamp changedAfter = Timestamp.from(prevPublishedAt);

        List<Map<String, Object>> changedAttributeDefinitions = attributeDefinitionsMapper.listChangedSince(gameId, changedAfter);
        List<Map<String, Object>> changedTypes = typesMapper.listChangedSince(gameId, changedAfter);
        List<Map<String, Object>> changedTypeRelations = typeRelationsMapper.listChangedSince(gameId, changedAfter);
        List<Map<String, Object>> changedHeroes = heroesMapper.listChangedSince(gameId, changedAfter);
        List<Map<String, Object>> changedSkills = skillsMapper.listChangedSince(gameId, changedAfter);
        List<Map<String, Object>> changedItems = itemsMapper.listChangedSince(gameId, changedAfter);
        List<Map<String, Object>> changedItemStatModifiers = itemStatModifiersMapper.listChangedSince(gameId, changedAfter);
        List<Map<String, Object>> changedFormulaProfiles = formulaProfilesMapper.listChangedSince(gameId, changedAfter);
        List<Map<String, Object>> changedFormulaBindings = formulaBindingsMapper.listChangedSince(gameId, changedAfter);
        List<Map<String, Object>> changedCoefficientBuckets = coefficientBucketsMapper.listChangedSince(gameId, changedAfter);
        List<Map<String, Object>> changedStatusActionControlRules = statusActionControlRulesMapper.listChangedSince(gameId, changedAfter);
        List<Map<String, Object>> changedStatusDefinitions = statusDefinitionsMapper.listChangedSince(gameId, changedAfter);
        List<Map<String, Object>> changedControlStateProfiles = controlStateProfilesMapper.listChangedSince(gameId, changedAfter);
        List<Map<String, Object>> changedStatusModifierGroups = statusModifierGroupsMapper.listChangedSince(gameId, changedAfter);
        List<Map<String, Object>> changedStatusAttributeModifiers = statusAttributeModifiersMapper.listChangedSince(gameId, changedAfter);
        List<Map<String, Object>> changedStatusPeriodicHpEffects = statusPeriodicHpEffectsMapper.listChangedSince(gameId, changedAfter);
        defaultBasicAttackProvisioner.ensureForGame(gameId);
        List<Map<String, Object>> changedSkillMounts = skillMountsMapper.listChangedSince(gameId, changedAfter);

        Instant publishedAt = Instant.now();
        ObjectNode unsignedBundle = readStore.buildBundle(gameId, version, publishedAt);
        validateBundleForPublish(gameId, unsignedBundle);

        applyVersionProgressAndLog(
            gameId,
            version.versionId(),
            changedAttributeDefinitions,
            changedTypes,
            changedTypeRelations,
            changedHeroes,
            changedSkills,
            changedItems,
            changedItemStatModifiers,
            changedFormulaProfiles,
            changedFormulaBindings,
            changedCoefficientBuckets,
            changedStatusActionControlRules,
            changedStatusDefinitions,
            changedControlStateProfiles,
            changedStatusModifierGroups,
            changedStatusAttributeModifiers,
            changedStatusPeriodicHpEffects,
            changedSkillMounts
        );

        publishedBundleSnapshotsMapper.upsertBundleSnapshot(
            gameId,
            version.versionId(),
            version.versionCode(),
            serializeBundle(unsignedBundle)
        );
        gameVersionsMapper.clearCurrentVersion(gameId);
        int updatedRows = gameVersionsMapper.markVersionCurrent(Timestamp.from(publishedAt), gameId, version.versionId());
        if (updatedRows == 0) {
            throw notFound("Version not found", Map.of("gameId", gameId, "versionCode", version.versionCode()));
        }

        ObjectNode response = objectMapper.createObjectNode();
        response.put("gameId", gameId);
        response.put("versionCode", version.versionCode());
        if (version.releaseDate() != null) {
            response.put("releaseDate", version.releaseDate().toString());
        }
        response.put("publishedAt", publishedAt.toString());
        response.put("updatedAt", publishedAt.toString());
        return response;
    }

    @Transactional
    public void recordEditLog(String email, String method, String path, JsonNode requestBody, int responseCode) {
        ObjectNode editBody = objectMapper.createObjectNode();
        editBody.put("method", method);
        editBody.put("path", path);
        editBody.put("responseCode", responseCode);
        if (requestBody != null && !requestBody.isNull()) {
            editBody.set("requestBody", requestBody.deepCopy());
        }
        String serialized;
        try {
            serialized = objectMapper.writeValueAsString(editBody);
        } catch (JsonProcessingException ex) {
            serialized = "{\"method\":\"" + method + "\",\"path\":\"" + path + "\"}";
        }

        editLogMapper.insertEditLog(email, serialized);
        editLogMapper.deleteExpiredEditLogs();
    }

    private void applyVersionProgressAndLog(
        String gameId,
        long versionId,
        List<Map<String, Object>> changedAttributeDefinitions,
        List<Map<String, Object>> changedTypes,
        List<Map<String, Object>> changedTypeRelations,
        List<Map<String, Object>> changedHeroes,
        List<Map<String, Object>> changedSkills,
        List<Map<String, Object>> changedItems,
        List<Map<String, Object>> changedItemStatModifiers,
        List<Map<String, Object>> changedFormulaProfiles,
        List<Map<String, Object>> changedFormulaBindings,
        List<Map<String, Object>> changedCoefficientBuckets,
        List<Map<String, Object>> changedStatusActionControlRules,
        List<Map<String, Object>> changedStatusDefinitions,
        List<Map<String, Object>> changedControlStateProfiles,
        List<Map<String, Object>> changedStatusModifierGroups,
        List<Map<String, Object>> changedStatusAttributeModifiers,
        List<Map<String, Object>> changedStatusPeriodicHpEffects,
        List<Map<String, Object>> changedSkillMounts
    ) {
        for (Map<String, Object> row : changedAttributeDefinitions) {
            String attrKey = mapText(row, "attrKey");
            String safeAttrKey = attrKey == null ? "" : attrKey;
            Integer sortOrder = mapInteger(row, "sortOrder");
            ensureUpdated(
                attributeDefinitionsMapper.updateVersionRange(gameId, safeAttrKey, versionId),
                "attributeDefinition not found while publishing",
                Map.of("gameId", gameId, "attrKey", safeAttrKey)
            );
            attributeDefinitionsMapper.upsertAttributeDefinitionLog(
                gameId,
                safeAttrKey,
                versionId,
                sortOrder == null ? 0 : sortOrder,
                mapText(row, "attrName"),
                mapText(row, "attrType"),
                mapBigDecimal(row, "defaultValue"),
                mapText(row, "valueKind"),
                mapText(row, "rateTargetAttrKey"),
                mapBigDecimal(row, "minValue"),
                mapBigDecimal(row, "maxValue")
            );
        }
        for (Map<String, Object> row : changedTypes) {
            Integer typeId = mapInteger(row, "typeId");
            int safeTypeId = typeId == null ? -1 : typeId;
            ensureUpdated(
                typesMapper.updateVersionRange(gameId, safeTypeId, versionId),
                "type not found while publishing",
                Map.of("gameId", gameId, "typeId", safeTypeId)
            );
            typesMapper.upsertTypeLog(
                gameId,
                safeTypeId,
                versionId,
                mapText(row, "name"),
                mapText(row, "description"),
                mapInteger(row, "reservedTypeId")
            );
        }
        boolean hasTypeRelationsLogDeletedColumn = typeRelationsMapper.hasTypeRelationsLogDeletedColumn();
        for (Map<String, Object> row : changedTypeRelations) {
            Integer typeId = mapInteger(row, "typeId");
            int safeTypeId = typeId == null ? -1 : typeId;
            String targetCategory = mapText(row, "targetCategory");
            String safeTargetCategory = targetCategory == null ? "" : targetCategory;
            String targetId = mapText(row, "targetId");
            String safeTargetId = targetId == null ? "" : targetId;
            ensureUpdated(
                typeRelationsMapper.updateVersionRange(gameId, safeTypeId, safeTargetCategory, safeTargetId, versionId),
                "typeRelation not found while publishing",
                Map.of("gameId", gameId, "typeId", safeTypeId, "targetCategory", safeTargetCategory, "targetId", safeTargetId)
            );
            typeRelationsMapper.upsertTypeRelationLog(
                gameId,
                safeTypeId,
                versionId,
                safeTargetCategory,
                safeTargetId,
                mapText(row, "extendJson"),
                Boolean.TRUE.equals(mapBoolean(row, "deleted")),
                hasTypeRelationsLogDeletedColumn
            );
        }
        for (Map<String, Object> row : changedHeroes) {
            String heroId = mapText(row, "heroId");
            String safeHeroId = heroId == null ? "" : heroId;
            ensureUpdated(
                heroesMapper.updateVersionRange(gameId, safeHeroId, versionId),
                "hero not found while publishing",
                Map.of("gameId", gameId, "heroId", safeHeroId)
            );
            heroesMapper.upsertHeroLog(
                gameId,
                safeHeroId,
                versionId,
                mapText(row, "name"),
                mapText(row, "title"),
                mapText(row, "avatarUrl"),
                mapText(row, "baseStatsJson"),
                mapText(row, "statsByLevelJson")
            );
        }
        for (Map<String, Object> row : changedSkills) {
            String skillId = mapText(row, "skillId");
            String safeSkillId = skillId == null ? "" : skillId;
            ensureUpdated(
                skillsMapper.updateVersionRange(gameId, safeSkillId, versionId),
                "skill not found while publishing",
                Map.of("gameId", gameId, "skillId", safeSkillId)
            );
            skillsMapper.upsertSkillLog(
                gameId,
                safeSkillId,
                versionId,
                mapText(row, "ownerId"),
                mapText(row, "ownerType"),
                mapText(row, "skillKey"),
                mapText(row, "name"),
                mapText(row, "description"),
                mapText(row, "resourceCostsJson"),
                mapText(row, "cooldownsJson"),
                mapText(row, "paramsJson"),
                mapText(row, "timingProfileJson"),
                mapText(row, "mechanicsConfigJson")
            );
        }
        Set<String> changedItemIds = new LinkedHashSet<>();
        for (Map<String, Object> row : changedItems) {
            String itemId = mapText(row, "itemId");
            if (itemId != null && !itemId.isBlank()) {
                changedItemIds.add(itemId);
            }
        }
        for (Map<String, Object> row : changedItemStatModifiers) {
            String itemId = mapText(row, "itemId");
            if (itemId != null && !itemId.isBlank()) {
                changedItemIds.add(itemId);
            }
        }

        for (String safeItemId : changedItemIds) {
            Map<String, Object> itemRow = itemsMapper.findItemById(gameId, safeItemId);
            if (itemRow == null) {
                throw notFound("item not found while publishing", Map.of("gameId", gameId, "itemId", safeItemId));
            }
            ensureUpdated(
                itemsMapper.updateVersionRange(gameId, safeItemId, versionId),
                "item not found while publishing",
                Map.of("gameId", gameId, "itemId", safeItemId)
            );
            itemsMapper.upsertItemLog(
                gameId,
                safeItemId,
                versionId,
                mapText(itemRow, "name"),
                mapInteger(itemRow, "goldCost"),
                mapText(itemRow, "iconUrl"),
                mapText(itemRow, "skillRefsJson"),
                mapText(itemRow, "recipeIdsJson")
            );

            List<Map<String, Object>> itemStatModifiers = itemStatModifiersMapper.listItemStatModifiersByItemId(gameId, safeItemId);
            for (Map<String, Object> itemStatModifier : itemStatModifiers) {
                String attrKey = mapText(itemStatModifier, "attrKey");
                String safeAttrKey = attrKey == null ? "" : attrKey;
                ensureUpdated(
                    itemStatModifiersMapper.updateVersionRange(gameId, safeItemId, safeAttrKey, versionId),
                    "itemStatModifier not found while publishing",
                    Map.of("gameId", gameId, "itemId", safeItemId, "attrKey", safeAttrKey)
                );
                itemStatModifiersMapper.upsertItemStatModifierLog(
                    gameId,
                    safeItemId,
                    safeAttrKey,
                    versionId,
                    mapBigDecimal(itemStatModifier, "value")
                );
            }
        }
        for (Map<String, Object> row : changedFormulaProfiles) {
            String formulaId = mapText(row, "formulaId");
            String safeFormulaId = formulaId == null ? "" : formulaId;
            ensureUpdated(
                formulaProfilesMapper.updateVersionRange(gameId, safeFormulaId, versionId),
                "formulaProfile not found while publishing",
                Map.of("gameId", gameId, "formulaId", safeFormulaId)
            );
            formulaProfilesMapper.upsertFormulaProfileLog(
                gameId,
                safeFormulaId,
                versionId,
                mapText(row, "formulaType"),
                mapText(row, "formulaKind"),
                mapText(row, "paramsJson"),
                mapText(row, "description")
            );
        }
        for (Map<String, Object> row : changedFormulaBindings) {
            String targetCategory = mapText(row, "targetCategory");
            String safeTargetCategory = targetCategory == null ? "" : targetCategory;
            String targetId = mapText(row, "targetId");
            String safeTargetId = targetId == null ? "" : targetId;
            String bindingKey = mapText(row, "bindingKey");
            String safeBindingKey = bindingKey == null ? "" : bindingKey;
            ensureUpdated(
                formulaBindingsMapper.updateVersionRange(gameId, safeTargetCategory, safeTargetId, safeBindingKey, versionId),
                "formulaBinding not found while publishing",
                Map.of(
                    "gameId", gameId,
                    "targetCategory", safeTargetCategory,
                    "targetId", safeTargetId,
                    "bindingKey", safeBindingKey
                )
            );
            formulaBindingsMapper.upsertFormulaBindingLog(
                gameId,
                safeTargetCategory,
                safeTargetId,
                safeBindingKey,
                versionId,
                mapText(row, "formulaId"),
                mapText(row, "overrideParamsJson")
            );
        }
        for (Map<String, Object> row : changedSkillMounts) {
            String targetCategory = mapText(row, "targetCategory");
            String safeTargetCategory = targetCategory == null ? "" : targetCategory;
            String targetId = mapText(row, "targetId");
            String safeTargetId = targetId == null ? "" : targetId;
            String skillId = mapText(row, "skillId");
            String safeSkillId = skillId == null ? "" : skillId;
            ensureUpdated(
                skillMountsMapper.updateVersionRange(
                    gameId,
                    safeTargetCategory,
                    safeTargetId,
                    safeSkillId,
                    versionId
                ),
                "skillMount not found while publishing",
                Map.of(
                    "gameId", gameId,
                    "targetCategory", safeTargetCategory,
                    "targetId", safeTargetId,
                    "skillId", safeSkillId
                )
            );
            Boolean enabled = mapBoolean(row, "enabled");
            skillMountsMapper.upsertSkillMountLog(
                gameId,
                versionId,
                safeTargetCategory,
                safeTargetId,
                safeSkillId,
                enabled == null || enabled,
                mapText(row, "extendJson")
            );
        }
        for (Map<String, Object> row : changedCoefficientBuckets) {
            String bucketKey = mapText(row, "bucketKey");
            String safeBucketKey = bucketKey == null ? "" : bucketKey;
            ensureUpdated(
                coefficientBucketsMapper.updateVersionRange(gameId, safeBucketKey, versionId),
                "coefficientBucket not found while publishing",
                Map.of("gameId", gameId, "bucketKey", safeBucketKey)
            );
            coefficientBucketsMapper.upsertCoefficientBucketLog(
                gameId,
                safeBucketKey,
                versionId,
                mapText(row, "resolutionDomain"),
                mapText(row, "stageKey"),
                mapText(row, "targetAttrKey"),
                mapText(row, "aggregationMode"),
                Boolean.TRUE.equals(mapBoolean(row, "provisional")),
                mapText(row, "name"),
                mapText(row, "description"),
                mapText(row, "editorHintJson"),
                mapText(row, "bucketConfigJson")
            );
        }
        for (Map<String, Object> row : changedStatusActionControlRules) {
            String ruleId = mapText(row, "ruleId");
            String safeRuleId = ruleId == null ? "" : ruleId;
            ensureUpdated(
                statusActionControlRulesMapper.updateVersionRange(gameId, safeRuleId, versionId),
                "statusActionControlRule not found while publishing",
                Map.of("gameId", gameId, "ruleId", safeRuleId)
            );
            Integer statusTypeId = mapInteger(row, "statusTypeId");
            statusActionControlRulesMapper.upsertStatusActionControlRuleLog(
                gameId,
                safeRuleId,
                versionId,
                statusTypeId == null ? -1 : statusTypeId,
                mapText(row, "ruleKind"),
                mapText(row, "actionTypeIdsJson"),
                mapText(row, "actionMatchTypeIdsJson"),
                mapText(row, "interruptPhaseTypeIdsJson"),
                mapInteger(row, "priority") == null ? 0 : mapInteger(row, "priority"),
                mapText(row, "description"),
                mapText(row, "extendJson")
            );
        }
        for (Map<String, Object> row : changedStatusDefinitions) {
            String statusId = mapText(row, "statusId");
            String safeStatusId = statusId == null ? "" : statusId;
            ensureUpdated(
                statusDefinitionsMapper.updateVersionRange(gameId, safeStatusId, versionId),
                "statusDefinition not found while publishing",
                Map.of("gameId", gameId, "statusId", safeStatusId)
            );
            statusDefinitionsMapper.upsertStatusDefinitionLog(
                gameId,
                safeStatusId,
                versionId,
                mapText(row, "name"),
                mapText(row, "description"),
                mapText(row, "statusKind"),
                mapInteger(row, "statusTypeId"),
                mapText(row, "controlProfileId"),
                mapText(row, "stackGroupKey"),
                mapText(row, "sourceScope"),
                mapText(row, "stackMode"),
                mapInteger(row, "maxStacks") == null ? 1 : mapInteger(row, "maxStacks"),
                mapInteger(row, "maxInstances"),
                mapText(row, "durationMode"),
                mapInteger(row, "durationMs"),
                mapText(row, "durationFormulaId"),
                mapText(row, "defaultMagnitudeFormulaId"),
                mapText(row, "snapshotPolicy"),
                !Boolean.FALSE.equals(mapBoolean(row, "isDispellable")),
                mapInteger(row, "cleansePriority") == null ? 0 : mapInteger(row, "cleansePriority"),
                mapText(row, "extendJson")
            );
        }
        for (Map<String, Object> row : changedControlStateProfiles) {
            String controlProfileId = mapText(row, "controlProfileId");
            String safeControlProfileId = controlProfileId == null ? "" : controlProfileId;
            ensureUpdated(
                controlStateProfilesMapper.updateVersionRange(gameId, safeControlProfileId, versionId),
                "controlStateProfile not found while publishing",
                Map.of("gameId", gameId, "controlProfileId", safeControlProfileId)
            );
            controlStateProfilesMapper.upsertControlStateProfileLog(
                gameId,
                safeControlProfileId,
                versionId,
                mapText(row, "name"),
                mapText(row, "description"),
                mapText(row, "controlKind"),
                mapText(row, "movementLockMode"),
                mapText(row, "castLockMode"),
                mapText(row, "attackLockMode"),
                mapText(row, "inputOverrideMode"),
                mapText(row, "displacementKind"),
                Boolean.TRUE.equals(mapBoolean(row, "blocksControlInput")),
                Boolean.TRUE.equals(mapBoolean(row, "grantsUnstoppable")),
                Boolean.TRUE.equals(mapBoolean(row, "breaksOnDamage")),
                !Boolean.FALSE.equals(mapBoolean(row, "tenacityReducible")),
                mapInteger(row, "priority") == null ? 0 : mapInteger(row, "priority"),
                mapText(row, "extendJson")
            );
        }
        for (Map<String, Object> row : changedStatusModifierGroups) {
            String statusId = mapText(row, "statusId");
            String safeStatusId = statusId == null ? "" : statusId;
            String groupKey = mapText(row, "groupKey");
            String safeGroupKey = groupKey == null ? "" : groupKey;
            ensureUpdated(
                statusModifierGroupsMapper.updateVersionRange(gameId, safeStatusId, safeGroupKey, versionId),
                "statusModifierGroup not found while publishing",
                Map.of("gameId", gameId, "statusId", safeStatusId, "groupKey", safeGroupKey)
            );
            statusModifierGroupsMapper.upsertStatusModifierGroupLog(
                gameId,
                safeStatusId,
                safeGroupKey,
                versionId,
                mapText(row, "groupName"),
                mapText(row, "phaseKey"),
                mapText(row, "snapshotPolicy"),
                mapInteger(row, "intervalMs"),
                mapInteger(row, "maxTicks"),
                mapInteger(row, "priority") == null ? 0 : mapInteger(row, "priority"),
                mapText(row, "extendJson")
            );
        }
        for (Map<String, Object> row : changedStatusAttributeModifiers) {
            String statusId = mapText(row, "statusId");
            String safeStatusId = statusId == null ? "" : statusId;
            String groupKey = mapText(row, "groupKey");
            String safeGroupKey = groupKey == null ? "" : groupKey;
            String modifierId = mapText(row, "modifierId");
            String safeModifierId = modifierId == null ? "" : modifierId;
            ensureUpdated(
                statusAttributeModifiersMapper.updateVersionRange(gameId, safeStatusId, safeGroupKey, safeModifierId, versionId),
                "statusAttributeModifier not found while publishing",
                Map.of("gameId", gameId, "statusId", safeStatusId, "groupKey", safeGroupKey, "modifierId", safeModifierId)
            );
            statusAttributeModifiersMapper.upsertStatusAttributeModifierLog(
                gameId,
                safeStatusId,
                safeGroupKey,
                safeModifierId,
                versionId,
                mapText(row, "attrKey"),
                mapText(row, "modifierMode"),
                mapBigDecimal(row, "value"),
                mapText(row, "formulaId"),
                mapText(row, "bucketKey"),
                Boolean.TRUE.equals(mapBoolean(row, "perStack")),
                mapInteger(row, "priority") == null ? 0 : mapInteger(row, "priority"),
                mapText(row, "extendJson")
            );
        }
        for (Map<String, Object> row : changedStatusPeriodicHpEffects) {
            String statusId = mapText(row, "statusId");
            String safeStatusId = statusId == null ? "" : statusId;
            String groupKey = mapText(row, "groupKey");
            String safeGroupKey = groupKey == null ? "" : groupKey;
            String effectId = mapText(row, "effectId");
            String safeEffectId = effectId == null ? "" : effectId;
            ensureUpdated(
                statusPeriodicHpEffectsMapper.updateVersionRange(gameId, safeStatusId, safeGroupKey, safeEffectId, versionId),
                "statusPeriodicHpEffect not found while publishing",
                Map.of("gameId", gameId, "statusId", safeStatusId, "groupKey", safeGroupKey, "effectId", safeEffectId)
            );
            statusPeriodicHpEffectsMapper.upsertStatusPeriodicHpEffectLog(
                gameId,
                safeStatusId,
                safeGroupKey,
                safeEffectId,
                versionId,
                mapText(row, "effectKind"),
                mapText(row, "tickFormulaId"),
                mapText(row, "damageType"),
                Boolean.TRUE.equals(mapBoolean(row, "canCrit")),
                mapText(row, "critChanceSource"),
                mapBigDecimal(row, "critChance"),
                mapBigDecimal(row, "critMultiplier"),
                mapBoolean(row, "affectedByHealModifier"),
                Boolean.TRUE.equals(mapBoolean(row, "perStack")),
                mapText(row, "extendJson")
            );
        }
    }

    private void validateBundleForPublish(String gameId, ObjectNode bundle) {
        ArrayNode attributeDefinitions = requireArray(bundle, "attributeDefinitions");
        ArrayNode coefficientBuckets = requireArray(bundle, "coefficientBuckets");
        ArrayNode types = requireArray(bundle, "types");
        ArrayNode typeRelations = requireArray(bundle, "typeRelations");
        ArrayNode heroes = requireArray(bundle, "heroes");
        ArrayNode skills = requireArray(bundle, "skills");
        ArrayNode items = requireArray(bundle, "items");
        ArrayNode formulaProfiles = requireArray(bundle, "formulaProfiles");
        ArrayNode formulaBindings = requireArray(bundle, "formulaBindings");
        ArrayNode statusActionControlRules = requireArray(bundle, "statusActionControlRules");
        ArrayNode statusDefinitions = requireArray(bundle, "statusDefinitions");
        ArrayNode controlStateProfiles = requireArray(bundle, "controlStateProfiles");
        ArrayNode statusModifierGroups = requireArray(bundle, "statusModifierGroups");
        ArrayNode statusAttributeModifiers = requireArray(bundle, "statusAttributeModifiers");
        ArrayNode statusPeriodicHpEffects = requireArray(bundle, "statusPeriodicHpEffects");
        ArrayNode skillMounts = requireArray(bundle, "skillMounts");

        Set<String> attrKeys = new HashSet<>();
        for (JsonNode node : attributeDefinitions) {
            ObjectNode attr = requireObject(node, "/attributeDefinitions");
            String attrKey = requireTextForPublish(attr, "attrKey", "/attributeDefinitions/attrKey");
            attrKeys.add(attrKey);
        }

        for (JsonNode node : attributeDefinitions) {
            ObjectNode attr = requireObject(node, "/attributeDefinitions");
            validateAttributeDefinitionForPublish(attr, attrKeys);
        }

        Set<String> bucketKeys = new HashSet<>();
        for (JsonNode node : coefficientBuckets) {
            ObjectNode coefficientBucket = requireObject(node, "/coefficientBuckets");
            String bucketKey = requireTextForPublish(coefficientBucket, "bucketKey", "/coefficientBuckets/bucketKey");
            bucketKeys.add(bucketKey);
            validateCoefficientBucketForPublish(coefficientBucket, attrKeys);
        }

        Set<Integer> typeIds = new HashSet<>();
        for (JsonNode node : types) {
            ObjectNode type = requireObject(node, "/types");
            if (!type.path("typeId").canConvertToInt()) {
                throw semantic("type.typeId must be integer", Map.of("path", "/types/typeId"));
            }
            typeIds.add(type.path("typeId").asInt());
        }

        Set<String> heroIds = new HashSet<>();
        for (JsonNode node : heroes) {
            ObjectNode hero = requireObject(node, "/heroes");
            String heroId = requireTextForPublish(hero, "heroId", "/heroes/heroId");
            heroIds.add(heroId);
            validateHeroForPublish(hero);
        }

        Set<String> skillIds = new HashSet<>();
        for (JsonNode node : skills) {
            ObjectNode skill = requireObject(node, "/skills");
            String skillId = requireTextForPublish(skill, "skillId", "/skills/skillId");
            skillIds.add(skillId);
        }

        Set<String> itemIds = new HashSet<>();
        for (JsonNode node : items) {
            ObjectNode item = requireObject(node, "/items");
            String itemId = requireTextForPublish(item, "itemId", "/items/itemId");
            itemIds.add(itemId);
        }

        Set<String> formulaIds = new HashSet<>();
        for (JsonNode node : formulaProfiles) {
            ObjectNode formulaProfile = requireObject(node, "/formulaProfiles");
            String formulaId = requireTextForPublish(formulaProfile, "formulaId", "/formulaProfiles/formulaId");
            formulaIds.add(formulaId);
            validateFormulaProfileForPublish(formulaProfile);
        }

        Set<String> controlProfileIds = new HashSet<>();
        for (JsonNode node : controlStateProfiles) {
            ObjectNode controlStateProfile = requireObject(node, "/controlStateProfiles");
            String controlProfileId = requireTextForPublish(
                controlStateProfile,
                "controlProfileId",
                "/controlStateProfiles/controlProfileId"
            );
            controlProfileIds.add(controlProfileId);
            validateControlStateProfileForPublish(controlStateProfile);
        }

        Set<String> statusIds = new HashSet<>();
        for (JsonNode node : statusDefinitions) {
            ObjectNode statusDefinition = requireObject(node, "/statusDefinitions");
            String statusId = requireTextForPublish(statusDefinition, "statusId", "/statusDefinitions/statusId");
            statusIds.add(statusId);
            validateStatusDefinitionForPublish(statusDefinition, typeIds, controlProfileIds, formulaIds);
        }

        Set<String> statusGroupKeys = new HashSet<>();
        for (JsonNode node : statusModifierGroups) {
            ObjectNode statusModifierGroup = requireObject(node, "/statusModifierGroups");
            String statusId = requireTextForPublish(statusModifierGroup, "statusId", "/statusModifierGroups/statusId");
            String groupKey = requireTextForPublish(statusModifierGroup, "groupKey", "/statusModifierGroups/groupKey");
            statusGroupKeys.add(statusGroupKey(statusId, groupKey));
            validateStatusModifierGroupForPublish(statusModifierGroup, statusIds);
        }

        for (JsonNode node : statusAttributeModifiers) {
            ObjectNode statusAttributeModifier = requireObject(node, "/statusAttributeModifiers");
            validateStatusAttributeModifierForPublish(statusAttributeModifier, statusIds, statusGroupKeys, attrKeys, formulaIds, bucketKeys);
        }

        for (JsonNode node : statusPeriodicHpEffects) {
            ObjectNode statusPeriodicHpEffect = requireObject(node, "/statusPeriodicHpEffects");
            validateStatusPeriodicHpEffectForPublish(statusPeriodicHpEffect, statusIds, statusGroupKeys, formulaIds);
        }

        for (JsonNode node : skills) {
            ObjectNode skill = requireObject(node, "/skills");
            validateSkillForPublish(gameId, skill, heroIds, itemIds);
        }
        for (JsonNode node : items) {
            ObjectNode item = requireObject(node, "/items");
            validateItemForPublish(item, skillIds, itemIds, attrKeys);
        }
        for (JsonNode node : typeRelations) {
            ObjectNode relation = requireObject(node, "/typeRelations");
            validateTypeRelationForPublish(relation, typeIds, attrKeys, skillIds, heroIds, itemIds);
        }
        for (JsonNode node : formulaBindings) {
            ObjectNode formulaBinding = requireObject(node, "/formulaBindings");
            validateFormulaBindingForPublish(formulaBinding, formulaIds, skillIds, heroIds, itemIds);
        }
        for (JsonNode node : skillMounts) {
            ObjectNode skillMount = requireObject(node, "/skillMounts");
            validateSkillMountForPublish(skillMount, skillIds, heroIds, itemIds);
        }
        for (JsonNode node : statusActionControlRules) {
            ObjectNode rule = requireObject(node, "/statusActionControlRules");
            validateStatusActionControlRuleForPublish(rule, typeIds);
        }
    }

    private void validateHeroForPublish(ObjectNode hero) {
        requireTextForPublish(hero, "name", "/heroes/name");
        JsonNode baseStats = hero.get("baseStats");
        if (baseStats == null || !baseStats.isObject()) {
            throw semantic("hero.baseStats is required and must be object", Map.of("path", "/heroes/baseStats"));
        }
    }

    private void validateHeroStatsByLevelAgainstSchema(String gameId, ObjectNode hero) {
        JsonNode statsByLevelNode = hero.get("statsByLevel");
        if (statsByLevelNode == null || statsByLevelNode.isNull()) {
            return;
        }
        if (!statsByLevelNode.isObject()) {
            throw badRequest("hero.statsByLevel must be object", Map.of("path", "/statsByLevel"));
        }

        ObjectNode statsByLevel = (ObjectNode) statsByLevelNode;
        PostgresReadStore.ProgressionSchemaRecord schema = readStore.loadProgressionSchemaRecordOrDefault(gameId);
        int stageCount = schema.stageMax() - schema.stageMin() + 1;

        boolean allArrayValues = true;
        boolean allObjectValues = true;
        Iterator<Map.Entry<String, JsonNode>> fields = statsByLevel.fields();
        while (fields.hasNext()) {
            JsonNode value = fields.next().getValue();
            allArrayValues = allArrayValues && value.isArray();
            allObjectValues = allObjectValues && value.isObject();
        }

        if (allArrayValues) {
            validateStatsByLevelArrayStructure(statsByLevel, stageCount);
            return;
        }
        if (allObjectValues) {
            validateStatsByLevelStageStructure(statsByLevel, schema);
            return;
        }
        throw badRequest(
            "hero.statsByLevel must use one structure: attrKey->number[] or stageKey->{attrKey:number}",
            Map.of("path", "/statsByLevel")
        );
    }

    private void validateStatsByLevelArrayStructure(ObjectNode statsByLevel, int stageCount) {
        Iterator<Map.Entry<String, JsonNode>> fields = statsByLevel.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> entry = fields.next();
            String attrKey = entry.getKey();
            if (attrKey == null || attrKey.isBlank()) {
                throw badRequest("hero.statsByLevel attrKey cannot be blank", Map.of("path", "/statsByLevel"));
            }
            ArrayNode values = requireArrayNode(entry.getValue(), "/statsByLevel/" + attrKey);
            if (values.size() != stageCount) {
                throw badRequest(
                    "hero.statsByLevel number[] length must equal stageCount",
                    Map.of("path", "/statsByLevel/" + attrKey, "expectedLength", stageCount)
                );
            }
            for (int i = 0; i < values.size(); i++) {
                if (!values.get(i).isNumber()) {
                    throw badRequest("hero.statsByLevel array values must be numbers", Map.of("path", "/statsByLevel/" + attrKey + "/" + i));
                }
            }
        }
    }

    private void validateStatsByLevelStageStructure(
        ObjectNode statsByLevel,
        PostgresReadStore.ProgressionSchemaRecord schema
    ) {
        Map<Integer, Set<String>> stageAttrKeys = new LinkedHashMap<>();

        Iterator<Map.Entry<String, JsonNode>> fields = statsByLevel.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> entry = fields.next();
            String stageKey = entry.getKey();
            int stage = parseStageKey(stageKey, "/statsByLevel/" + stageKey);
            if (stage < schema.stageMin() || stage > schema.stageMax()) {
                throw badRequest(
                    "hero.statsByLevel stageKey out of range",
                    Map.of("path", "/statsByLevel/" + stageKey, "stageMin", schema.stageMin(), "stageMax", schema.stageMax())
                );
            }

            JsonNode stageValue = entry.getValue();
            if (!stageValue.isObject()) {
                throw badRequest("hero.statsByLevel stage payload must be object", Map.of("path", "/statsByLevel/" + stageKey));
            }

            Set<String> attrs = new LinkedHashSet<>();
            Iterator<Map.Entry<String, JsonNode>> attrFields = stageValue.fields();
            while (attrFields.hasNext()) {
                Map.Entry<String, JsonNode> attrEntry = attrFields.next();
                String attrKey = attrEntry.getKey();
                if (attrKey == null || attrKey.isBlank()) {
                    throw badRequest("hero.statsByLevel attrKey cannot be blank", Map.of("path", "/statsByLevel/" + stageKey));
                }
                if (!attrEntry.getValue().isNumber()) {
                    throw badRequest(
                        "hero.statsByLevel stage attr value must be number",
                        Map.of("path", "/statsByLevel/" + stageKey + "/" + attrKey)
                    );
                }
                attrs.add(attrKey);
            }

            stageAttrKeys.put(stage, attrs);
        }

        if (!schema.requireAllStages()) {
            return;
        }

        Set<String> expectedAttrs = null;
        for (int stage = schema.stageMin(); stage <= schema.stageMax(); stage++) {
            Set<String> attrs = stageAttrKeys.get(stage);
            if (attrs == null) {
                throw badRequest(
                    "hero.statsByLevel must contain all stages when requireAllStages=true",
                    Map.of("path", "/statsByLevel", "missingStage", stage)
                );
            }
            if (expectedAttrs == null) {
                expectedAttrs = attrs;
                continue;
            }
            if (!expectedAttrs.equals(attrs)) {
                throw badRequest(
                    "hero.statsByLevel stage attrs must be consistent when requireAllStages=true",
                    Map.of("path", "/statsByLevel/" + stage)
                );
            }
        }
    }

    private ArrayNode requireArrayNode(JsonNode value, String path) {
        if (value == null || !value.isArray()) {
            throw badRequest("hero.statsByLevel field must be array", Map.of("path", path));
        }
        return (ArrayNode) value;
    }

    private int parseStageKey(String stageKey, String path) {
        if (stageKey == null || stageKey.isBlank()) {
            throw badRequest("hero.statsByLevel stageKey cannot be blank", Map.of("path", path));
        }
        try {
            return Integer.parseInt(stageKey);
        } catch (NumberFormatException ex) {
            throw badRequest("hero.statsByLevel stageKey must be integer string", Map.of("path", path));
        }
    }

    private void validateSkillForPublish(String gameId, ObjectNode skill, Set<String> heroIds, Set<String> itemIds) {
        JsonNode ownerTypeNode = skill.get("ownerType");
        JsonNode ownerIdNode = skill.get("ownerId");
        boolean ownerTypeMissing = ownerTypeNode == null || ownerTypeNode.isNull()
            || (ownerTypeNode.isTextual() && ownerTypeNode.asText().isBlank());
        boolean ownerIdMissing = ownerIdNode == null || ownerIdNode.isNull()
            || (ownerIdNode.isTextual() && ownerIdNode.asText().isBlank());
        if (ownerTypeMissing != ownerIdMissing) {
            throw semantic(
                "skill.ownerType and skill.ownerId must both be null or both be set",
                Map.of("path", "/skills/ownerType")
            );
        }
        if (!ownerTypeMissing) {
            String ownerType = ownerTypeNode.asText();
        if (!OWNER_TYPE_PATTERN.matcher(ownerType).matches()) {
            throw semantic("skill.ownerType format invalid", Map.of("path", "/skills/ownerType", "ownerType", ownerType));
        }
        if (!ownerTypeExists(gameId, ownerType)) {
            throw semantic("skill.ownerType not registered", Map.of("path", "/skills/ownerType", "ownerType", ownerType));
        }
            String ownerId = ownerIdNode.asText();
        if ("hero".equals(ownerType) && !heroIds.contains(ownerId)) {
            throw semantic("skill.ownerId hero not found", Map.of("path", "/skills/ownerId", "ownerId", ownerId));
        }
        if ("item".equals(ownerType) && !itemIds.contains(ownerId)) {
            throw semantic("skill.ownerId item not found", Map.of("path", "/skills/ownerId", "ownerId", ownerId));
        }
        }

        JsonNode mechanicsConfig = skill.get("mechanicsConfig");
        if (mechanicsConfig == null || !mechanicsConfig.isObject()) {
            throw semantic("skill.mechanicsConfig is required and must be object", Map.of("path", "/skills/mechanicsConfig"));
        }
        validateOptionalObjectForPublish(skill, "skill", "params", "/skills/params");
        validateOptionalObjectForPublish(skill, "skill", "timingProfile", "/skills/timingProfile");
        JsonNode versionNode = mechanicsConfig.get("version");
        if (versionNode == null || !versionNode.canConvertToInt() || versionNode.asInt() != 1) {
            throw semantic("mechanicsConfig.version must be 1", Map.of("path", "/skills/mechanicsConfig/version"));
        }
        if (!mechanicsConfig.path("triggers").isArray()) {
            throw semantic("mechanicsConfig.triggers is required and must be array", Map.of("path", "/skills/mechanicsConfig/triggers"));
        }
        validateDpsPassiveEffects((ObjectNode) mechanicsConfig, "/skills/mechanicsConfig", true);
    }

    private void validateFormulaProfileForPublish(ObjectNode formulaProfile) {
        String formulaType = requireTextForPublish(formulaProfile, "formulaType", "/formulaProfiles/formulaType").toLowerCase(Locale.ROOT);
        if (!FORMULA_TYPES.contains(formulaType)) {
            throw semantic("formulaProfile.formulaType invalid", Map.of("path", "/formulaProfiles/formulaType", "formulaType", formulaType));
        }
        requireTextForPublish(formulaProfile, "formulaKind", "/formulaProfiles/formulaKind");
        JsonNode params = formulaProfile.get("params");
        if (params == null || !params.isObject()) {
            throw semantic("formulaProfile.params is required and must be object", Map.of("path", "/formulaProfiles/params"));
        }
    }

    private void validateSkillMountForPublish(
        ObjectNode skillMount,
        Set<String> skillIds,
        Set<String> heroIds,
        Set<String> itemIds
    ) {
        String targetCategory = requireTextForPublish(skillMount, "targetCategory", "/skillMounts/targetCategory")
            .toLowerCase(Locale.ROOT);
        if (!SKILL_MOUNT_TARGET_CATEGORIES.contains(targetCategory)) {
            throw semantic(
                "skillMount.targetCategory invalid",
                Map.of("path", "/skillMounts/targetCategory", "targetCategory", targetCategory)
            );
        }
        String targetId = requireTextForPublish(skillMount, "targetId", "/skillMounts/targetId");
        String skillId = requireTextForPublish(skillMount, "skillId", "/skillMounts/skillId");
        if (!skillIds.contains(skillId)) {
            throw semantic("skillMount.skillId not found", Map.of("path", "/skillMounts/skillId", "skillId", skillId));
        }
        if ("hero".equals(targetCategory) && !heroIds.contains(targetId)) {
            throw semantic(
                "skillMount target hero not found",
                Map.of("path", "/skillMounts/targetId", "targetCategory", targetCategory, "targetId", targetId)
            );
        }
        if ("item".equals(targetCategory) && !itemIds.contains(targetId)) {
            throw semantic(
                "skillMount target item not found",
                Map.of("path", "/skillMounts/targetId", "targetCategory", targetCategory, "targetId", targetId)
            );
        }
        JsonNode enabledNode = skillMount.get("enabled");
        if (enabledNode != null && !enabledNode.isNull() && !enabledNode.isBoolean()) {
            throw semantic("skillMount.enabled must be boolean", Map.of("path", "/skillMounts/enabled"));
        }
        JsonNode extend = skillMount.get("extend");
        if (extend != null && !extend.isNull() && !extend.isObject()) {
            throw semantic("skillMount.extend must be object", Map.of("path", "/skillMounts/extend"));
        }
    }

    private void validateSkillMountTarget(String gameId, String targetCategory, String targetId) {
        if ("hero".equals(targetCategory) && readStore.loadHero(gameId, targetId) == null) {
            throw semantic(
                "skillMount target hero not found",
                Map.of("path", "/targetId", "targetCategory", targetCategory, "targetId", targetId)
            );
        }
        if ("item".equals(targetCategory) && readStore.loadItem(gameId, targetId) == null) {
            throw semantic(
                "skillMount target item not found",
                Map.of("path", "/targetId", "targetCategory", targetCategory, "targetId", targetId)
            );
        }
    }

    private void validateFormulaBindingForPublish(
        ObjectNode formulaBinding,
        Set<String> formulaIds,
        Set<String> skillIds,
        Set<String> heroIds,
        Set<String> itemIds
    ) {
        String targetCategory = requireTextForPublish(formulaBinding, "targetCategory", "/formulaBindings/targetCategory")
            .toLowerCase(Locale.ROOT);
        if (!FORMULA_BINDING_TARGET_CATEGORIES.contains(targetCategory)) {
            throw semantic(
                "formulaBinding.targetCategory invalid",
                Map.of("path", "/formulaBindings/targetCategory", "targetCategory", targetCategory)
            );
        }
        String targetId = requireTextForPublish(formulaBinding, "targetId", "/formulaBindings/targetId");
        String formulaId = requireTextForPublish(formulaBinding, "formulaId", "/formulaBindings/formulaId");
        if (!formulaIds.contains(formulaId)) {
            throw semantic("formulaBinding.formulaId not found", Map.of("path", "/formulaBindings/formulaId", "formulaId", formulaId));
        }
        if (!targetExistsForFormulaBinding(targetCategory, targetId, skillIds, heroIds, itemIds)) {
            throw semantic(
                "formulaBinding target not found",
                Map.of("path", "/formulaBindings/targetId", "targetCategory", targetCategory, "targetId", targetId)
            );
        }
        JsonNode overrideParams = formulaBinding.get("overrideParams");
        if (overrideParams != null && !overrideParams.isNull() && !overrideParams.isObject()) {
            throw semantic("formulaBinding.overrideParams must be object", Map.of("path", "/formulaBindings/overrideParams"));
        }
    }

    private void validateCoefficientBucketForPublish(ObjectNode bucket, Set<String> attrKeys) {
        requireTextForPublish(bucket, "bucketKey", "/coefficientBuckets/bucketKey");
        String resolutionDomain = requireTextForPublish(bucket, "resolutionDomain", "/coefficientBuckets/resolutionDomain")
            .toLowerCase(Locale.ROOT);
        if (!COEFFICIENT_BUCKET_RESOLUTION_DOMAINS.contains(resolutionDomain)) {
            throw semantic(
                "coefficientBucket.resolutionDomain invalid",
                Map.of("path", "/coefficientBuckets/resolutionDomain", "resolutionDomain", resolutionDomain)
            );
        }
        requireTextForPublish(bucket, "stageKey", "/coefficientBuckets/stageKey");
        String aggregationMode = requireTextForPublish(bucket, "aggregationMode", "/coefficientBuckets/aggregationMode")
            .toLowerCase(Locale.ROOT);
        if (!COEFFICIENT_BUCKET_AGGREGATION_MODES.contains(aggregationMode)) {
            throw semantic(
                "coefficientBucket.aggregationMode invalid",
                Map.of("path", "/coefficientBuckets/aggregationMode", "aggregationMode", aggregationMode)
            );
        }

        JsonNode targetAttrKeyNode = bucket.get("targetAttrKey");
        if ("attribute".equals(resolutionDomain)) {
            if (targetAttrKeyNode == null || !targetAttrKeyNode.isTextual() || targetAttrKeyNode.asText().isBlank()) {
                throw semantic(
                    "coefficientBucket.targetAttrKey is required when resolutionDomain=attribute",
                    Map.of("path", "/coefficientBuckets/targetAttrKey")
                );
            }
            if (!attrKeys.contains(targetAttrKeyNode.asText())) {
                throw semantic(
                    "coefficientBucket.targetAttrKey not found",
                    Map.of("path", "/coefficientBuckets/targetAttrKey", "targetAttrKey", targetAttrKeyNode.asText())
                );
            }
        } else if (targetAttrKeyNode != null && !targetAttrKeyNode.isNull()) {
            throw semantic(
                "coefficientBucket.targetAttrKey must be null when resolutionDomain=hp_change",
                Map.of("path", "/coefficientBuckets/targetAttrKey")
            );
        }

        JsonNode provisional = bucket.get("provisional");
        if (provisional != null && !provisional.isNull() && !provisional.isBoolean()) {
            throw semantic("coefficientBucket.provisional must be boolean", Map.of("path", "/coefficientBuckets/provisional"));
        }
        JsonNode editorHint = bucket.get("editorHint");
        if (editorHint != null && !editorHint.isNull() && !editorHint.isObject()) {
            throw semantic("coefficientBucket.editorHint must be object", Map.of("path", "/coefficientBuckets/editorHint"));
        }
        JsonNode bucketConfig = bucket.get("bucketConfig");
        if (bucketConfig != null && !bucketConfig.isNull() && !bucketConfig.isObject()) {
            throw semantic("coefficientBucket.bucketConfig must be object", Map.of("path", "/coefficientBuckets/bucketConfig"));
        }
    }

    private void validateStatusActionControlRuleForPublish(ObjectNode rule, Set<Integer> typeIds) {
        String ruleId = requireTextForPublish(rule, "ruleId", "/statusActionControlRules/ruleId");
        JsonNode statusTypeIdNode = rule.get("statusTypeId");
        if (statusTypeIdNode == null || !statusTypeIdNode.canConvertToInt()) {
            throw semantic("statusActionControlRule.statusTypeId must be integer", Map.of("path", "/statusActionControlRules/statusTypeId"));
        }
        int statusTypeId = statusTypeIdNode.asInt();
        if (!typeIds.contains(statusTypeId)) {
            throw semantic(
                "statusActionControlRule.statusTypeId not found",
                Map.of("path", "/statusActionControlRules/statusTypeId", "ruleId", ruleId, "typeId", statusTypeId)
            );
        }

        String ruleKind = requireTextForPublish(rule, "ruleKind", "/statusActionControlRules/ruleKind").toLowerCase(Locale.ROOT);
        if (!STATUS_ACTION_CONTROL_RULE_KINDS.contains(ruleKind)) {
            throw semantic(
                "statusActionControlRule.ruleKind invalid",
                Map.of("path", "/statusActionControlRules/ruleKind", "ruleId", ruleId, "ruleKind", ruleKind)
            );
        }

        validateTypeIdArrayForPublish(rule.get("actionTypeIds"), "/statusActionControlRules/actionTypeIds", typeIds, false);
        validateTypeIdArrayForPublish(rule.get("actionMatchTypeIds"), "/statusActionControlRules/actionMatchTypeIds", typeIds, true);
        JsonNode interruptPhaseTypeIds = rule.get("interruptPhaseTypeIds");
        validateTypeIdArrayForPublish(interruptPhaseTypeIds, "/statusActionControlRules/interruptPhaseTypeIds", typeIds, true);

        int interruptCount = interruptPhaseTypeIds == null || interruptPhaseTypeIds.isNull() ? 0 : interruptPhaseTypeIds.size();
        if ("forbid".equals(ruleKind) && interruptCount > 0) {
            throw semantic(
                "statusActionControlRule.interruptPhaseTypeIds must be empty when ruleKind=forbid",
                Map.of("path", "/statusActionControlRules/interruptPhaseTypeIds", "ruleId", ruleId)
            );
        }
        if ("interrupt".equals(ruleKind) && interruptCount == 0) {
            throw semantic(
                "statusActionControlRule.interruptPhaseTypeIds must be non-empty when ruleKind=interrupt",
                Map.of("path", "/statusActionControlRules/interruptPhaseTypeIds", "ruleId", ruleId)
            );
        }
    }

    private void validateStatusDefinitionForPublish(
        ObjectNode statusDefinition,
        Set<Integer> typeIds,
        Set<String> controlProfileIds,
        Set<String> formulaIds
    ) {
        requireEnumForPublish(statusDefinition, "statusKind", "/statusDefinitions/statusKind", STATUS_KINDS);
        JsonNode statusTypeIdNode = statusDefinition.get("statusTypeId");
        if (statusTypeIdNode != null && !statusTypeIdNode.isNull()) {
            if (!statusTypeIdNode.canConvertToInt()) {
                throw semantic("statusDefinition.statusTypeId must be integer", Map.of("path", "/statusDefinitions/statusTypeId"));
            }
            int statusTypeId = statusTypeIdNode.asInt();
            if (!typeIds.contains(statusTypeId)) {
                throw semantic("statusDefinition.statusTypeId not found", Map.of("path", "/statusDefinitions/statusTypeId", "typeId", statusTypeId));
            }
        }
        String controlProfileId = optionalTextForPublish(statusDefinition, "controlProfileId", "/statusDefinitions/controlProfileId");
        if (controlProfileId != null && !controlProfileIds.contains(controlProfileId)) {
            throw semantic(
                "statusDefinition.controlProfileId not found",
                Map.of("path", "/statusDefinitions/controlProfileId", "controlProfileId", controlProfileId)
            );
        }
        requireTextForPublish(statusDefinition, "stackGroupKey", "/statusDefinitions/stackGroupKey");
        requireEnumForPublish(statusDefinition, "sourceScope", "/statusDefinitions/sourceScope", STATUS_SOURCE_SCOPES);
        requireEnumForPublish(statusDefinition, "stackMode", "/statusDefinitions/stackMode", STATUS_STACK_MODES);
        requirePositiveIntegerForPublish(statusDefinition, "maxStacks", "/statusDefinitions/maxStacks");
        optionalPositiveIntegerForPublish(statusDefinition, "maxInstances", "/statusDefinitions/maxInstances");
        String durationMode = requireEnumForPublish(statusDefinition, "durationMode", "/statusDefinitions/durationMode", STATUS_DURATION_MODES);
        Integer durationMs = optionalPositiveIntegerForPublish(statusDefinition, "durationMs", "/statusDefinitions/durationMs");
        String durationFormulaId = optionalTextForPublish(statusDefinition, "durationFormulaId", "/statusDefinitions/durationFormulaId");
        if (durationFormulaId != null && !formulaIds.contains(durationFormulaId)) {
            throw semantic("statusDefinition.durationFormulaId not found", Map.of("path", "/statusDefinitions/durationFormulaId", "formulaId", durationFormulaId));
        }
        String defaultMagnitudeFormulaId = optionalTextForPublish(
            statusDefinition,
            "defaultMagnitudeFormulaId",
            "/statusDefinitions/defaultMagnitudeFormulaId"
        );
        if (defaultMagnitudeFormulaId != null && !formulaIds.contains(defaultMagnitudeFormulaId)) {
            throw semantic(
                "statusDefinition.defaultMagnitudeFormulaId not found",
                Map.of("path", "/statusDefinitions/defaultMagnitudeFormulaId", "formulaId", defaultMagnitudeFormulaId)
            );
        }
        validateStatusDuration(durationMode, durationMs, durationFormulaId, "/statusDefinitions");
        requireEnumForPublish(statusDefinition, "snapshotPolicy", "/statusDefinitions/snapshotPolicy", STATUS_SNAPSHOT_POLICIES);
        optionalBooleanForPublish(statusDefinition, "isDispellable", "/statusDefinitions/isDispellable");
        optionalIntegerForPublish(statusDefinition, "cleansePriority", "/statusDefinitions/cleansePriority");
        validateOptionalObjectForPublish(statusDefinition, "statusDefinition", "extend", "/statusDefinitions/extend");
    }

    private void validateControlStateProfileForPublish(ObjectNode controlStateProfile) {
        requireTextForPublish(controlStateProfile, "name", "/controlStateProfiles/name");
        requireEnumForPublish(controlStateProfile, "controlKind", "/controlStateProfiles/controlKind", CONTROL_KINDS);
        requireEnumForPublish(controlStateProfile, "movementLockMode", "/controlStateProfiles/movementLockMode", MOVEMENT_LOCK_MODES);
        requireEnumForPublish(controlStateProfile, "castLockMode", "/controlStateProfiles/castLockMode", CAST_LOCK_MODES);
        requireEnumForPublish(controlStateProfile, "attackLockMode", "/controlStateProfiles/attackLockMode", ATTACK_LOCK_MODES);
        requireEnumForPublish(controlStateProfile, "inputOverrideMode", "/controlStateProfiles/inputOverrideMode", INPUT_OVERRIDE_MODES);
        requireEnumForPublish(controlStateProfile, "displacementKind", "/controlStateProfiles/displacementKind", DISPLACEMENT_KINDS);
        optionalBooleanForPublish(controlStateProfile, "blocksControlInput", "/controlStateProfiles/blocksControlInput");
        optionalBooleanForPublish(controlStateProfile, "grantsUnstoppable", "/controlStateProfiles/grantsUnstoppable");
        optionalBooleanForPublish(controlStateProfile, "breaksOnDamage", "/controlStateProfiles/breaksOnDamage");
        optionalBooleanForPublish(controlStateProfile, "tenacityReducible", "/controlStateProfiles/tenacityReducible");
        optionalIntegerForPublish(controlStateProfile, "priority", "/controlStateProfiles/priority");
        validateOptionalObjectForPublish(controlStateProfile, "controlStateProfile", "extend", "/controlStateProfiles/extend");
    }

    private void validateStatusModifierGroupForPublish(ObjectNode group, Set<String> statusIds) {
        String statusId = requireTextForPublish(group, "statusId", "/statusModifierGroups/statusId");
        if (!statusIds.contains(statusId)) {
            throw semantic("statusModifierGroup.statusId not found", Map.of("path", "/statusModifierGroups/statusId", "statusId", statusId));
        }
        requireTextForPublish(group, "groupKey", "/statusModifierGroups/groupKey");
        String phaseKey = requireEnumForPublish(group, "phaseKey", "/statusModifierGroups/phaseKey", STATUS_GROUP_PHASE_KEYS);
        requireEnumForPublish(group, "snapshotPolicy", "/statusModifierGroups/snapshotPolicy", STATUS_GROUP_SNAPSHOT_POLICIES);
        Integer intervalMs = optionalPositiveIntegerForPublish(group, "intervalMs", "/statusModifierGroups/intervalMs");
        Integer maxTicks = optionalPositiveIntegerForPublish(group, "maxTicks", "/statusModifierGroups/maxTicks");
        validateStatusGroupInterval(phaseKey, intervalMs, maxTicks, "/statusModifierGroups");
        optionalIntegerForPublish(group, "priority", "/statusModifierGroups/priority");
        validateOptionalObjectForPublish(group, "statusModifierGroup", "extend", "/statusModifierGroups/extend");
    }

    private void validateStatusAttributeModifierForPublish(
        ObjectNode modifier,
        Set<String> statusIds,
        Set<String> statusGroupKeys,
        Set<String> attrKeys,
        Set<String> formulaIds,
        Set<String> bucketKeys
    ) {
        String statusId = requireTextForPublish(modifier, "statusId", "/statusAttributeModifiers/statusId");
        if (!statusIds.contains(statusId)) {
            throw semantic("statusAttributeModifier.statusId not found", Map.of("path", "/statusAttributeModifiers/statusId", "statusId", statusId));
        }
        String groupKey = requireTextForPublish(modifier, "groupKey", "/statusAttributeModifiers/groupKey");
        if (!statusGroupKeys.contains(statusGroupKey(statusId, groupKey))) {
            throw semantic(
                "statusAttributeModifier.groupKey not found",
                Map.of("path", "/statusAttributeModifiers/groupKey", "statusId", statusId, "groupKey", groupKey)
            );
        }
        requireTextForPublish(modifier, "modifierId", "/statusAttributeModifiers/modifierId");
        String attrKey = requireTextForPublish(modifier, "attrKey", "/statusAttributeModifiers/attrKey");
        if (!attrKeys.contains(attrKey)) {
            throw semantic("statusAttributeModifier.attrKey not found", Map.of("path", "/statusAttributeModifiers/attrKey", "attrKey", attrKey));
        }
        String modifierMode = requireEnumForPublish(modifier, "modifierMode", "/statusAttributeModifiers/modifierMode", STATUS_MODIFIER_MODES);
        JsonNode value = modifier.get("value");
        if (value != null && !value.isNull() && !value.isNumber()) {
            throw semantic("statusAttributeModifier.value must be number", Map.of("path", "/statusAttributeModifiers/value"));
        }
        String formulaId = optionalTextForPublish(modifier, "formulaId", "/statusAttributeModifiers/formulaId");
        if (formulaId != null && !formulaIds.contains(formulaId)) {
            throw semantic("statusAttributeModifier.formulaId not found", Map.of("path", "/statusAttributeModifiers/formulaId", "formulaId", formulaId));
        }
        if ((value == null || value.isNull()) && formulaId == null) {
            throw semantic("statusAttributeModifier.value or formulaId is required", Map.of("path", "/statusAttributeModifiers/value"));
        }
        String bucketKey = optionalTextForPublish(modifier, "bucketKey", "/statusAttributeModifiers/bucketKey");
        validateStatusModifierBucketForPublish(modifierMode, bucketKey, bucketKeys);
        optionalBooleanForPublish(modifier, "perStack", "/statusAttributeModifiers/perStack");
        optionalIntegerForPublish(modifier, "priority", "/statusAttributeModifiers/priority");
        validateOptionalObjectForPublish(modifier, "statusAttributeModifier", "extend", "/statusAttributeModifiers/extend");
    }

    private void validateStatusPeriodicHpEffectForPublish(
        ObjectNode effect,
        Set<String> statusIds,
        Set<String> statusGroupKeys,
        Set<String> formulaIds
    ) {
        String statusId = requireTextForPublish(effect, "statusId", "/statusPeriodicHpEffects/statusId");
        if (!statusIds.contains(statusId)) {
            throw semantic("statusPeriodicHpEffect.statusId not found", Map.of("path", "/statusPeriodicHpEffects/statusId", "statusId", statusId));
        }
        String groupKey = requireTextForPublish(effect, "groupKey", "/statusPeriodicHpEffects/groupKey");
        if (!statusGroupKeys.contains(statusGroupKey(statusId, groupKey))) {
            throw semantic(
                "statusPeriodicHpEffect.groupKey not found",
                Map.of("path", "/statusPeriodicHpEffects/groupKey", "statusId", statusId, "groupKey", groupKey)
            );
        }
        requireTextForPublish(effect, "effectId", "/statusPeriodicHpEffects/effectId");
        String effectKind = requireEnumForPublish(effect, "effectKind", "/statusPeriodicHpEffects/effectKind", STATUS_PERIODIC_EFFECT_KINDS);
        String tickFormulaId = requireTextForPublish(effect, "tickFormulaId", "/statusPeriodicHpEffects/tickFormulaId");
        if (!formulaIds.contains(tickFormulaId)) {
            throw semantic(
                "statusPeriodicHpEffect.tickFormulaId not found",
                Map.of("path", "/statusPeriodicHpEffects/tickFormulaId", "formulaId", tickFormulaId)
            );
        }
        String damageType = optionalTextForPublish(effect, "damageType", "/statusPeriodicHpEffects/damageType");
        Boolean affectedByHealModifier = optionalBooleanForPublish(
            effect,
            "affectedByHealModifier",
            "/statusPeriodicHpEffects/affectedByHealModifier"
        );
        validatePeriodicHpEffectKind(effectKind, damageType, affectedByHealModifier, "/statusPeriodicHpEffects");
        boolean canCrit = Boolean.TRUE.equals(optionalBooleanForPublish(effect, "canCrit", "/statusPeriodicHpEffects/canCrit"));
        String critChanceSource = optionalTextForPublish(effect, "critChanceSource", "/statusPeriodicHpEffects/critChanceSource");
        if (critChanceSource == null) {
            critChanceSource = "none";
        } else {
            critChanceSource = critChanceSource.toLowerCase(Locale.ROOT);
            if (!STATUS_PERIODIC_CRIT_CHANCE_SOURCES.contains(critChanceSource)) {
                throw semantic(
                    "statusPeriodicHpEffect.critChanceSource invalid",
                    Map.of("path", "/statusPeriodicHpEffects/critChanceSource", "critChanceSource", critChanceSource)
                );
            }
        }
        BigDecimal critChance = optionalBigDecimalForPublish(effect, "critChance", "/statusPeriodicHpEffects/critChance");
        BigDecimal critMultiplier = optionalBigDecimalForPublish(effect, "critMultiplier", "/statusPeriodicHpEffects/critMultiplier");
        validateStatusPeriodicHpEffectCrit(canCrit, critChanceSource, critChance, critMultiplier, "/statusPeriodicHpEffects");
        optionalBooleanForPublish(effect, "perStack", "/statusPeriodicHpEffects/perStack");
        validateOptionalObjectForPublish(effect, "statusPeriodicHpEffect", "extend", "/statusPeriodicHpEffects/extend");
    }

    private void validateItemForPublish(ObjectNode item, Set<String> skillIds, Set<String> itemIds, Set<String> attrKeys) {
        String itemId = requireTextForPublish(item, "itemId", "/items/itemId");
        JsonNode statModifiers = item.get("statModifiers");
        if (statModifiers != null && !statModifiers.isNull()) {
            if (!statModifiers.isArray()) {
                throw semantic("item.statModifiers must be array", Map.of("path", "/items/statModifiers"));
            }
            Set<String> seenAttrKeys = new HashSet<>();
            for (int i = 0; i < statModifiers.size(); i++) {
                JsonNode node = statModifiers.get(i);
                if (node == null || !node.isObject()) {
                    throw semantic("item.statModifiers must contain objects", Map.of("path", "/items/statModifiers/" + i));
                }
                JsonNode attrKeyNode = node.get("attrKey");
                if (attrKeyNode == null || !attrKeyNode.isTextual() || attrKeyNode.asText().isBlank()) {
                    throw semantic("item.statModifier.attrKey is required", Map.of("path", "/items/statModifiers/" + i + "/attrKey"));
                }
                String attrKey = attrKeyNode.asText();
                if (!attrKeys.contains(attrKey)) {
                    throw semantic(
                        "item.statModifier.attrKey not found",
                        Map.of("path", "/items/statModifiers/" + i + "/attrKey", "attrKey", attrKey)
                    );
                }
                if (!seenAttrKeys.add(attrKey)) {
                    throw semantic(
                        "item.statModifier.attrKey duplicated",
                        Map.of("path", "/items/statModifiers/" + i + "/attrKey", "attrKey", attrKey)
                    );
                }
                JsonNode valueNode = node.get("value");
                if (valueNode == null || !valueNode.isNumber()) {
                    throw semantic("item.statModifier.value must be number", Map.of("path", "/items/statModifiers/" + i + "/value"));
                }
            }
        }

        JsonNode skillRefs = item.get("skillRefs");
        if (skillRefs != null && !skillRefs.isNull()) {
            if (!skillRefs.isArray()) {
                throw semantic("item.skillRefs must be array", Map.of("path", "/items/skillRefs"));
            }
            for (int i = 0; i < skillRefs.size(); i++) {
                JsonNode node = skillRefs.get(i);
                if (!node.isTextual()) {
                    throw semantic("item.skillRefs must contain string", Map.of("path", "/items/skillRefs/" + i));
                }
                if (!skillIds.contains(node.asText())) {
                    throw semantic("item.skillRefs reference not found", Map.of("path", "/items/skillRefs/" + i, "skillId", node.asText()));
                }
            }
        }

        JsonNode recipeIds = item.get("recipeIds");
        if (recipeIds != null && !recipeIds.isNull()) {
            if (!recipeIds.isArray()) {
                throw semantic("item.recipeIds must be array", Map.of("path", "/items/recipeIds"));
            }
            for (int i = 0; i < recipeIds.size(); i++) {
                JsonNode node = recipeIds.get(i);
                if (!node.isTextual()) {
                    throw semantic("item.recipeIds must contain string", Map.of("path", "/items/recipeIds/" + i));
                }
                String refId = node.asText();
                if (!refId.equals(itemId) && !itemIds.contains(refId)) {
                    throw semantic("item.recipeIds reference not found", Map.of("path", "/items/recipeIds/" + i, "itemId", refId));
                }
            }
        }
    }

    private void validateTypeRelationForPublish(
        ObjectNode relation,
        Set<Integer> typeIds,
        Set<String> attrKeys,
        Set<String> skillIds,
        Set<String> heroIds,
        Set<String> itemIds
    ) {
        JsonNode typeIdNode = relation.get("typeId");
        if (typeIdNode == null || !typeIdNode.canConvertToInt()) {
            throw semantic("typeRelation.typeId must be integer", Map.of("path", "/typeRelations/typeId"));
        }
        int typeId = typeIdNode.asInt();
        if (!typeIds.contains(typeId)) {
            throw semantic("typeRelation.typeId not found", Map.of("path", "/typeRelations/typeId", "typeId", typeId));
        }
        String targetCategory = requireTextForPublish(relation, "targetCategory", "/typeRelations/targetCategory").toLowerCase(Locale.ROOT);
        if (!TARGET_CATEGORIES.contains(targetCategory)) {
            throw semantic("typeRelation.targetCategory invalid", Map.of("path", "/typeRelations/targetCategory"));
        }
        String targetId = requireTextForPublish(relation, "targetId", "/typeRelations/targetId");
        boolean found = switch (targetCategory) {
            case "equipment" -> itemIds.contains(targetId);
            case "attribute" -> attrKeys.contains(targetId);
            case "skill" -> skillIds.contains(targetId);
            case "character" -> heroIds.contains(targetId);
            case "type" -> {
                try {
                    yield typeIds.contains(Integer.parseInt(targetId));
                } catch (NumberFormatException ex) {
                    throw semantic("typeRelation targetId must be numeric for category type", Map.of("targetId", targetId));
                }
            }
            default -> false;
        };
        if (!found) {
            throw semantic(
                "typeRelation target not found",
                Map.of("path", "/typeRelations/targetId", "targetCategory", targetCategory, "targetId", targetId)
            );
        }
    }

    private void validateTypeIdArrayForPublish(JsonNode value, String path, Set<Integer> typeIds, boolean allowEmpty) {
        if (value == null || value.isNull()) {
            if (allowEmpty) {
                return;
            }
            throw semantic("required array is missing", Map.of("path", path));
        }
        if (!value.isArray()) {
            throw semantic("field must be array", Map.of("path", path));
        }
        if (!allowEmpty && value.isEmpty()) {
            throw semantic("field must be non-empty array", Map.of("path", path));
        }
        for (int i = 0; i < value.size(); i++) {
            JsonNode item = value.get(i);
            if (!item.canConvertToInt()) {
                throw semantic("array must contain integers", Map.of("path", path + "/" + i));
            }
            int typeId = item.asInt();
            if (!typeIds.contains(typeId)) {
                throw semantic("typeId not found", Map.of("path", path + "/" + i, "typeId", typeId));
            }
        }
    }

    private Integer nullableExistingTypeId(String gameId, JsonNode value, String path, String fieldLabel) {
        if (value == null || value.isNull()) {
            return null;
        }
        return requireExistingTypeId(gameId, value, path, fieldLabel);
    }

    private String requireEnum(ObjectNode node, String fieldName, String objectName, Set<String> allowedValues) {
        String value = jsonSupport.requireText(node, fieldName, objectName).toLowerCase(Locale.ROOT);
        if (!allowedValues.contains(value)) {
            throw badRequest(objectName + "." + fieldName + " invalid", Map.of("path", "/" + fieldName, fieldName, value));
        }
        node.put(fieldName, value);
        return value;
    }

    private String defaultEnum(
        ObjectNode node,
        String fieldName,
        String defaultValue,
        String objectName,
        Set<String> allowedValues
    ) {
        JsonNode value = node.get(fieldName);
        if (value == null || value.isNull()) {
            node.put(fieldName, defaultValue);
            return defaultValue;
        }
        return requireEnum(node, fieldName, objectName, allowedValues);
    }

    private boolean defaultBoolean(ObjectNode node, String fieldName, boolean defaultValue) {
        Boolean value = nullableBoolean(node, fieldName);
        if (value == null) {
            node.put(fieldName, defaultValue);
            return defaultValue;
        }
        return value;
    }

    private int defaultInteger(ObjectNode node, String fieldName, int defaultValue) {
        Integer value = nullableInteger(node, fieldName);
        if (value == null) {
            node.put(fieldName, defaultValue);
            return defaultValue;
        }
        return value;
    }

    private int defaultPositiveInteger(ObjectNode node, String fieldName, int defaultValue) {
        int value = defaultInteger(node, fieldName, defaultValue);
        if (value < 1) {
            throw badRequest(fieldName + " must be positive integer", Map.of("path", "/" + fieldName));
        }
        return value;
    }

    private Integer nullablePositiveInteger(ObjectNode node, String fieldName) {
        Integer value = nullableInteger(node, fieldName);
        if (value != null && value < 1) {
            throw badRequest(fieldName + " must be positive integer", Map.of("path", "/" + fieldName));
        }
        return value;
    }

    private void requireFormulaIfPresent(String gameId, String formulaId, String path, String fieldLabel) {
        if (formulaId != null && readStore.loadFormulaProfile(gameId, formulaId) == null) {
            throw semantic(fieldLabel + " not found", Map.of("path", path, "formulaId", formulaId));
        }
    }

    private void requireStatusDefinition(String gameId, String statusId, String path) {
        if (readStore.loadStatusDefinition(gameId, statusId) == null) {
            throw semantic("statusDefinition not found", Map.of("path", path, "statusId", statusId));
        }
    }

    private void requireStatusModifierGroup(String gameId, String statusId, String groupKey, String path) {
        if (readStore.loadStatusModifierGroup(gameId, statusId, groupKey) == null) {
            throw semantic("statusModifierGroup not found", Map.of("path", path, "statusId", statusId, "groupKey", groupKey));
        }
    }

    private void validateStatusDuration(String durationMode, Integer durationMs, String durationFormulaId, String pathPrefix) {
        String path = pathPrefix.isBlank() ? "/durationMode" : pathPrefix + "/durationMode";
        if ("permanent".equals(durationMode)) {
            if (durationMs != null || durationFormulaId != null) {
                throw statusValidationError(
                    pathPrefix,
                    "statusDefinition permanent duration must not set durationMs or durationFormulaId",
                    Map.of("path", path)
                );
            }
            return;
        }
        if (durationMs == null && durationFormulaId == null) {
            throw statusValidationError(
                pathPrefix,
                "statusDefinition timed duration requires durationMs or durationFormulaId",
                Map.of("path", path)
            );
        }
    }

    private void validateStatusGroupInterval(String phaseKey, Integer intervalMs, Integer maxTicks, String pathPrefix) {
        String path = pathPrefix.isBlank() ? "/phaseKey" : pathPrefix + "/phaseKey";
        if ("on_interval".equals(phaseKey)) {
            if (intervalMs == null) {
                throw statusValidationError(
                    pathPrefix,
                    "statusModifierGroup.intervalMs is required when phaseKey=on_interval",
                    Map.of("path", path)
                );
            }
            return;
        }
        if (intervalMs != null || maxTicks != null) {
            throw statusValidationError(
                pathPrefix,
                "statusModifierGroup intervalMs and maxTicks must be null unless phaseKey=on_interval",
                Map.of("path", path)
            );
        }
    }

    private void validateStatusModifierBucket(String gameId, String modifierMode, String bucketKey) {
        boolean bucketMode = "bucket_add".equals(modifierMode) || "bucket_mul".equals(modifierMode);
        if (bucketMode && (bucketKey == null || bucketKey.isBlank())) {
            throw badRequest("statusAttributeModifier.bucketKey is required for bucket modifier modes", Map.of("path", "/bucketKey"));
        }
        if (bucketKey != null && readStore.loadCoefficientBucket(gameId, bucketKey) == null) {
            throw semantic("statusAttributeModifier.bucketKey not found", Map.of("path", "/bucketKey", "bucketKey", bucketKey));
        }
    }

    private void validateStatusModifierBucketForPublish(String modifierMode, String bucketKey, Set<String> bucketKeys) {
        boolean bucketMode = "bucket_add".equals(modifierMode) || "bucket_mul".equals(modifierMode);
        if (bucketMode && (bucketKey == null || bucketKey.isBlank())) {
            throw semantic(
                "statusAttributeModifier.bucketKey is required for bucket modifier modes",
                Map.of("path", "/statusAttributeModifiers/bucketKey")
            );
        }
        if (bucketKey != null && !bucketKeys.contains(bucketKey)) {
            throw semantic(
                "statusAttributeModifier.bucketKey not found",
                Map.of("path", "/statusAttributeModifiers/bucketKey", "bucketKey", bucketKey)
            );
        }
    }

    private String resolveStatusPeriodicCritChanceSource(ObjectNode merged, boolean canCrit) {
        JsonNode value = merged.get("critChanceSource");
        if (value == null || value.isNull()) {
            String defaultSource = "none";
            merged.put("critChanceSource", defaultSource);
            return defaultSource;
        }
        if (!value.isTextual() || value.asText().isBlank()) {
            throw badRequest(
                "statusPeriodicHpEffect.critChanceSource must be non-empty string",
                Map.of("path", "/critChanceSource")
            );
        }
        String critChanceSource = value.asText().toLowerCase(Locale.ROOT);
        if (!STATUS_PERIODIC_CRIT_CHANCE_SOURCES.contains(critChanceSource)) {
            throw badRequest(
                "statusPeriodicHpEffect.critChanceSource invalid",
                Map.of("path", "/critChanceSource", "critChanceSource", critChanceSource)
            );
        }
        if (!canCrit && !"none".equals(critChanceSource)) {
            throw badRequest(
                "statusPeriodicHpEffect.critChanceSource must be none when canCrit=false",
                Map.of("path", "/critChanceSource", "critChanceSource", critChanceSource)
            );
        }
        merged.put("critChanceSource", critChanceSource);
        return critChanceSource;
    }

    private void validateStatusPeriodicHpEffectCrit(
        boolean canCrit,
        String critChanceSource,
        BigDecimal critChance,
        BigDecimal critMultiplier,
        String pathPrefix
    ) {
        String basePath = pathPrefix.isBlank() ? "" : pathPrefix;
        if (!canCrit) {
            if (!"none".equals(critChanceSource)) {
                throw statusValidationError(
                    pathPrefix,
                    "statusPeriodicHpEffect.critChanceSource must be none when canCrit=false",
                    Map.of("path", basePath + "/critChanceSource", "critChanceSource", critChanceSource)
                );
            }
            if (critChance != null) {
                throw statusValidationError(
                    pathPrefix,
                    "statusPeriodicHpEffect.critChance must be null when canCrit=false",
                    Map.of("path", basePath + "/critChance")
                );
            }
            if (critMultiplier != null) {
                throw statusValidationError(
                    pathPrefix,
                    "statusPeriodicHpEffect.critMultiplier must be null when canCrit=false",
                    Map.of("path", basePath + "/critMultiplier")
                );
            }
            return;
        }
        if ("none".equals(critChanceSource)) {
            throw statusValidationError(
                pathPrefix,
                "statusPeriodicHpEffect.critChanceSource cannot be none when canCrit=true",
                Map.of("path", basePath + "/critChanceSource", "critChanceSource", critChanceSource)
            );
        }
        if (critMultiplier == null || critMultiplier.compareTo(BigDecimal.ZERO) <= 0) {
            throw statusValidationError(
                pathPrefix,
                "statusPeriodicHpEffect.critMultiplier must be > 0 when canCrit=true",
                Map.of("path", basePath + "/critMultiplier")
            );
        }
        if ("fixed".equals(critChanceSource)) {
            if (critChance == null) {
                throw statusValidationError(
                    pathPrefix,
                    "statusPeriodicHpEffect.critChance is required when critChanceSource=fixed",
                    Map.of("path", basePath + "/critChance")
                );
            }
            if (critChance.compareTo(BigDecimal.ZERO) < 0 || critChance.compareTo(BigDecimal.ONE) > 0) {
                throw statusValidationError(
                    pathPrefix,
                    "statusPeriodicHpEffect.critChance must be within [0,1] when critChanceSource=fixed",
                    Map.of("path", basePath + "/critChance", "critChance", critChance)
                );
            }
            return;
        }
        if ("attacker_crit_chance".equals(critChanceSource)) {
            if (critChance != null) {
                throw statusValidationError(
                    pathPrefix,
                    "statusPeriodicHpEffect.critChance must be null when critChanceSource=attacker_crit_chance",
                    Map.of("path", basePath + "/critChance")
                );
            }
            return;
        }
        throw statusValidationError(
            pathPrefix,
            "statusPeriodicHpEffect.critChanceSource invalid",
            Map.of("path", basePath + "/critChanceSource", "critChanceSource", critChanceSource)
        );
    }

    private void validatePeriodicHpEffectKind(
        String effectKind,
        String damageType,
        Boolean affectedByHealModifier,
        String pathPrefix
    ) {
        if ("damage".equals(effectKind)) {
            if (damageType == null || !DAMAGE_TYPES.contains(damageType)) {
                throw statusValidationError(
                    pathPrefix,
                    "statusPeriodicHpEffect.damageType is required for damage",
                    Map.of("path", pathPrefix.isBlank() ? "/damageType" : pathPrefix + "/damageType")
                );
            }
            if (affectedByHealModifier != null) {
                throw statusValidationError(
                    pathPrefix,
                    "statusPeriodicHpEffect.affectedByHealModifier must be null for damage",
                    Map.of("path", pathPrefix.isBlank() ? "/affectedByHealModifier" : pathPrefix + "/affectedByHealModifier")
                );
            }
            return;
        }
        if (damageType != null) {
            throw statusValidationError(
                pathPrefix,
                "statusPeriodicHpEffect.damageType must be null for heal",
                Map.of("path", pathPrefix.isBlank() ? "/damageType" : pathPrefix + "/damageType")
            );
        }
        if (affectedByHealModifier == null) {
            throw statusValidationError(
                pathPrefix,
                "statusPeriodicHpEffect.affectedByHealModifier is required for heal",
                Map.of("path", pathPrefix.isBlank() ? "/affectedByHealModifier" : pathPrefix + "/affectedByHealModifier")
            );
        }
    }

    private String requireEnumForPublish(ObjectNode node, String fieldName, String path, Set<String> allowedValues) {
        String value = requireTextForPublish(node, fieldName, path).toLowerCase(Locale.ROOT);
        if (!allowedValues.contains(value)) {
            throw semantic(fieldName + " invalid", Map.of("path", path, fieldName, value));
        }
        return value;
    }

    private String optionalTextForPublish(ObjectNode node, String fieldName, String path) {
        JsonNode value = node.get(fieldName);
        if (value == null || value.isNull()) {
            return null;
        }
        if (!value.isTextual() || value.asText().isBlank()) {
            throw semantic(fieldName + " must be non-empty string", Map.of("path", path));
        }
        return value.asText();
    }

    private Integer optionalIntegerForPublish(ObjectNode node, String fieldName, String path) {
        JsonNode value = node.get(fieldName);
        if (value == null || value.isNull()) {
            return null;
        }
        if (!value.canConvertToInt()) {
            throw semantic(fieldName + " must be integer", Map.of("path", path));
        }
        return value.asInt();
    }

    private BigDecimal optionalBigDecimalForPublish(ObjectNode node, String fieldName, String path) {
        JsonNode value = node.get(fieldName);
        if (value == null || value.isNull()) {
            return null;
        }
        if (!value.isNumber()) {
            throw semantic(fieldName + " must be number", Map.of("path", path));
        }
        return value.decimalValue();
    }

    private Integer requirePositiveIntegerForPublish(ObjectNode node, String fieldName, String path) {
        Integer value = optionalIntegerForPublish(node, fieldName, path);
        if (value == null || value < 1) {
            throw semantic(fieldName + " must be positive integer", Map.of("path", path));
        }
        return value;
    }

    private Integer optionalPositiveIntegerForPublish(ObjectNode node, String fieldName, String path) {
        Integer value = optionalIntegerForPublish(node, fieldName, path);
        if (value != null && value < 1) {
            throw semantic(fieldName + " must be positive integer", Map.of("path", path));
        }
        return value;
    }

    private Boolean optionalBooleanForPublish(ObjectNode node, String fieldName, String path) {
        JsonNode value = node.get(fieldName);
        if (value == null || value.isNull()) {
            return null;
        }
        if (!value.isBoolean()) {
            throw semantic(fieldName + " must be boolean", Map.of("path", path));
        }
        return value.asBoolean();
    }

    private String statusGroupKey(String statusId, String groupKey) {
        return statusId + "\u0000" + groupKey;
    }

    private ApiException statusValidationError(String pathPrefix, String message, Map<String, Object> details) {
        return pathPrefix == null || pathPrefix.isBlank()
            ? badRequest(message, details)
            : semantic(message, details);
    }

    private ArrayNode requireArray(ObjectNode node, String fieldName) {
        JsonNode value = node.get(fieldName);
        if (value == null || !value.isArray()) {
            throw semantic("bundle." + fieldName + " must be array", Map.of("path", "/" + fieldName));
        }
        return (ArrayNode) value;
    }

    private ObjectNode requireObject(JsonNode node, String path) {
        if (node == null || !node.isObject()) {
            throw semantic("bundle element must be object", Map.of("path", path));
        }
        return (ObjectNode) node;
    }

    private String requireTextForPublish(ObjectNode node, String fieldName, String path) {
        JsonNode value = node.get(fieldName);
        if (value == null || !value.isTextual() || value.asText().isBlank()) {
            throw semantic(fieldName + " is required and must be non-empty string", Map.of("path", path));
        }
        return value.asText();
    }

    private void ensureUpdated(int updatedRows, String message, Map<String, Object> details) {
        if (updatedRows == 0) {
            throw notFound(message, details);
        }
    }

    private void validateMechanicsConfig(ObjectNode config) {
        if (!config.path("version").isInt() || config.path("version").asInt() != 1) {
            throw badRequest("mechanicsConfig.version must be 1", Map.of("path", "/mechanicsConfig/version"));
        }
        if (!config.path("triggers").isArray()) {
            throw badRequest("mechanicsConfig.triggers is required and must be array", Map.of("path", "/mechanicsConfig/triggers"));
        }
        validateDpsPassiveEffects(config, "/mechanicsConfig", false);
    }

    private void validateDpsPassiveEffects(ObjectNode config, String pathPrefix, boolean forPublish) {
        JsonNode dpsPassiveEffects = config.get("dpsPassiveEffects");
        if (dpsPassiveEffects == null || dpsPassiveEffects.isNull()) {
            return;
        }

        String basePath = pathPrefix + "/dpsPassiveEffects";
        if (!dpsPassiveEffects.isArray()) {
            throw dpsPassiveValidationError(
                forPublish,
                "mechanicsConfig.dpsPassiveEffects must be array",
                Map.of("path", basePath)
            );
        }

        for (int passiveIndex = 0; passiveIndex < dpsPassiveEffects.size(); passiveIndex++) {
            validateDpsPassiveEffect(dpsPassiveEffects.get(passiveIndex), basePath, passiveIndex, forPublish);
        }
    }

    private void validateDpsPassiveEffect(JsonNode passive, String basePath, int passiveIndex, boolean forPublish) {
        String passivePath = basePath + "/" + passiveIndex;
        if (passive == null || !passive.isObject()) {
            throw dpsPassiveValidationError(
                forPublish,
                "mechanicsConfig.dpsPassiveEffects entry must be object",
                Map.of("path", passivePath)
            );
        }

        JsonNode ownerRole = passive.get("ownerRole");
        if (ownerRole != null && !ownerRole.isNull()) {
            if (!ownerRole.isTextual() || !DPS_PASSIVE_OWNER_ROLES.contains(ownerRole.asText())) {
                throw dpsPassiveValidationError(
                    forPublish,
                    "mechanicsConfig.dpsPassiveEffects ownerRole invalid",
                    Map.of("path", passivePath + "/ownerRole", "ownerRole", ownerRole.asText())
                );
            }
        }

        JsonNode trigger = passive.get("trigger");
        if (trigger != null && !trigger.isNull()) {
            if (!trigger.isObject()) {
                throw dpsPassiveValidationError(
                    forPublish,
                    "mechanicsConfig.dpsPassiveEffects trigger must be object",
                    Map.of("path", passivePath + "/trigger")
                );
            }
            JsonNode triggerEvent = trigger.get("event");
            if (triggerEvent != null && !triggerEvent.isNull()) {
                if (!triggerEvent.isTextual() || !DPS_PASSIVE_TRIGGER_EVENTS.contains(triggerEvent.asText())) {
                    throw dpsPassiveValidationError(
                        forPublish,
                        "mechanicsConfig.dpsPassiveEffects trigger.event invalid",
                        Map.of("path", passivePath + "/trigger/event", "event", triggerEvent.asText())
                    );
                }
            }
        }

        JsonNode operations = passive.get("operations");
        if (operations != null && !operations.isNull()) {
            if (!operations.isArray()) {
                throw dpsPassiveValidationError(
                    forPublish,
                    "mechanicsConfig.dpsPassiveEffects operations must be array",
                    Map.of("path", passivePath + "/operations")
                );
            }
            for (int operationIndex = 0; operationIndex < operations.size(); operationIndex++) {
                validateDpsPassiveOperation(operations.get(operationIndex), passivePath, operationIndex, forPublish);
            }
        }
    }

    private void validateDpsPassiveOperation(JsonNode operation, String passivePath, int operationIndex, boolean forPublish) {
        String operationPath = passivePath + "/operations/" + operationIndex;
        if (operation == null || !operation.isObject()) {
            throw dpsPassiveValidationError(
                forPublish,
                "mechanicsConfig.dpsPassiveEffects operation must be object",
                Map.of("path", operationPath)
            );
        }

        JsonNode targetRole = operation.get("targetRole");
        if (targetRole != null && !targetRole.isNull()) {
            if (!targetRole.isTextual() || !DPS_PASSIVE_TARGET_ROLES.contains(targetRole.asText())) {
                throw dpsPassiveValidationError(
                    forPublish,
                    "mechanicsConfig.dpsPassiveEffects operation targetRole invalid",
                    Map.of("path", operationPath + "/targetRole", "targetRole", targetRole.asText())
                );
            }
        }
    }

    private ApiException dpsPassiveValidationError(boolean forPublish, String message, Map<String, Object> details) {
        return forPublish ? semantic(message, details) : badRequest(message, details);
    }

    private String normalizeAttributeDefinitionValueKind(ObjectNode attributeDefinition) {
        String valueKind = nullableText(attributeDefinition, "valueKind");
        if (valueKind == null || valueKind.isBlank()) {
            attributeDefinition.put("valueKind", "scalar");
            return "scalar";
        }

        String normalized = valueKind.toLowerCase(Locale.ROOT);
        if (!ATTRIBUTE_VALUE_KINDS.contains(normalized)) {
            throw badRequest("attributeDefinition.valueKind invalid", Map.of("path", "/valueKind", "valueKind", valueKind));
        }
        attributeDefinition.put("valueKind", normalized);
        return normalized;
    }

    private String validateAttributeDefinitionRateTarget(String gameId, ObjectNode attributeDefinition, String valueKind) {
        String rateTargetAttrKey = nullableText(attributeDefinition, "rateTargetAttrKey");
        if ("rate".equals(valueKind)) {
            if (rateTargetAttrKey == null || rateTargetAttrKey.isBlank()) {
                throw badRequest(
                    "attributeDefinition.rateTargetAttrKey is required when valueKind=rate",
                    Map.of("path", "/rateTargetAttrKey")
                );
            }
            if (!attributeDefinition.path("attrKey").asText().equals(rateTargetAttrKey)
                && readStore.loadAttributeDefinition(gameId, rateTargetAttrKey) == null) {
                throw semantic(
                    "attributeDefinition.rateTargetAttrKey not found",
                    Map.of("path", "/rateTargetAttrKey", "rateTargetAttrKey", rateTargetAttrKey)
                );
            }
            attributeDefinition.put("rateTargetAttrKey", rateTargetAttrKey);
            return rateTargetAttrKey;
        }

        if (rateTargetAttrKey != null) {
            throw badRequest(
                "attributeDefinition.rateTargetAttrKey must be null unless valueKind=rate",
                Map.of("path", "/rateTargetAttrKey")
            );
        }
        return null;
    }

    private record AttributeDefinitionBounds(BigDecimal minValue, BigDecimal maxValue, BigDecimal defaultValue) {}

    private AttributeDefinitionBounds validateAttributeDefinitionBounds(
        ObjectNode attributeDefinition,
        String minPath,
        String maxPath,
        String defaultPath,
        boolean forPublish
    ) {
        BigDecimal minValue = nullableAttributeDefinitionBigDecimal(attributeDefinition, "minValue", minPath, forPublish);
        BigDecimal maxValue = nullableAttributeDefinitionBigDecimal(attributeDefinition, "maxValue", maxPath, forPublish);
        BigDecimal defaultValue = nullableAttributeDefinitionBigDecimal(attributeDefinition, "defaultValue", defaultPath, forPublish);

        if (minValue != null && maxValue != null && minValue.compareTo(maxValue) > 0) {
            throw attributeDefinitionBoundsError(
                forPublish,
                "attributeDefinition.minValue must be <= maxValue",
                Map.of("path", minPath, "minValue", minValue, "maxValue", maxValue)
            );
        }

        if (defaultValue != null && minValue != null && defaultValue.compareTo(minValue) < 0) {
            throw attributeDefinitionBoundsError(
                forPublish,
                "attributeDefinition.defaultValue must be >= minValue",
                Map.of("path", defaultPath, "defaultValue", defaultValue, "minValue", minValue)
            );
        }

        if (defaultValue != null && maxValue != null && defaultValue.compareTo(maxValue) > 0) {
            throw attributeDefinitionBoundsError(
                forPublish,
                "attributeDefinition.defaultValue must be <= maxValue",
                Map.of("path", defaultPath, "defaultValue", defaultValue, "maxValue", maxValue)
            );
        }

        return new AttributeDefinitionBounds(minValue, maxValue, defaultValue);
    }

    private ApiException attributeDefinitionBoundsError(boolean forPublish, String message, Map<String, Object> details) {
        return forPublish ? semantic(message, details) : badRequest(message, details);
    }

    private void validateAttributeDefinitionForPublish(ObjectNode attributeDefinition, Set<String> attrKeys) {
        String valueKind = attributeDefinition.path("valueKind").asText("scalar").toLowerCase(Locale.ROOT);
        if (!ATTRIBUTE_VALUE_KINDS.contains(valueKind)) {
            throw semantic(
                "attributeDefinition.valueKind invalid",
                Map.of("path", "/attributeDefinitions/valueKind", "valueKind", valueKind)
            );
        }

        validateAttributeDefinitionBounds(
            attributeDefinition,
            "/attributeDefinitions/minValue",
            "/attributeDefinitions/maxValue",
            "/attributeDefinitions/defaultValue",
            true
        );

        String rateTargetAttrKey = nullableText(attributeDefinition, "rateTargetAttrKey");
        if ("rate".equals(valueKind)) {
            if (rateTargetAttrKey == null || rateTargetAttrKey.isBlank()) {
                throw semantic(
                    "attributeDefinition.rateTargetAttrKey is required when valueKind=rate",
                    Map.of("path", "/attributeDefinitions/rateTargetAttrKey")
                );
            }
            if (!attrKeys.contains(rateTargetAttrKey)) {
                throw semantic(
                    "attributeDefinition.rateTargetAttrKey not found",
                    Map.of("path", "/attributeDefinitions/rateTargetAttrKey", "rateTargetAttrKey", rateTargetAttrKey)
                );
            }
            return;
        }

        if (rateTargetAttrKey != null) {
            throw semantic(
                "attributeDefinition.rateTargetAttrKey must be null unless valueKind=rate",
                Map.of("path", "/attributeDefinitions/rateTargetAttrKey")
            );
        }
    }

    private int requireExistingTypeId(String gameId, JsonNode value, String path, String fieldLabel) {
        if (value == null || !value.canConvertToInt()) {
            throw badRequest(fieldLabel + " must be integer", Map.of("path", path));
        }
        int typeId = value.asInt();
        if (readStore.loadType(gameId, typeId) == null) {
            throw semantic(fieldLabel + " not found", Map.of("path", path, "typeId", typeId));
        }
        return typeId;
    }

    private ArrayNode requireTypeIdArray(
        String gameId,
        ObjectNode node,
        String fieldName,
        String path,
        boolean allowEmpty
    ) {
        JsonNode value = node.get(fieldName);
        if (value == null || value.isNull()) {
            ArrayNode empty = objectMapper.createArrayNode();
            node.set(fieldName, empty);
            if (!allowEmpty) {
                throw badRequest(fieldName + " must be non-empty array", Map.of("path", path));
            }
            return empty;
        }
        if (!value.isArray()) {
            throw badRequest(fieldName + " must be array", Map.of("path", path));
        }
        ArrayNode array = (ArrayNode) value;
        if (!allowEmpty && array.isEmpty()) {
            throw badRequest(fieldName + " must be non-empty array", Map.of("path", path));
        }
        for (int i = 0; i < array.size(); i++) {
            JsonNode item = array.get(i);
            if (!item.canConvertToInt()) {
                throw badRequest(fieldName + " must contain integers", Map.of("path", path + "/" + i));
            }
            int typeId = item.asInt();
            if (readStore.loadType(gameId, typeId) == null) {
                throw semantic(fieldName + " contains unknown typeId", Map.of("path", path + "/" + i, "typeId", typeId));
            }
        }
        return array;
    }

    private void validateOptionalObject(ObjectNode node, String resourceName, String fieldName, String path) {
        JsonNode value = node.get(fieldName);
        if (value != null && !value.isNull() && !value.isObject()) {
            throw badRequest(resourceName + "." + fieldName + " must be object", Map.of("path", path));
        }
    }

    private void validateOptionalText(ObjectNode node, String fieldName, String path) {
        JsonNode value = node.get(fieldName);
        if (value != null && !value.isNull() && !value.isTextual()) {
            throw badRequest(fieldName + " must be string", Map.of("path", path));
        }
    }

    private void validateOptionalObjectForPublish(ObjectNode node, String resourceName, String fieldName, String path) {
        JsonNode value = node.get(fieldName);
        if (value != null && !value.isNull() && !value.isObject()) {
            throw semantic(resourceName + "." + fieldName + " must be object", Map.of("path", path));
        }
    }

    private ArrayNode validateAndNormalizeItemStatModifiersForWrite(String gameId, ObjectNode item) {
        ArrayNode normalized = objectMapper.createArrayNode();
        JsonNode statModifiers = item.get("statModifiers");
        if (statModifiers == null || statModifiers.isNull()) {
            item.set("statModifiers", normalized);
            return normalized;
        }
        if (!statModifiers.isArray()) {
            throw badRequest("item.statModifiers must be array", Map.of("path", "/statModifiers"));
        }
        Set<String> seenAttrKeys = new HashSet<>();
        for (int i = 0; i < statModifiers.size(); i++) {
            JsonNode node = statModifiers.get(i);
            if (node == null || !node.isObject()) {
                throw badRequest("item.statModifiers must contain objects", Map.of("path", "/statModifiers/" + i));
            }
            JsonNode attrKeyNode = node.get("attrKey");
            if (attrKeyNode == null || !attrKeyNode.isTextual() || attrKeyNode.asText().isBlank()) {
                throw badRequest("item.statModifier.attrKey is required", Map.of("path", "/statModifiers/" + i + "/attrKey"));
            }
            String attrKey = attrKeyNode.asText();
            if (!seenAttrKeys.add(attrKey)) {
                throw badRequest("item.statModifier.attrKey duplicated", Map.of("path", "/statModifiers/" + i + "/attrKey", "attrKey", attrKey));
            }
            if (readStore.loadAttributeDefinition(gameId, attrKey) == null) {
                throw semantic("item.statModifier.attrKey not found", Map.of("path", "/statModifiers/" + i + "/attrKey", "attrKey", attrKey));
            }
            JsonNode valueNode = node.get("value");
            if (valueNode == null || !valueNode.isNumber()) {
                throw badRequest("item.statModifier.value must be number", Map.of("path", "/statModifiers/" + i + "/value"));
            }
            ObjectNode normalizedModifier = objectMapper.createObjectNode();
            normalizedModifier.put("attrKey", attrKey);
            normalizedModifier.put("value", valueNode.decimalValue());
            normalized.add(normalizedModifier);
        }
        item.set("statModifiers", normalized);
        return normalized;
    }

    private void validateItemRefs(String gameId, ObjectNode item) {
        if (item.has("skillRefs") && !item.path("skillRefs").isNull()) {
            if (!item.path("skillRefs").isArray()) {
                throw badRequest("item.skillRefs must be array", Map.of("path", "/skillRefs"));
            }
            for (int i = 0; i < item.path("skillRefs").size(); i++) {
                JsonNode node = item.path("skillRefs").get(i);
                if (!node.isTextual()) {
                    throw badRequest("item.skillRefs must contain string", Map.of("path", "/skillRefs/" + i));
                }
                if (readStore.loadSkill(gameId, node.asText()) == null) {
                    throw semantic("item.skillRefs reference not found", Map.of("path", "/skillRefs/" + i, "skillId", node.asText()));
                }
            }
        }
        if (item.has("recipeIds") && !item.path("recipeIds").isNull()) {
            if (!item.path("recipeIds").isArray()) {
                throw badRequest("item.recipeIds must be array", Map.of("path", "/recipeIds"));
            }
            String itemId = item.path("itemId").asText();
            for (int i = 0; i < item.path("recipeIds").size(); i++) {
                JsonNode node = item.path("recipeIds").get(i);
                if (!node.isTextual()) {
                    throw badRequest("item.recipeIds must contain string", Map.of("path", "/recipeIds/" + i));
                }
                String refId = node.asText();
                if (!refId.equals(itemId) && readStore.loadItem(gameId, refId) == null) {
                    throw semantic("item.recipeIds reference not found", Map.of("path", "/recipeIds/" + i, "itemId", refId));
                }
            }
        }
    }

    private void validateTypeRelationTarget(String gameId, ObjectNode relation) {
        int typeId = relation.path("typeId").asInt(Integer.MIN_VALUE);
        if (typeId == Integer.MIN_VALUE || readStore.loadType(gameId, typeId) == null) {
            throw semantic("typeRelation.typeId not found", Map.of("path", "/typeId", "typeId", typeId));
        }
        String targetCategory = relation.path("targetCategory").asText("").toLowerCase(Locale.ROOT);
        String targetId = relation.path("targetId").asText();
        validateTypeRelationTargetRef(gameId, targetCategory, targetId, "/targetId");
    }

    private void validateTypeRelationTargetRef(String gameId, String targetCategory, String targetId, String targetPath) {
        if (!TARGET_CATEGORIES.contains(targetCategory)) {
            throw badRequest("typeRelation.targetCategory invalid", Map.of("path", "/targetCategory"));
        }
        boolean found = switch (targetCategory) {
            case "equipment" -> readStore.loadItem(gameId, targetId) != null;
            case "attribute" -> readStore.loadAttributeDefinition(gameId, targetId) != null;
            case "skill" -> readStore.loadSkill(gameId, targetId) != null;
            case "character" -> readStore.loadHero(gameId, targetId) != null;
            case "type" -> readStore.loadType(gameId, parseTypeId(targetId)) != null;
            default -> false;
        };
        if (!found) {
            throw semantic("typeRelation target not found", Map.of("path", targetPath, "targetCategory", targetCategory, "targetId", targetId));
        }
    }

    private void validateFormulaBindingTarget(String gameId, ObjectNode binding) {
        String targetCategory = binding.path("targetCategory").asText("").toLowerCase(Locale.ROOT);
        if (!FORMULA_BINDING_TARGET_CATEGORIES.contains(targetCategory)) {
            throw badRequest("formulaBinding.targetCategory invalid", Map.of("path", "/targetCategory"));
        }
        String targetId = binding.path("targetId").asText();
        boolean found = switch (targetCategory) {
            case "skill" -> readStore.loadSkill(gameId, targetId) != null;
            case "hero" -> readStore.loadHero(gameId, targetId) != null;
            case "item" -> readStore.loadItem(gameId, targetId) != null;
            case "global" -> true;
            default -> false;
        };
        if (!found) {
            throw semantic(
                "formulaBinding target not found",
                Map.of("path", "/targetId", "targetCategory", targetCategory, "targetId", targetId)
            );
        }
    }

    private boolean targetExistsForFormulaBinding(
        String targetCategory,
        String targetId,
        Set<String> skillIds,
        Set<String> heroIds,
        Set<String> itemIds
    ) {
        return switch (targetCategory) {
            case "skill" -> skillIds.contains(targetId);
            case "hero" -> heroIds.contains(targetId);
            case "item" -> itemIds.contains(targetId);
            case "global" -> true;
            default -> false;
        };
    }

    private int parseTypeId(String raw) {
        try {
            return Integer.parseInt(raw);
        } catch (NumberFormatException ex) {
            throw semantic("typeRelation targetId must be numeric for category type", Map.of("targetId", raw));
        }
    }

    private ObjectNode mergeUpsert(ObjectNode body, String idField, String resourceId) {
        if (body == null || body.isEmpty()) {
            throw badRequest("Request body cannot be empty", Map.of("path", "/", "reason", "empty body"));
        }
        ObjectNode merged = objectMapper.createObjectNode();
        mergeObject(merged, body);
        merged.put(idField, resourceId);
        return merged;
    }

    private void mergeObject(ObjectNode target, ObjectNode patch) {
        Iterator<Map.Entry<String, JsonNode>> it = patch.fields();
        while (it.hasNext()) {
            Map.Entry<String, JsonNode> entry = it.next();
            JsonNode current = target.get(entry.getKey());
            if (current != null && current.isObject() && entry.getValue().isObject()) {
                mergeObject((ObjectNode) current, (ObjectNode) entry.getValue());
            } else {
                target.set(entry.getKey(), entry.getValue().deepCopy());
            }
        }
    }

    private long resolveVersionIdForWrite(String gameId) {
        ensureGamePartitions(gameId);
        PostgresReadStore.VersionRecord workspaceVersion = readStore.findVersionByCode(gameId, WORKSPACE_VERSION_CODE);
        if (workspaceVersion != null) {
            return workspaceVersion.versionId();
        }
        try {
            Long workspaceVersionId = gameVersionsMapper.createVersion(gameId, WORKSPACE_VERSION_CODE, null);
            if (workspaceVersionId != null) {
                return workspaceVersionId;
            }
        } catch (DataIntegrityViolationException ex) {
            PostgresReadStore.VersionRecord existingWorkspace = readStore.findVersionByCode(gameId, WORKSPACE_VERSION_CODE);
            if (existingWorkspace != null) {
                return existingWorkspace.versionId();
            }
        }
        throw semantic("No workspace version available for write.", Map.of("gameId", gameId));
    }

    private void ensureGamePartitions(String gameId) {
        if (!ensuredPartitionGames.add(gameId)) {
            return;
        }
        try {
            gamesMapper.ensureGamePartitions(gameId);
        } catch (RuntimeException ex) {
            ensuredPartitionGames.remove(gameId);
            throw ex;
        }
    }

    private boolean ownerTypeExists(String gameId, String ownerType) {
        Long count = ownerCategoriesMapper.countOwnerCategory(gameId, ownerType);
        return count != null && count > 0;
    }

    private String serializeBundle(ObjectNode bundle) {
        try {
            return objectMapper.writeValueAsString(bundle);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Unable to serialize bundle snapshot", ex);
        }
    }

    private String mapText(Map<String, Object> row, String key) {
        Object value = mapValue(row, key);
        return value == null ? null : value.toString();
    }

    private Integer mapInteger(Map<String, Object> row, String key) {
        Object value = mapValue(row, key);
        if (value == null) {
            return null;
        }
        if (value instanceof Number number) {
            return number.intValue();
        }
        return Integer.parseInt(value.toString());
    }

    private BigDecimal mapBigDecimal(Map<String, Object> row, String key) {
        Object value = mapValue(row, key);
        if (value == null) {
            return null;
        }
        if (value instanceof BigDecimal decimal) {
            return decimal;
        }
        if (value instanceof Number number) {
            return new BigDecimal(number.toString());
        }
        return new BigDecimal(value.toString());
    }

    private Boolean mapBoolean(Map<String, Object> row, String key) {
        Object value = mapValue(row, key);
        if (value == null) {
            return null;
        }
        if (value instanceof Boolean bool) {
            return bool;
        }
        return Boolean.parseBoolean(value.toString());
    }

    private Object mapValue(Map<String, Object> row, String key) {
        if (row.containsKey(key)) {
            return row.get(key);
        }
        String lowerKey = key.toLowerCase(Locale.ROOT);
        if (row.containsKey(lowerKey)) {
            return row.get(lowerKey);
        }
        String snakeKey = camelToSnake(key);
        if (row.containsKey(snakeKey)) {
            return row.get(snakeKey);
        }
        for (Map.Entry<String, Object> entry : row.entrySet()) {
            if (entry.getKey().equalsIgnoreCase(key)) {
                return entry.getValue();
            }
        }
        return null;
    }

    private String camelToSnake(String key) {
        StringBuilder builder = new StringBuilder(key.length() + 4);
        for (int i = 0; i < key.length(); i++) {
            char ch = key.charAt(i);
            if (Character.isUpperCase(ch)) {
                if (i > 0) {
                    builder.append('_');
                }
                builder.append(Character.toLowerCase(ch));
            } else {
                builder.append(ch);
            }
        }
        return builder.toString();
    }

    private String requireTextField(ObjectNode body, String fieldName, String path) {
        JsonNode value = body.get(fieldName);
        if (value == null || !value.isTextual() || value.asText().isBlank()) {
            throw badRequest("progressionSchema." + fieldName + " must be non-empty string", Map.of("path", path));
        }
        return value.asText();
    }

    private int requireIntegerField(ObjectNode body, String fieldName, String path) {
        JsonNode value = body.get(fieldName);
        if (value == null || !value.canConvertToInt()) {
            throw badRequest("progressionSchema." + fieldName + " must be integer", Map.of("path", path));
        }
        return value.asInt();
    }

    private String nullableText(ObjectNode node, String fieldName) {
        if (!node.has(fieldName) || node.get(fieldName).isNull()) {
            return null;
        }
        return node.get(fieldName).isTextual() ? node.get(fieldName).asText() : node.get(fieldName).toString();
    }

    private Integer nullableInteger(ObjectNode node, String fieldName) {
        if (!node.has(fieldName) || node.get(fieldName).isNull()) {
            return null;
        }
        if (!node.get(fieldName).isIntegralNumber()) {
            throw badRequest(fieldName + " must be integer", Map.of("path", "/" + fieldName));
        }
        return node.get(fieldName).asInt();
    }

    private Boolean nullableBoolean(ObjectNode node, String fieldName) {
        if (!node.has(fieldName) || node.get(fieldName).isNull()) {
            return null;
        }
        if (!node.get(fieldName).isBoolean()) {
            throw badRequest(fieldName + " must be boolean", Map.of("path", "/" + fieldName));
        }
        return node.get(fieldName).asBoolean();
    }

    private BigDecimal nullableBigDecimal(ObjectNode node, String fieldName) {
        if (!node.has(fieldName) || node.get(fieldName).isNull()) {
            return null;
        }
        if (!node.get(fieldName).isNumber()) {
            throw badRequest(fieldName + " must be number", Map.of("path", "/" + fieldName));
        }
        return node.get(fieldName).decimalValue();
    }

    private BigDecimal nullableAttributeDefinitionBigDecimal(
        ObjectNode node,
        String fieldName,
        String path,
        boolean forPublish
    ) {
        if (!node.has(fieldName) || node.get(fieldName).isNull()) {
            return null;
        }
        if (!node.get(fieldName).isNumber()) {
            String message = "attributeDefinition." + fieldName + " must be number";
            throw forPublish ? semantic(message, Map.of("path", path)) : badRequest(message, Map.of("path", path));
        }
        return node.get(fieldName).decimalValue();
    }

    private ApiException badRequest(String message, Map<String, Object> details) {
        return new ApiException(HttpStatus.BAD_REQUEST, "400.INVALID_BODY", message, details);
    }

    private ApiException semantic(String message, Map<String, Object> details) {
        return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "422.SEMANTIC_ERROR", message, details);
    }

    private ApiException notFound(String message, Map<String, Object> details) {
        return new ApiException(HttpStatus.NOT_FOUND, "404.NOT_FOUND", message, details);
    }

    private ApiException conflict(String message, Map<String, Object> details) {
        return new ApiException(HttpStatus.CONFLICT, "409.CONFLICT", message, details);
    }
}
