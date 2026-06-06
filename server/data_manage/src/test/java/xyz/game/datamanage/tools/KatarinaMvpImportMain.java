package xyz.game.datamanage.tools;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.PrintStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

public final class KatarinaMvpImportMain {

    static final String ADMIN_TOKEN_ENV = "DV_ADMIN_JWT";
    static final String DEFAULT_API_BASE_URL = "http://localhost:8080";
    private static final String DEFAULT_SEED_DIR = "\u6700\u5c0f\u9a8c\u8bc1";
    private static final String DEFAULT_SEED_FILE = "\u5361\u7279\u7433\u5a1c-MVP\u79cd\u5b50\u6570\u636e.json";

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
    private static final Pattern GAME_ID_PATTERN = Pattern.compile("^[a-z0-9_]+$");

    private KatarinaMvpImportMain() {
    }

    public static void main(String[] args) throws Exception {
        ImportOptions options = parseArgs(args);
        run(options, System.out);
    }

    static ImportOptions parseArgs(String[] args) {
        String apiBaseUrl = DEFAULT_API_BASE_URL;
        String seedFile = null;
        String gameId = null;
        String gameName = null;
        String versionCode = null;
        String adminToken = null;
        String dbUrl = null;
        String dbUsername = null;
        String dbPassword = null;
        boolean publish = true;
        boolean bootstrapDb = false;
        boolean dryRun = false;

        for (String arg : args) {
            if ("--bootstrapDb".equals(arg)) {
                bootstrapDb = true;
                continue;
            }
            if ("--dryRun".equals(arg)) {
                dryRun = true;
                continue;
            }
            if ("--skipPublish".equals(arg)) {
                publish = false;
                continue;
            }
            if (arg.startsWith("--apiBaseUrl=")) {
                apiBaseUrl = readValue(arg, "--apiBaseUrl");
                continue;
            }
            if (arg.startsWith("--seedFile=")) {
                seedFile = readValue(arg, "--seedFile");
                continue;
            }
            if (arg.startsWith("--gameId=")) {
                gameId = readValue(arg, "--gameId");
                continue;
            }
            if (arg.startsWith("--gameName=")) {
                gameName = readValue(arg, "--gameName");
                continue;
            }
            if (arg.startsWith("--versionCode=")) {
                versionCode = readValue(arg, "--versionCode");
                continue;
            }
            if (arg.startsWith("--adminToken=")) {
                adminToken = readValue(arg, "--adminToken");
                continue;
            }
            if (arg.startsWith("--dbUrl=")) {
                dbUrl = readValue(arg, "--dbUrl");
                continue;
            }
            if (arg.startsWith("--dbUsername=")) {
                dbUsername = readValue(arg, "--dbUsername");
                continue;
            }
            if (arg.startsWith("--dbPassword=")) {
                dbPassword = readValue(arg, "--dbPassword");
                continue;
            }
            throw new IllegalArgumentException("Unknown argument: " + arg);
        }

        return new ImportOptions(
            apiBaseUrl,
            seedFile,
            gameId,
            gameName,
            versionCode,
            adminToken,
            publish,
            bootstrapDb,
            dryRun,
            dbUrl,
            dbUsername,
            dbPassword
        );
    }

    static void run(ImportOptions options, PrintStream out) throws Exception {
        Path seedFile = resolveSeedFile(options.seedFile());
        SeedData seedData = loadSeed(seedFile);
        String gameId = options.gameId() == null || options.gameId().isBlank() ? seedData.gameId() : options.gameId().trim();
        String versionCode = options.versionCode() == null || options.versionCode().isBlank()
            ? seedData.versionCode()
            : options.versionCode().trim();
        String gameName = options.gameName() == null || options.gameName().isBlank()
            ? defaultGameName(gameId)
            : options.gameName().trim();
        String adminToken = resolveAdminToken(options.adminToken());

        validateGameId(gameId);

        out.println("Katarina MVP import plan:");
        out.println("  apiBaseUrl  = " + options.apiBaseUrl());
        out.println("  seedFile    = " + seedFile);
        out.println("  gameId      = " + gameId);
        out.println("  versionCode = " + versionCode);
        out.println("  publish     = " + options.publish());
        out.println("  bootstrapDb = " + options.bootstrapDb());
        out.println("  dryRun      = " + options.dryRun());
        out.println("  authMode    = " + (adminToken == null ? "disabled/no-token" : "bearer-token"));
        out.println("  ownerTypes  = " + seedData.ownerCategories().size());
        out.println("  attributes  = " + seedData.attributeDefinitions().size());
        out.println("  types       = " + seedData.types().size());
        out.println("  heroes      = " + seedData.heroes().size());
        out.println("  skills      = " + seedData.skills().size());
        out.println("  items       = " + seedData.items().size());
        out.println("  formulas    = " + seedData.formulaProfiles().size());
        out.println("  formulaBind = " + seedData.formulaBindings().size());
        out.println("  statuses    = " + seedData.statusDefinitions().size());
        out.println("  statusGroups= " + seedData.statusModifierGroups().size());
        out.println("  statusHpFx  = " + seedData.statusPeriodicHpEffects().size());
        out.println("  typeRels    = " + seedData.typeRelations().size());
        out.println("  scenarios   = " + seedData.scenarios().size() + " (web/runtime only; not imported)");

        if (options.dryRun()) {
            out.println("DRY-RUN mode enabled. No HTTP or DB write executed.");
            return;
        }

        HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

        if (options.bootstrapDb()) {
            DbOptions dbOptions = resolveDbOptions(options);
            ensureGameBootstrap(dbOptions, gameId, gameName, seedData.ownerCategories());
            out.println("Bootstrap ensured for gameId=" + gameId);
        } else {
            ensureOwnerCategoriesReady(httpClient, options.apiBaseUrl(), gameId, seedData.ownerCategories());
            out.println("Owner category precheck passed for gameId=" + gameId);
        }

        upsert(httpClient, options.apiBaseUrl(), adminToken, gameId, "/attribute-definitions/", "attrKey", seedData.attributeDefinitions());
        upsert(httpClient, options.apiBaseUrl(), adminToken, gameId, "/types/", "typeId", seedData.types());
        upsert(httpClient, options.apiBaseUrl(), adminToken, gameId, "/formula-profiles/", "formulaId", seedData.formulaProfiles());
        upsertFormulaBindings(httpClient, options.apiBaseUrl(), adminToken, gameId, seedData.formulaBindings());
        upsert(httpClient, options.apiBaseUrl(), adminToken, gameId, "/control-state-profiles/", "controlProfileId", seedData.controlStateProfiles());
        upsert(httpClient, options.apiBaseUrl(), adminToken, gameId, "/status-definitions/", "statusId", seedData.statusDefinitions());
        upsertStatusModifierGroups(httpClient, options.apiBaseUrl(), adminToken, gameId, seedData.statusModifierGroups());
        upsertStatusAttributeModifiers(httpClient, options.apiBaseUrl(), adminToken, gameId, seedData.statusAttributeModifiers());
        upsertStatusPeriodicHpEffects(httpClient, options.apiBaseUrl(), adminToken, gameId, seedData.statusPeriodicHpEffects());
        upsert(httpClient, options.apiBaseUrl(), adminToken, gameId, "/heroes/", "heroId", seedData.heroes());
        upsert(httpClient, options.apiBaseUrl(), adminToken, gameId, "/skills/", "skillId", seedData.skills());
        upsert(httpClient, options.apiBaseUrl(), adminToken, gameId, "/items/", "itemId", seedData.items());
        upsertTypeRelations(httpClient, options.apiBaseUrl(), adminToken, gameId, seedData.typeRelations());

        if (!options.publish()) {
            out.println("Import finished without publish.");
            return;
        }

        JsonNode publishResponse = requestJsonAllowingExistingVersion(
            httpClient,
            buildUri(options.apiBaseUrl(), "/api/admin/games/" + encodeSegment(gameId) + "/versions:publish"),
            "POST",
            adminToken,
            OBJECT_MAPPER.createObjectNode().put("versionCode", versionCode)
        );
        if (publishResponse.isMissingNode()) {
            out.println("Publish skipped because versionCode already exists; verifying existing current + bundle.");
        } else {
            out.println("Published versionCode=" + publishResponse.path("versionCode").asText(versionCode));
        }

        JsonNode currentResponse = requestJson(
            httpClient,
            buildUri(options.apiBaseUrl(), "/api/games/" + encodeSegment(gameId) + "/versions/current"),
            "GET",
            null,
            null
        );
        JsonNode bundleResponse = requestJson(
            httpClient,
            buildUri(options.apiBaseUrl(), "/api/games/" + encodeSegment(gameId) + "/versions/" + encodeSegment(versionCode) + "/bundle"),
            "GET",
            null,
            null
        );

        verifyPublishedResult(currentResponse, bundleResponse, versionCode, seedData);
        out.println("Verified current + bundle for versionCode=" + versionCode);
    }

    static Path resolveSeedFile(String rawSeedFile) {
        if (rawSeedFile != null && !rawSeedFile.isBlank()) {
            Path explicit = Path.of(rawSeedFile).toAbsolutePath().normalize();
            if (!Files.isRegularFile(explicit)) {
                throw new IllegalArgumentException("Seed file not found: " + explicit);
            }
            return explicit;
        }

        List<Path> candidates = List.of(
            Path.of(DEFAULT_SEED_DIR, DEFAULT_SEED_FILE),
            Path.of("..", DEFAULT_SEED_DIR, DEFAULT_SEED_FILE),
            Path.of("..", "..", DEFAULT_SEED_DIR, DEFAULT_SEED_FILE)
        );
        for (Path candidate : candidates) {
            Path resolved = candidate.toAbsolutePath().normalize();
            if (Files.isRegularFile(resolved)) {
                return resolved;
            }
        }
        throw new IllegalArgumentException("Unable to locate default seed file: " + DEFAULT_SEED_DIR + "/" + DEFAULT_SEED_FILE);
    }

    static SeedData loadSeed(Path seedFile) throws IOException {
        JsonNode root = OBJECT_MAPPER.readTree(Files.newBufferedReader(seedFile, StandardCharsets.UTF_8));
        return new SeedData(
            requireText(root, "gameId"),
            requireText(root, "versionCode"),
            readObjectArray(root, "ownerCategories"),
            readObjectArray(root, "attributeDefinitions"),
            readOptionalObjectArray(root, "types"),
            readOptionalObjectArray(root, "formulaProfiles"),
            readOptionalObjectArray(root, "formulaBindings"),
            readOptionalObjectArray(root, "controlStateProfiles"),
            readOptionalObjectArray(root, "statusDefinitions"),
            readOptionalObjectArray(root, "statusModifierGroups"),
            readOptionalObjectArray(root, "statusAttributeModifiers"),
            readOptionalObjectArray(root, "statusPeriodicHpEffects"),
            readObjectArray(root, "heroes"),
            readObjectArray(root, "skills"),
            readObjectArray(root, "items"),
            readOptionalObjectArray(root, "typeRelations"),
            readObjectArray(root, "scenarios")
        );
    }

    private static void ensureGameBootstrap(
        DbOptions dbOptions,
        String gameId,
        String gameName,
        List<ObjectNode> ownerCategories
    ) throws SQLException {
        try (Connection connection = DriverManager.getConnection(dbOptions.dbUrl(), dbOptions.dbUsername(), dbOptions.dbPassword())) {
            connection.setAutoCommit(false);
            try {
                try (PreparedStatement gameStatement = connection.prepareStatement(
                    "INSERT INTO public.games (game_id, game_name, game_img_url) VALUES (?, ?, ?) "
                        + "ON CONFLICT (game_id) DO NOTHING"
                )) {
                    gameStatement.setString(1, gameId);
                    gameStatement.setString(2, gameName);
                    gameStatement.setString(3, null);
                    gameStatement.executeUpdate();
                }

                try (PreparedStatement ownerCategoryStatement = connection.prepareStatement(
                    "INSERT INTO public.owner_categories (game_id, owner_type, name, description) VALUES (?, ?, ?, ?) "
                        + "ON CONFLICT (game_id, owner_type) DO UPDATE SET "
                        + "name = EXCLUDED.name, description = EXCLUDED.description"
                )) {
                    for (ObjectNode ownerCategory : ownerCategories) {
                        ownerCategoryStatement.setString(1, gameId);
                        ownerCategoryStatement.setString(2, requireText(ownerCategory, "ownerType"));
                        ownerCategoryStatement.setString(3, nullableText(ownerCategory, "name"));
                        ownerCategoryStatement.setString(
                            4,
                            firstNonBlank(nullableText(ownerCategory, "description"), "Seeded by KatarinaMvpImportMain")
                        );
                        ownerCategoryStatement.addBatch();
                    }
                    ownerCategoryStatement.executeBatch();
                }

                try (PreparedStatement partitionStatement = connection.prepareStatement(
                    "SELECT public.ensure_game_partitions(?)"
                )) {
                    partitionStatement.setString(1, gameId);
                    partitionStatement.execute();
                }
                connection.commit();
            } catch (SQLException ex) {
                connection.rollback();
                throw ex;
            }
        }
    }

    private static void ensureOwnerCategoriesReady(
        HttpClient httpClient,
        String apiBaseUrl,
        String gameId,
        List<ObjectNode> ownerCategories
    ) throws Exception {
        JsonNode response;
        try {
            response = requestJson(
                httpClient,
                buildUri(apiBaseUrl, "/api/games/" + encodeSegment(gameId) + "/owner-categories"),
                "GET",
                null,
                null
            );
        } catch (IllegalStateException ex) {
            throw new IllegalStateException(
                "Unable to confirm game bootstrap for gameId=" + gameId
                    + ". Seed public.games/public.owner_categories first or rerun with --bootstrapDb. "
                    + ex.getMessage(),
                ex
            );
        }

        JsonNode ownerCategoryArray = response.path("ownerCategories");
        if (!ownerCategoryArray.isArray()) {
            throw new IllegalStateException("Public owner category response missing `ownerCategories` array");
        }

        Set<String> existingOwnerTypes = new LinkedHashSet<>();
        for (JsonNode ownerCategory : ownerCategoryArray) {
            String ownerType = nullableText(ownerCategory, "ownerType");
            if (ownerType != null) {
                existingOwnerTypes.add(ownerType);
            }
        }

        Set<String> missingOwnerTypes = new LinkedHashSet<>();
        for (ObjectNode ownerCategory : ownerCategories) {
            String ownerType = requireText(ownerCategory, "ownerType");
            if (!existingOwnerTypes.contains(ownerType)) {
                missingOwnerTypes.add(ownerType);
            }
        }
        if (!missingOwnerTypes.isEmpty()) {
            throw new IllegalStateException(
                "Missing owner categories for gameId=" + gameId + ": " + missingOwnerTypes
                    + ". Seed them first or rerun with --bootstrapDb."
            );
        }
    }

    private static void upsert(
        HttpClient httpClient,
        String apiBaseUrl,
        String adminToken,
        String gameId,
        String pathPrefix,
        String idField,
        List<ObjectNode> entities
    ) throws Exception {
        for (ObjectNode entity : entities) {
            String entityId = requireIdSegment(entity, idField);
            requestJson(
                httpClient,
                buildUri(apiBaseUrl, "/api/admin/games/" + encodeSegment(gameId) + pathPrefix + encodeSegment(entityId)),
                "PUT",
                adminToken,
                entity
            );
        }
    }

    private static void upsertFormulaBindings(
        HttpClient httpClient,
        String apiBaseUrl,
        String adminToken,
        String gameId,
        List<ObjectNode> bindings
    ) throws Exception {
        for (ObjectNode binding : bindings) {
            String targetCategory = requireText(binding, "targetCategory");
            String targetId = requireText(binding, "targetId");
            String bindingKey = requireText(binding, "bindingKey");
            requestJson(
                httpClient,
                buildUri(
                    apiBaseUrl,
                    "/api/admin/games/" + encodeSegment(gameId)
                        + "/formula-bindings/" + encodeSegment(targetCategory)
                        + "/" + encodeSegment(targetId)
                        + "/" + encodeSegment(bindingKey)
                ),
                "PUT",
                adminToken,
                binding
            );
        }
    }

    private static void upsertStatusModifierGroups(
        HttpClient httpClient,
        String apiBaseUrl,
        String adminToken,
        String gameId,
        List<ObjectNode> groups
    ) throws Exception {
        for (ObjectNode group : groups) {
            String statusId = requireIdSegment(group, "statusId");
            String groupKey = requireIdSegment(group, "groupKey");
            requestJson(
                httpClient,
                buildUri(
                    apiBaseUrl,
                    "/api/admin/games/" + encodeSegment(gameId)
                        + "/status-modifier-groups/" + encodeSegment(statusId)
                        + "/" + encodeSegment(groupKey)
                ),
                "PUT",
                adminToken,
                group
            );
        }
    }

    private static void upsertStatusAttributeModifiers(
        HttpClient httpClient,
        String apiBaseUrl,
        String adminToken,
        String gameId,
        List<ObjectNode> modifiers
    ) throws Exception {
        for (ObjectNode modifier : modifiers) {
            String statusId = requireIdSegment(modifier, "statusId");
            String groupKey = requireIdSegment(modifier, "groupKey");
            String modifierId = requireIdSegment(modifier, "modifierId");
            requestJson(
                httpClient,
                buildUri(
                    apiBaseUrl,
                    "/api/admin/games/" + encodeSegment(gameId)
                        + "/status-attribute-modifiers/" + encodeSegment(statusId)
                        + "/" + encodeSegment(groupKey)
                        + "/" + encodeSegment(modifierId)
                ),
                "PUT",
                adminToken,
                modifier
            );
        }
    }

    private static void upsertStatusPeriodicHpEffects(
        HttpClient httpClient,
        String apiBaseUrl,
        String adminToken,
        String gameId,
        List<ObjectNode> effects
    ) throws Exception {
        for (ObjectNode effect : effects) {
            String statusId = requireIdSegment(effect, "statusId");
            String groupKey = requireIdSegment(effect, "groupKey");
            String effectId = requireIdSegment(effect, "effectId");
            requestJson(
                httpClient,
                buildUri(
                    apiBaseUrl,
                    "/api/admin/games/" + encodeSegment(gameId)
                        + "/status-periodic-hp-effects/" + encodeSegment(statusId)
                        + "/" + encodeSegment(groupKey)
                        + "/" + encodeSegment(effectId)
                ),
                "PUT",
                adminToken,
                effect
            );
        }
    }

    private static void upsertTypeRelations(
        HttpClient httpClient,
        String apiBaseUrl,
        String adminToken,
        String gameId,
        List<ObjectNode> relations
    ) throws Exception {
        for (ObjectNode relation : relations) {
            String typeId = requireIdSegment(relation, "typeId");
            String targetCategory = requireText(relation, "targetCategory");
            String targetId = requireText(relation, "targetId");
            requestJson(
                httpClient,
                buildUri(
                    apiBaseUrl,
                    "/api/admin/games/" + encodeSegment(gameId)
                        + "/type-relations/" + encodeSegment(typeId)
                        + "/" + encodeSegment(targetCategory)
                        + "/" + encodeSegment(targetId)
                ),
                "PUT",
                adminToken,
                relation
            );
        }
    }

    static void verifyPublishedResult(
        JsonNode currentResponse,
        JsonNode bundleResponse,
        String expectedVersionCode,
        SeedData seedData
    ) {
        if (!expectedVersionCode.equals(currentResponse.path("versionCode").asText(""))) {
            throw new IllegalStateException("current.versionCode mismatch");
        }
        if (!expectedVersionCode.equals(bundleResponse.path("meta").path("versionCode").asText(""))) {
            throw new IllegalStateException("bundle.meta.versionCode mismatch");
        }
        verifyEntitiesPresent(bundleResponse.path("attributeDefinitions"), seedData.attributeDefinitions(), "attributeDefinitions", "attrKey");
        verifyEntitiesPresent(bundleResponse.path("types"), seedData.types(), "types", "typeId");
        verifyEntitiesPresent(bundleResponse.path("heroes"), seedData.heroes(), "heroes", "heroId");
        verifyEntitiesPresent(bundleResponse.path("skills"), seedData.skills(), "skills", "skillId");
        verifyEntitiesPresent(bundleResponse.path("items"), seedData.items(), "items", "itemId");
        verifyEntitiesPresent(bundleResponse.path("formulaProfiles"), seedData.formulaProfiles(), "formulaProfiles", "formulaId");
        verifyFormulaBindingsPresent(bundleResponse.path("formulaBindings"), seedData.formulaBindings());
        verifyEntitiesPresent(
            bundleResponse.path("statusDefinitions"),
            seedData.statusDefinitions(),
            "statusDefinitions",
            "statusId"
        );
        verifyStatusModifierGroupsPresent(bundleResponse.path("statusModifierGroups"), seedData.statusModifierGroups());
        verifyEntitiesPresent(
            bundleResponse.path("statusPeriodicHpEffects"),
            seedData.statusPeriodicHpEffects(),
            "statusPeriodicHpEffects",
            "effectId"
        );
        verifyTypeRelationsPresent(bundleResponse.path("typeRelations"), seedData.typeRelations());
        verifyDpsPassiveEffectsPassthrough(bundleResponse.path("skills"), seedData.skills());
        verifyItemSkillRefsPassthrough(bundleResponse.path("items"), seedData.items());
    }

    private static void verifyDpsPassiveEffectsPassthrough(JsonNode bundleSkills, List<ObjectNode> seedSkills) {
        if (!bundleSkills.isArray()) {
            throw new IllegalStateException("bundle field `skills` is not array");
        }
        for (ObjectNode seedSkill : seedSkills) {
            JsonNode seedDpsPassiveEffects = seedSkill.path("mechanicsConfig").path("dpsPassiveEffects");
            if (!seedDpsPassiveEffects.isArray() || seedDpsPassiveEffects.isEmpty()) {
                continue;
            }
            String skillId = requireIdSegment(seedSkill, "skillId");
            JsonNode publishedSkill = findPublishedEntity(bundleSkills, "skillId", skillId, "skills");
            JsonNode publishedDpsPassiveEffects = publishedSkill.path("mechanicsConfig").path("dpsPassiveEffects");
            if (!seedDpsPassiveEffects.equals(publishedDpsPassiveEffects)) {
                throw new IllegalStateException(
                    "bundle field `skills` entity `" + skillId + "` mechanicsConfig.dpsPassiveEffects mismatch"
                );
            }
        }
    }

    private static void verifyItemSkillRefsPassthrough(JsonNode bundleItems, List<ObjectNode> seedItems) {
        if (!bundleItems.isArray()) {
            throw new IllegalStateException("bundle field `items` is not array");
        }
        for (ObjectNode seedItem : seedItems) {
            JsonNode seedSkillRefs = seedItem.get("skillRefs");
            if (seedSkillRefs == null || !seedSkillRefs.isArray()) {
                continue;
            }
            String itemId = requireIdSegment(seedItem, "itemId");
            JsonNode publishedItem = findPublishedEntity(bundleItems, "itemId", itemId, "items");
            JsonNode publishedSkillRefs = publishedItem.path("skillRefs");
            if (!seedSkillRefs.equals(publishedSkillRefs)) {
                throw new IllegalStateException(
                    "bundle field `items` entity `" + itemId + "` skillRefs mismatch"
                );
            }
        }
    }

    private static JsonNode findPublishedEntity(JsonNode arrayNode, String idField, String expectedId, String fieldName) {
        for (JsonNode actual : arrayNode) {
            if (expectedId.equals(actual.path(idField).asText())) {
                return actual;
            }
        }
        throw new IllegalStateException("bundle field `" + fieldName + "` is missing entity `" + expectedId + "`");
    }

    private static void verifyEntitiesPresent(JsonNode arrayNode, List<ObjectNode> expectedEntities, String fieldName, String idField) {
        if (!arrayNode.isArray()) {
            throw new IllegalStateException("bundle field `" + fieldName + "` is not array");
        }
        for (ObjectNode expected : expectedEntities) {
            String expectedId = requireIdSegment(expected, idField);
            if (!containsEntity(arrayNode, idField, expectedId)) {
                throw new IllegalStateException("bundle field `" + fieldName + "` is missing entity `" + expectedId + "`");
            }
        }
    }

    private static void verifyFormulaBindingsPresent(JsonNode arrayNode, List<ObjectNode> expectedBindings) {
        if (!arrayNode.isArray()) {
            throw new IllegalStateException("bundle field `formulaBindings` is not array");
        }
        for (ObjectNode expected : expectedBindings) {
            String expectedTargetCategory = requireText(expected, "targetCategory");
            String expectedTargetId = requireText(expected, "targetId");
            String expectedBindingKey = requireText(expected, "bindingKey");
            boolean found = false;
            for (JsonNode actual : arrayNode) {
                if (expectedTargetCategory.equals(actual.path("targetCategory").asText())
                    && expectedTargetId.equals(actual.path("targetId").asText())
                    && expectedBindingKey.equals(actual.path("bindingKey").asText())) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                throw new IllegalStateException(
                    "bundle field `formulaBindings` is missing binding targetCategory="
                        + expectedTargetCategory
                        + ", targetId="
                        + expectedTargetId
                        + ", bindingKey="
                        + expectedBindingKey
                );
            }
        }
    }

    private static void verifyStatusModifierGroupsPresent(JsonNode arrayNode, List<ObjectNode> expectedGroups) {
        if (!arrayNode.isArray()) {
            throw new IllegalStateException("bundle field `statusModifierGroups` is not array");
        }
        for (ObjectNode expected : expectedGroups) {
            String expectedStatusId = requireIdSegment(expected, "statusId");
            String expectedGroupKey = requireIdSegment(expected, "groupKey");
            boolean found = false;
            for (JsonNode actual : arrayNode) {
                if (expectedStatusId.equals(actual.path("statusId").asText())
                    && expectedGroupKey.equals(actual.path("groupKey").asText())) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                throw new IllegalStateException(
                    "bundle field `statusModifierGroups` is missing statusId="
                        + expectedStatusId
                        + ", groupKey="
                        + expectedGroupKey
                );
            }
        }
    }

    private static void verifyTypeRelationsPresent(JsonNode arrayNode, List<ObjectNode> expectedRelations) {
        if (!arrayNode.isArray()) {
            throw new IllegalStateException("bundle field `typeRelations` is not array");
        }
        for (ObjectNode expected : expectedRelations) {
            String expectedTypeId = requireIdSegment(expected, "typeId");
            String expectedTargetCategory = requireText(expected, "targetCategory");
            String expectedTargetId = requireText(expected, "targetId");
            boolean found = false;
            for (JsonNode actual : arrayNode) {
                if (expectedTypeId.equals(actual.path("typeId").asText())
                    && expectedTargetCategory.equals(actual.path("targetCategory").asText())
                    && expectedTargetId.equals(actual.path("targetId").asText())) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                throw new IllegalStateException(
                    "bundle field `typeRelations` is missing relation typeId=" + expectedTypeId
                        + ", targetCategory=" + expectedTargetCategory + ", targetId=" + expectedTargetId
                );
            }
        }
    }

    private static boolean containsEntity(JsonNode arrayNode, String idField, String expectedId) {
        for (JsonNode actual : arrayNode) {
            if (expectedId.equals(actual.path(idField).asText())) {
                return true;
            }
        }
        return false;
    }

    private static JsonNode requestJson(
        HttpClient httpClient,
        URI uri,
        String method,
        String adminToken,
        JsonNode requestBody
    ) throws IOException, InterruptedException {
        HttpJsonResponse response = sendJson(httpClient, uri, method, adminToken, requestBody);
        if (response.statusCode() / 100 != 2) {
            throw new IllegalStateException(
                "HTTP " + method + " " + uri + " failed: status=" + response.statusCode() + ", body=" + response.body()
            );
        }
        return readResponseJson(response.body());
    }

    private static JsonNode requestJsonAllowingExistingVersion(
        HttpClient httpClient,
        URI uri,
        String method,
        String adminToken,
        JsonNode requestBody
    ) throws IOException, InterruptedException {
        HttpJsonResponse response = sendJson(httpClient, uri, method, adminToken, requestBody);
        if (response.statusCode() == 409 && response.body().contains("\"409.CONFLICT\"")) {
            return OBJECT_MAPPER.missingNode();
        }
        if (response.statusCode() / 100 != 2) {
            throw new IllegalStateException(
                "HTTP " + method + " " + uri + " failed: status=" + response.statusCode() + ", body=" + response.body()
            );
        }
        return readResponseJson(response.body());
    }

    private static HttpJsonResponse sendJson(
        HttpClient httpClient,
        URI uri,
        String method,
        String adminToken,
        JsonNode requestBody
    ) throws IOException, InterruptedException {
        HttpRequest.Builder builder = HttpRequest.newBuilder(uri)
            .timeout(Duration.ofSeconds(30))
            .header("Accept", "application/json");

        if (adminToken != null && !adminToken.isBlank()) {
            builder.header("Authorization", "Bearer " + adminToken);
        }

        if (requestBody == null) {
            builder.method(method, HttpRequest.BodyPublishers.noBody());
        } else {
            builder.header("Content-Type", "application/json");
            builder.method(
                method,
                HttpRequest.BodyPublishers.ofString(OBJECT_MAPPER.writeValueAsString(requestBody), StandardCharsets.UTF_8)
            );
        }

        HttpResponse<String> response = httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        return new HttpJsonResponse(response.statusCode(), response.body() == null ? "" : response.body());
    }

    private static JsonNode readResponseJson(String body) throws IOException {
        if (body == null || body.isBlank()) {
            return OBJECT_MAPPER.createObjectNode();
        }
        return OBJECT_MAPPER.readTree(body);
    }

    private static URI buildUri(String apiBaseUrl, String path) {
        return URI.create(apiBaseUrl.endsWith("/") ? apiBaseUrl.substring(0, apiBaseUrl.length() - 1) + path : apiBaseUrl + path);
    }

    private static String encodeSegment(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
    }

    private static String resolveAdminToken(String adminToken) {
        String resolved = firstNonBlank(adminToken, System.getenv(ADMIN_TOKEN_ENV));
        if (resolved == null) {
            return null;
        }
        return resolved.startsWith("Bearer ") ? resolved.substring("Bearer ".length()).trim() : resolved;
    }

    private static DbOptions resolveDbOptions(ImportOptions options) {
        String dbUrl = firstNonBlank(options.dbUrl(), System.getenv(GamePartitionCleanupMain.DB_URL_ENV));
        String dbUsername = firstNonBlank(options.dbUsername(), System.getenv(GamePartitionCleanupMain.DB_USERNAME_ENV));
        String dbPassword = firstNonBlank(options.dbPassword(), System.getenv(GamePartitionCleanupMain.DB_PASSWORD_ENV));
        if (dbUrl == null || dbUsername == null || dbPassword == null) {
            throw new IllegalArgumentException(
                "Missing DB connection for --bootstrapDb. Provide --dbUrl/--dbUsername/--dbPassword or set "
                    + GamePartitionCleanupMain.DB_URL_ENV + "/"
                    + GamePartitionCleanupMain.DB_USERNAME_ENV + "/"
                    + GamePartitionCleanupMain.DB_PASSWORD_ENV
            );
        }
        return new DbOptions(dbUrl, dbUsername, dbPassword);
    }

    private static void validateGameId(String gameId) {
        if (gameId == null || gameId.isBlank()) {
            throw new IllegalArgumentException("gameId cannot be blank");
        }
        if (!GAME_ID_PATTERN.matcher(gameId).matches()) {
            throw new IllegalArgumentException("Invalid gameId format: only [a-z0-9_] is allowed");
        }
    }

    private static String readValue(String argument, String optionName) {
        String value = argument.substring(optionName.length() + 1).trim();
        if (value.isBlank()) {
            throw new IllegalArgumentException("Argument " + optionName + " cannot be blank");
        }
        return value;
    }

    private static String requireText(JsonNode node, String fieldName) {
        JsonNode field = node.get(fieldName);
        if (field == null || !field.isTextual() || field.asText().isBlank()) {
            throw new IllegalArgumentException("Missing required text field: " + fieldName);
        }
        return field.asText();
    }

    private static List<ObjectNode> readObjectArray(JsonNode node, String fieldName) {
        JsonNode field = node.get(fieldName);
        if (!(field instanceof ArrayNode arrayNode)) {
            throw new IllegalArgumentException("Missing required array field: " + fieldName);
        }
        List<ObjectNode> result = new ArrayList<>(arrayNode.size());
        for (JsonNode item : arrayNode) {
            if (!(item instanceof ObjectNode objectNode)) {
                throw new IllegalArgumentException("Field `" + fieldName + "` must contain objects only");
            }
            result.add(objectNode.deepCopy());
        }
        return result;
    }

    private static List<ObjectNode> readOptionalObjectArray(JsonNode node, String fieldName) {
        JsonNode field = node.get(fieldName);
        if (field == null || field.isNull()) {
            return List.of();
        }
        if (!(field instanceof ArrayNode arrayNode)) {
            throw new IllegalArgumentException("Field `" + fieldName + "` must be array when present");
        }
        List<ObjectNode> result = new ArrayList<>(arrayNode.size());
        for (JsonNode item : arrayNode) {
            if (!(item instanceof ObjectNode objectNode)) {
                throw new IllegalArgumentException("Field `" + fieldName + "` must contain objects only");
            }
            result.add(objectNode.deepCopy());
        }
        return result;
    }

    private static String requireIdSegment(JsonNode node, String fieldName) {
        JsonNode field = node.get(fieldName);
        if (field == null || field.isNull()) {
            throw new IllegalArgumentException("Missing required id field: " + fieldName);
        }
        if (field.isTextual() && !field.asText().isBlank()) {
            return field.asText();
        }
        if (field.canConvertToLong()) {
            return field.asText();
        }
        throw new IllegalArgumentException("Field `" + fieldName + "` must be string or integer id");
    }

    private static String nullableText(JsonNode node, String fieldName) {
        JsonNode field = node.get(fieldName);
        if (field == null || field.isNull()) {
            return null;
        }
        if (!field.isTextual()) {
            throw new IllegalArgumentException("Field `" + fieldName + "` must be string when present");
        }
        String value = field.asText();
        return value.isBlank() ? null : value;
    }

    private static String defaultGameName(String gameId) {
        return "lol".equals(gameId) ? "League of Legends" : gameId;
    }

    private static String firstNonBlank(String primary, String fallback) {
        if (primary != null && !primary.isBlank()) {
            return primary.trim();
        }
        if (fallback != null && !fallback.isBlank()) {
            return fallback.trim();
        }
        return null;
    }

    record ImportOptions(
        String apiBaseUrl,
        String seedFile,
        String gameId,
        String gameName,
        String versionCode,
        String adminToken,
        boolean publish,
        boolean bootstrapDb,
        boolean dryRun,
        String dbUrl,
        String dbUsername,
        String dbPassword
    ) {
    }

    record DbOptions(String dbUrl, String dbUsername, String dbPassword) {
    }

    record HttpJsonResponse(int statusCode, String body) {
    }

    record SeedData(
        String gameId,
        String versionCode,
        List<ObjectNode> ownerCategories,
        List<ObjectNode> attributeDefinitions,
        List<ObjectNode> types,
        List<ObjectNode> formulaProfiles,
        List<ObjectNode> formulaBindings,
        List<ObjectNode> controlStateProfiles,
        List<ObjectNode> statusDefinitions,
        List<ObjectNode> statusModifierGroups,
        List<ObjectNode> statusAttributeModifiers,
        List<ObjectNode> statusPeriodicHpEffects,
        List<ObjectNode> heroes,
        List<ObjectNode> skills,
        List<ObjectNode> items,
        List<ObjectNode> typeRelations,
        List<ObjectNode> scenarios
    ) {
    }
}
