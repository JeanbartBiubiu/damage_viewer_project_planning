package xyz.game.datamanage.integration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.JWSSigner;
import com.nimbusds.jose.crypto.ECDSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.fasterxml.jackson.databind.JsonNode;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("it")
@EnabledIfEnvironmentVariable(named = "IT_DB_URL", matches = ".+")
@EnabledIfEnvironmentVariable(named = "IT_DB_USERNAME", matches = ".+")
class ControllerPublishFlowIT {

    private static final int IT_GAME_DATA_THRESHOLD = 128;
    private static final int SAMPLE_GAME_ID_LIMIT = 10;
    private static final DateTimeFormatter GAME_ID_TIME_FORMATTER =
        DateTimeFormatter.ofPattern("yyyyMMddHHmmss").withZone(ZoneOffset.UTC);
    private static final KeyPair TEST_KEY_PAIR = generateEcKeyPair();
    private static final ECPrivateKey TEST_PRIVATE_KEY = (ECPrivateKey) TEST_KEY_PAIR.getPrivate();
    private static final String TEST_PUBLIC_KEY_PEM = toPublicKeyPem((ECPublicKey) TEST_KEY_PAIR.getPublic());

    @Autowired
    private TestRestTemplate restTemplate;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private String gameId;

    @DynamicPropertySource
    static void registerProperties(DynamicPropertyRegistry registry) {
        registry.add("app.auth.jwt.es256-public-key-pem", () -> TEST_PUBLIC_KEY_PEM);
    }

    @BeforeEach
    void setUp() {
        assertHistoricalItDataWithinThreshold();
        gameId = generateGameId();
        seedGame(gameId);
    }

    private void assertHistoricalItDataWithinThreshold() {
        Integer historicalItGameCount = jdbcTemplate.queryForObject(
            "SELECT COUNT(1) FROM public.games WHERE game_id LIKE ?",
            Integer.class,
            "it_%"
        );
        int count = historicalItGameCount == null ? 0 : historicalItGameCount;
        if (count <= IT_GAME_DATA_THRESHOLD) {
            return;
        }

        List<String> sampleGameIds = jdbcTemplate.queryForList(
            "SELECT game_id FROM public.games WHERE game_id LIKE ? ORDER BY game_id ASC LIMIT ?",
            String.class,
            "it_%",
            SAMPLE_GAME_ID_LIMIT
        );

        String preview = sampleGameIds.isEmpty() ? "(none)" : String.join(", ", sampleGameIds);
        throw new IllegalStateException(
            "Historical IT game data exceeds threshold: count=" + count
                + ", threshold=" + IT_GAME_DATA_THRESHOLD
                + ". Please clean old test data before rerun. Sample gameIds: " + preview
                + ". Cleanup command example: "
                + "mvn -DskipTests test-compile "
                + "org.codehaus.mojo:exec-maven-plugin:3.5.0:java "
                + "\"-Dexec.classpathScope=test\" "
                + "\"-Dexec.mainClass=xyz.game.datamanage.tools.GamePartitionCleanupMain\" "
                + "\"-Dexec.args=--gameId=<gameId> --confirm=DROP_<gameId>\""
        );
    }

    @Test
    void controllerOnly_fullPublishFlow_shouldSucceed() {
        String versionCode = "1.0.0";
        putBaselineEntities("Ahri");

        publish(versionCode);

        ResponseEntity<JsonNode> currentResponse = getCurrentVersion();
        assertEquals(HttpStatus.OK, currentResponse.getStatusCode());
        JsonNode current = requireBody(currentResponse);
        assertEquals(versionCode, current.path("versionCode").asText());
        assertFalse(current.path("publishedAt").asText().isBlank());

        ResponseEntity<JsonNode> bundleResponse = getBundle(versionCode);
        assertEquals(HttpStatus.OK, bundleResponse.getStatusCode());
        JsonNode bundle = requireBody(bundleResponse);
        assertEquals(versionCode, bundle.path("meta").path("versionCode").asText());
        assertTrue(containsByField(bundle.path("attributeDefinitions"), "attrKey", "attack_power"));
        assertTrue(containsByField(bundle.path("types"), "typeId", "1001"));
        assertTrue(containsByField(bundle.path("typeRelations"), "targetId", "attack_power"));
        assertTrue(containsByField(bundle.path("heroes"), "heroId", "hero_ahri"));
        assertTrue(containsByField(bundle.path("skills"), "skillId", "skill_orb"));
        assertTrue(containsByField(bundle.path("items"), "itemId", "item_tome"));
        assertTrue(containsByField(bundle.path("formulaProfiles"), "formulaId", "formula_magic_damage"));
        assertTrue(containsFormulaBinding(bundle.path("formulaBindings"), "skill", "skill_orb", "damage_raw"));
        JsonNode skill = findByField(bundle.path("skills"), "skillId", "skill_orb");
        assertEquals(60, skill.path("params").path("baseDamage").asInt());
        assertEquals(250, skill.path("timingProfile").path("cast").path("frontSwingMs").asInt());
        JsonNode formulaProfile = findByField(bundle.path("formulaProfiles"), "formulaId", "formula_magic_damage");
        assertEquals("damage", formulaProfile.path("formulaType").asText());
        JsonNode formulaBinding = findFormulaBinding(bundle.path("formulaBindings"), "skill", "skill_orb", "damage_raw");
        assertEquals("formula_magic_damage", formulaBinding.path("formulaId").asText());
    }

    @Test
    void formulaProfileWrite_shouldRecreateMissingLogPartitionForExistingGame() {
        String partitionTable = "formula_profiles_log_" + gameId;
        jdbcTemplate.execute("DROP TABLE IF EXISTS public." + partitionTable + " CASCADE");
        Integer partitionCountBefore = jdbcTemplate.queryForObject(
            "SELECT COUNT(1) FROM pg_tables WHERE schemaname = 'public' AND tablename = ?",
            Integer.class,
            partitionTable
        );
        assertEquals(0, partitionCountBefore == null ? 0 : partitionCountBefore);

        putFormulaProfile("formula_magic_damage");

        Integer partitionCountAfter = jdbcTemplate.queryForObject(
            "SELECT COUNT(1) FROM pg_tables WHERE schemaname = 'public' AND tablename = ?",
            Integer.class,
            partitionTable
        );
        assertEquals(1, partitionCountAfter == null ? 0 : partitionCountAfter);
    }

    @Test
    void katarinaMvpPublishFlow_shouldExposeEngineReadyBundle() {
        String versionCode = "mvp_katarina_001";
        putKatarinaMvpEntities();

        publish(versionCode);

        ResponseEntity<JsonNode> currentResponse = getCurrentVersion();
        assertEquals(HttpStatus.OK, currentResponse.getStatusCode());
        JsonNode current = requireBody(currentResponse);
        assertEquals(versionCode, current.path("versionCode").asText());
        assertFalse(current.path("publishedAt").asText().isBlank());

        ResponseEntity<JsonNode> bundleResponse = getBundle(versionCode);
        assertEquals(HttpStatus.OK, bundleResponse.getStatusCode());
        JsonNode bundle = requireBody(bundleResponse);
        assertEquals(versionCode, bundle.path("meta").path("versionCode").asText());
        assertEquals(10, bundle.path("attributeDefinitions").size());
        assertEquals(2, bundle.path("heroes").size());
        assertEquals(2, bundle.path("skills").size());
        assertEquals(2, bundle.path("items").size());

        JsonNode hpRegen = findByField(bundle.path("attributeDefinitions"), "attrKey", "hp_regen");
        assertEquals("rate", hpRegen.path("valueKind").asText());
        assertEquals("hp", hpRegen.path("rateTargetAttrKey").asText());

        JsonNode attackSpeed = findByField(bundle.path("attributeDefinitions"), "attrKey", "attack_speed");
        assertEquals("scalar", attackSpeed.path("valueKind").asText());
        assertTrue(attackSpeed.path("rateTargetAttrKey").isMissingNode());

        JsonNode katarina = findByField(bundle.path("heroes"), "heroId", "hero_katarina");
        assertEquals("卡特琳娜", katarina.path("name").asText());
        assertEquals(2508.0, katarina.path("baseStats").path("hp").asDouble(), 0.001);
        assertEquals(112.4, katarina.path("baseStats").path("ad").asDouble(), 0.001);

        JsonNode dummy = findByField(bundle.path("heroes"), "heroId", "hero_dummy_10000hp_100ar_100mr");
        assertEquals(10000.0, dummy.path("baseStats").path("hp").asDouble(), 0.001);
        assertEquals(100.0, dummy.path("baseStats").path("armor").asDouble(), 0.001);
        assertEquals(100.0, dummy.path("baseStats").path("magic_resist").asDouble(), 0.001);

        JsonNode basicAttack = findByField(bundle.path("skills"), "skillId", "skill_katarina_basic_attack");
        assertEquals("A", basicAttack.path("skillKey").asText());
        assertEquals("physical", basicAttack.path("params").path("damageType").asText());
        assertEquals(1.0, basicAttack.path("params").path("attackRatio").asDouble(), 0.001);

        JsonNode deathLotus = findByField(bundle.path("skills"), "skillId", "skill_katarina_r");
        assertEquals("R", deathLotus.path("skillKey").asText());
        assertEquals(15, deathLotus.path("params").path("hitCount").asInt());
        assertEquals(167, deathLotus.path("params").path("hitIntervalMs").asInt());
        assertEquals(50.0, deathLotus.path("params").path("baseDamageBySkillLevel").path(2).asDouble(), 0.001);

        JsonNode bork = findByField(bundle.path("items"), "itemId", "item_blade_of_the_ruined_king");
        assertEquals("破败王者之刃", bork.path("name").asText());
        assertEquals(55.0, bork.path("statsModifier").path("ad").asDouble(), 0.001);
        assertEquals(0.3, bork.path("statsModifier").path("attack_speed").asDouble(), 0.001);

        JsonNode nashors = findByField(bundle.path("items"), "itemId", "item_nashors_tooth");
        assertEquals("纳什之牙", nashors.path("name").asText());
        assertEquals(90.0, nashors.path("statsModifier").path("ap").asDouble(), 0.001);
        assertEquals(15.0, nashors.path("statsModifier").path("ability_haste").asDouble(), 0.001);
    }

    @Test
    void bundle_shouldReturnPublishedSnapshotForRequestedVersionCode() {
        String versionCode = "1.0.0";
        putBaselineEntities("Ahri");
        publish(versionCode);

        ResponseEntity<JsonNode> firstBundle = getBundle(versionCode);
        assertEquals(HttpStatus.OK, firstBundle.getStatusCode());
        JsonNode bundle = requireBody(firstBundle);
        assertEquals(versionCode, bundle.path("meta").path("versionCode").asText());

        ResponseEntity<JsonNode> secondBundle = getBundle(versionCode);
        assertEquals(HttpStatus.OK, secondBundle.getStatusCode());
        assertEquals(versionCode, requireBody(secondBundle).path("meta").path("versionCode").asText());
    }

    @Test
    void prePublishChanges_shouldNotAffectCurrentAndSnapshot_untilPublish() {
        String versionCodeV1 = "1.0.0";
        putBaselineEntities("Ahri");
        publish(versionCodeV1);

        JsonNode currentV1 = requireBody(getCurrentVersion());
        assertEquals(versionCodeV1, currentV1.path("versionCode").asText());
        ResponseEntity<JsonNode> bundleV1Response = getBundle(versionCodeV1);
        JsonNode bundleV1 = requireBody(bundleV1Response);
        assertEquals("Ahri", findByField(bundleV1.path("heroes"), "heroId", "hero_ahri").path("name").asText());

        String versionCodeV2 = "1.0.1";
        upsertHero("hero_ahri", "Ahri Rework");

        JsonNode currentBeforePublishV2 = requireBody(getCurrentVersion());
        assertEquals(versionCodeV1, currentBeforePublishV2.path("versionCode").asText());

        JsonNode bundleBeforePublishV2 = requireBody(getBundle(versionCodeV1));
        assertEquals("Ahri", findByField(bundleBeforePublishV2.path("heroes"), "heroId", "hero_ahri").path("name").asText());

        ResponseEntity<JsonNode> notFoundBundle = getBundle(versionCodeV2);
        assertEquals(HttpStatus.NOT_FOUND, notFoundBundle.getStatusCode());

        publish(versionCodeV2);

        JsonNode currentV2 = requireBody(getCurrentVersion());
        assertEquals(versionCodeV2, currentV2.path("versionCode").asText());

        ResponseEntity<JsonNode> bundleV2Response = getBundle(versionCodeV2);
        assertEquals(HttpStatus.OK, bundleV2Response.getStatusCode());
        JsonNode bundleV2 = requireBody(bundleV2Response);
        assertEquals("Ahri Rework", findByField(bundleV2.path("heroes"), "heroId", "hero_ahri").path("name").asText());
    }

    @Test
    void adminListEndpoints_shouldExposeLatestDraftState_forEditableResources() {
        putBaselineEntities("Ahri");
        upsertHero("hero_ahri", "Ahri Draft");

        ResponseEntity<JsonNode> heroListResponse = adminExchange("/api/admin/games/" + gameId + "/heroes", HttpMethod.GET, null);
        assertEquals(HttpStatus.OK, heroListResponse.getStatusCode());
        JsonNode hero = findByField(requireBody(heroListResponse).path("heroes"), "heroId", "hero_ahri");
        assertEquals("Ahri Draft", hero.path("name").asText());

        ResponseEntity<JsonNode> skillListResponse = adminExchange("/api/admin/games/" + gameId + "/skills", HttpMethod.GET, null);
        assertEquals(HttpStatus.OK, skillListResponse.getStatusCode());
        JsonNode skill = findByField(requireBody(skillListResponse).path("skills"), "skillId", "skill_orb");
        assertEquals("hero", skill.path("ownerType").asText());
        assertEquals("hero_ahri", skill.path("ownerId").asText());

        ResponseEntity<JsonNode> itemListResponse = adminExchange("/api/admin/games/" + gameId + "/items", HttpMethod.GET, null);
        assertEquals(HttpStatus.OK, itemListResponse.getStatusCode());
        JsonNode item = findByField(requireBody(itemListResponse).path("items"), "itemId", "item_tome");
        assertEquals(435, item.path("goldCost").asInt());

        ResponseEntity<JsonNode> attributeDefinitionListResponse = adminExchange(
            "/api/admin/games/" + gameId + "/attribute-definitions",
            HttpMethod.GET,
            null
        );
        assertEquals(HttpStatus.OK, attributeDefinitionListResponse.getStatusCode());
        JsonNode attributeDefinition = findByField(
            requireBody(attributeDefinitionListResponse).path("attributeDefinitions"),
            "attrKey",
            "attack_power"
        );
        assertEquals("Attack Power", attributeDefinition.path("attrName").asText());

        ResponseEntity<JsonNode> typeListResponse = adminExchange("/api/admin/games/" + gameId + "/types", HttpMethod.GET, null);
        assertEquals(HttpStatus.OK, typeListResponse.getStatusCode());
        JsonNode type = findByField(requireBody(typeListResponse).path("types"), "typeId", "1001");
        assertEquals("Mage", type.path("name").asText());

        ResponseEntity<JsonNode> typeRelationListResponse = adminExchange(
            "/api/admin/games/" + gameId + "/type-relations",
            HttpMethod.GET,
            null
        );
        assertEquals(HttpStatus.OK, typeRelationListResponse.getStatusCode());
        JsonNode typeRelation = findByField(requireBody(typeRelationListResponse).path("typeRelations"), "targetId", "attack_power");
        assertEquals(1001, typeRelation.path("typeId").asInt());
        assertEquals("attribute", typeRelation.path("targetCategory").asText());
    }

    @Test
    void progressionSchemaAdminAndHeroStatsValidation_shouldApplyToGamesAndHeroWrite() {
        ResponseEntity<JsonNode> defaultSchemaResponse = adminExchange(
            "/api/admin/games/" + gameId + "/progression-schema",
            HttpMethod.GET,
            null
        );
        assertEquals(HttpStatus.OK, defaultSchemaResponse.getStatusCode());
        JsonNode defaultSchema = requireBody(defaultSchemaResponse);
        assertEquals("LEVEL", defaultSchema.path("progressionKind").asText());
        assertEquals(1, defaultSchema.path("stageMin").asInt());
        assertEquals(18, defaultSchema.path("stageMax").asInt());
        assertEquals("Lv", defaultSchema.path("stageLabel").asText());
        assertTrue(defaultSchema.path("requireAllStages").asBoolean());

        ResponseEntity<JsonNode> putSchemaResponse = adminExchange(
            "/api/admin/games/" + gameId + "/progression-schema",
            HttpMethod.PUT,
            Map.of(
                "progressionKind", "LEVEL",
                "stageMin", 1,
                "stageMax", 3,
                "stageLabel", "Lv",
                "requireAllStages", true
            )
        );
        assertEquals(HttpStatus.OK, putSchemaResponse.getStatusCode());

        ResponseEntity<JsonNode> gamesResponse = restTemplate.getForEntity("/api/games", JsonNode.class);
        assertEquals(HttpStatus.OK, gamesResponse.getStatusCode());
        JsonNode game = findByField(requireBody(gamesResponse), "gameId", gameId);
        JsonNode progressionSchema = game.path("progressionSchema");
        assertEquals("LEVEL", progressionSchema.path("progressionKind").asText());
        assertEquals(1, progressionSchema.path("stageMin").asInt());
        assertEquals(3, progressionSchema.path("stageMax").asInt());
        assertEquals("Lv", progressionSchema.path("stageLabel").asText());
        assertTrue(progressionSchema.path("requireAllStages").asBoolean());

        ResponseEntity<JsonNode> validHeroResponse = adminExchange(
            "/api/admin/games/" + gameId + "/heroes/hero_schema_valid",
            HttpMethod.PUT,
            Map.of(
                "name", "Schema Hero",
                "title", "Validation",
                "avatarUrl", "hero_schema_valid.png",
                "baseStats", Map.of("hp", 500),
                "statsByLevel", Map.of(
                    "1", Map.of("hp", 500, "ad", 60),
                    "2", Map.of("hp", 550, "ad", 65),
                    "3", Map.of("hp", 600, "ad", 70)
                )
            )
        );
        assertEquals(HttpStatus.OK, validHeroResponse.getStatusCode());

        ResponseEntity<JsonNode> invalidHeroResponse = adminExchange(
            "/api/admin/games/" + gameId + "/heroes/hero_schema_invalid",
            HttpMethod.PUT,
            Map.of(
                "name", "Schema Hero Invalid",
                "title", "Validation",
                "avatarUrl", "hero_schema_invalid.png",
                "baseStats", Map.of("hp", 500),
                "statsByLevel", Map.of(
                    "1", Map.of("hp", 500, "ad", 60),
                    "3", Map.of("hp", 600, "ad", 70)
                )
            )
        );
        assertEquals(HttpStatus.BAD_REQUEST, invalidHeroResponse.getStatusCode());
        assertEquals("400.INVALID_BODY", requireBody(invalidHeroResponse).path("error").path("code").asText());
    }

    @Test
    void statusActionControlRuleCrud_andPublishBundle_shouldSucceed() {
        String versionCode = "1.0.0";
        putType(2001, "status_stun_test", "IT status");
        putType(2002, "action_basic_attack_test", "IT action");
        putType(2003, "action_cast_skill_test", "IT action");
        putType(2004, "phase_cast_test", "IT phase");

        putStatusActionControlRule(
            "status_stun_test_forbid",
            Map.of(
                "statusTypeId", 2001,
                "ruleKind", "forbid",
                "actionTypeIds", List.of(2002, 2003),
                "actionMatchTypeIds", List.of(),
                "interruptPhaseTypeIds", List.of(),
                "priority", 10,
                "description", "测试：眩晕禁止普攻和施法",
                "extend", Map.of("source", "it")
            )
        );

        ResponseEntity<JsonNode> listResponse = adminExchange(
            "/api/admin/games/" + gameId + "/status-action-control-rules",
            HttpMethod.GET,
            null
        );
        assertEquals(HttpStatus.OK, listResponse.getStatusCode());
        assertTrue(containsByField(requireBody(listResponse).path("statusActionControlRules"), "ruleId", "status_stun_test_forbid"));

        ResponseEntity<JsonNode> getResponse = adminExchange(
            "/api/admin/games/" + gameId + "/status-action-control-rules/status_stun_test_forbid",
            HttpMethod.GET,
            null
        );
        assertEquals(HttpStatus.OK, getResponse.getStatusCode());
        JsonNode stored = requireBody(getResponse);
        assertEquals(2001, stored.path("statusTypeId").asInt());
        assertEquals(2, stored.path("actionTypeIds").size());
        assertEquals("测试：眩晕禁止普攻和施法", stored.path("description").asText());

        ResponseEntity<JsonNode> updateResponse = adminExchange(
            "/api/admin/games/" + gameId + "/status-action-control-rules/status_stun_test_forbid",
            HttpMethod.PUT,
            Map.of(
                "statusTypeId", 2001,
                "ruleKind", "forbid",
                "actionTypeIds", List.of(2002, 2003),
                "actionMatchTypeIds", List.of(),
                "interruptPhaseTypeIds", List.of(),
                "priority", 20,
                "description", "测试：PUT 后描述",
                "extend", Map.of("source", "it")
            )
        );
        assertEquals(HttpStatus.OK, updateResponse.getStatusCode());
        assertEquals(20, requireBody(updateResponse).path("priority").asInt());

        publish(versionCode);

        ResponseEntity<JsonNode> bundleResponse = getBundle(versionCode);
        assertEquals(HttpStatus.OK, bundleResponse.getStatusCode());
        JsonNode bundle = requireBody(bundleResponse);
        JsonNode statusRule = findByField(bundle.path("statusActionControlRules"), "ruleId", "status_stun_test_forbid");
        assertEquals("forbid", statusRule.path("ruleKind").asText());
        assertEquals(20, statusRule.path("priority").asInt());
        assertEquals("测试：PUT 后描述", statusRule.path("description").asText());
        assertEquals(2, statusRule.path("actionTypeIds").size());
    }

    @Test
    void statusResourceCrud_andPublishBundle_shouldSucceed() {
        String versionCode = "1.0.0";
        putType(2101, "status_burning_test", "IT status");
        putAttributeDefinition("move_speed");
        putFormulaProfile("formula_status_tick");
        putCoefficientBucket(
            "it.status.move_speed.bucket",
            Map.of(
                "resolutionDomain", "attribute",
                "stageKey", "status_bonus",
                "targetAttrKey", "move_speed",
                "aggregationMode", "add",
                "provisional", false,
                "name", "Status Move Speed Bucket",
                "description", "测试：状态移速桶",
                "editorHint", Map.of("groupLabel", "状态"),
                "bucketConfig", Map.of("source", "it")
            )
        );

        ResponseEntity<JsonNode> controlResponse = adminExchange(
            "/api/admin/games/" + gameId + "/control-state-profiles/it_stun_profile",
            HttpMethod.PUT,
            Map.of(
                "name", "IT Stun",
                "description", "测试：控制语义",
                "controlKind", "stun",
                "movementLockMode", "forbid_move",
                "castLockMode", "interrupt_and_forbid",
                "attackLockMode", "interrupt_and_forbid",
                "inputOverrideMode", "force_stop",
                "displacementKind", "none",
                "blocksControlInput", true,
                "priority", 10,
                "extend", Map.of("source", "it")
            )
        );
        assertEquals(HttpStatus.OK, controlResponse.getStatusCode());

        ResponseEntity<JsonNode> statusResponse = adminExchange(
            "/api/admin/games/" + gameId + "/status-definitions/it_burning",
            HttpMethod.PUT,
            Map.of(
                "name", "IT Burning",
                "description", "测试：状态定义",
                "statusKind", "dot",
                "statusTypeId", 2101,
                "controlProfileId", "it_stun_profile",
                "stackGroupKey", "it.burning",
                "sourceScope", "same_source",
                "stackMode", "stack",
                "maxStacks", 3,
                "durationMode", "timed",
                "durationMs", 3000,
                "snapshotPolicy", "on_apply",
                "isDispellable", true,
                "cleansePriority", 5,
                "extend", Map.of("source", "it")
            )
        );
        assertEquals(HttpStatus.OK, statusResponse.getStatusCode());

        ResponseEntity<JsonNode> groupResponse = adminExchange(
            "/api/admin/games/" + gameId + "/status-modifier-groups/it_burning/periodic",
            HttpMethod.PUT,
            Map.of(
                "groupName", "Periodic Effects",
                "phaseKey", "on_interval",
                "snapshotPolicy", "per_tick",
                "intervalMs", 1000,
                "maxTicks", 3,
                "priority", 1,
                "extend", Map.of("source", "it")
            )
        );
        assertEquals(HttpStatus.OK, groupResponse.getStatusCode());

        ResponseEntity<JsonNode> modifierResponse = adminExchange(
            "/api/admin/games/" + gameId + "/status-attribute-modifiers/it_burning/periodic/move_speed_bonus",
            HttpMethod.PUT,
            Map.of(
                "attrKey", "move_speed",
                "modifierMode", "bucket_add",
                "value", 12,
                "bucketKey", "it.status.move_speed.bucket",
                "perStack", true,
                "priority", 2,
                "extend", Map.of("source", "it")
            )
        );
        assertEquals(HttpStatus.OK, modifierResponse.getStatusCode());

        ResponseEntity<JsonNode> effectResponse = adminExchange(
            "/api/admin/games/" + gameId + "/status-periodic-hp-effects/it_burning/periodic/burning_tick",
            HttpMethod.PUT,
            Map.of(
                "effectKind", "damage",
                "tickFormulaId", "formula_status_tick",
                "damageType", "magic",
                "canCrit", false,
                "perStack", true,
                "extend", Map.of("source", "it")
            )
        );
        assertEquals(HttpStatus.OK, effectResponse.getStatusCode());

        ResponseEntity<JsonNode> listResponse = adminExchange(
            "/api/admin/games/" + gameId + "/status-definitions",
            HttpMethod.GET,
            null
        );
        assertEquals(HttpStatus.OK, listResponse.getStatusCode());
        assertTrue(containsByField(requireBody(listResponse).path("statusDefinitions"), "statusId", "it_burning"));

        publish(versionCode);

        ResponseEntity<JsonNode> bundleResponse = getBundle(versionCode);
        assertEquals(HttpStatus.OK, bundleResponse.getStatusCode());
        JsonNode bundle = requireBody(bundleResponse);
        assertEquals("dot", findByField(bundle.path("statusDefinitions"), "statusId", "it_burning").path("statusKind").asText());
        assertEquals(
            "stun",
            findByField(bundle.path("controlStateProfiles"), "controlProfileId", "it_stun_profile").path("controlKind").asText()
        );
        assertEquals("on_interval", findByField(bundle.path("statusModifierGroups"), "groupKey", "periodic").path("phaseKey").asText());
        assertEquals(
            "bucket_add",
            findByField(bundle.path("statusAttributeModifiers"), "modifierId", "move_speed_bonus").path("modifierMode").asText()
        );
        assertEquals("damage", findByField(bundle.path("statusPeriodicHpEffects"), "effectId", "burning_tick").path("effectKind").asText());
    }

    @Test
    void coefficientBucketCrud_andPublishBundle_shouldSucceed() {
        String versionCode = "1.0.0";
        putAttributeDefinition("move_speed");

        putCoefficientBucket(
            "it.move_speed.percent_bonus",
            Map.of(
                "resolutionDomain", "attribute",
                "stageKey", "percent_bonus",
                "targetAttrKey", "move_speed",
                "aggregationMode", "add",
                "provisional", true,
                "name", "Move Speed Percent Bonus",
                "description", "测试：移速百分比加成桶",
                "editorHint", Map.of("groupLabel", "移速百分比"),
                "bucketConfig", Map.of("source", "it")
            )
        );

        ResponseEntity<JsonNode> listResponse = adminExchange(
            "/api/admin/games/" + gameId + "/coefficient-buckets",
            HttpMethod.GET,
            null
        );
        assertEquals(HttpStatus.OK, listResponse.getStatusCode());
        assertTrue(containsByField(requireBody(listResponse).path("coefficientBuckets"), "bucketKey", "it.move_speed.percent_bonus"));

        ResponseEntity<JsonNode> getResponse = adminExchange(
            "/api/admin/games/" + gameId + "/coefficient-buckets/it.move_speed.percent_bonus",
            HttpMethod.GET,
            null
        );
        assertEquals(HttpStatus.OK, getResponse.getStatusCode());
        JsonNode stored = requireBody(getResponse);
        assertEquals("attribute", stored.path("resolutionDomain").asText());
        assertEquals("move_speed", stored.path("targetAttrKey").asText());
        assertEquals("add", stored.path("aggregationMode").asText());
        assertTrue(stored.path("provisional").asBoolean());

        ResponseEntity<JsonNode> updateResponse = adminExchange(
            "/api/admin/games/" + gameId + "/coefficient-buckets/it.move_speed.percent_bonus",
            HttpMethod.PUT,
            Map.of(
                "resolutionDomain", "attribute",
                "stageKey", "percent_bonus",
                "targetAttrKey", "move_speed",
                "aggregationMode", "add",
                "provisional", false,
                "description", "测试：PUT 后桶描述",
                "editorHint", Map.of("groupLabel", "移速百分比"),
                "bucketConfig", Map.of("source", "it")
            )
        );
        assertEquals(HttpStatus.OK, updateResponse.getStatusCode());
        JsonNode updated = requireBody(updateResponse);
        assertFalse(updated.path("provisional").asBoolean());
        assertEquals("测试：PUT 后桶描述", updated.path("description").asText());

        publish(versionCode);

        ResponseEntity<JsonNode> bundleResponse = getBundle(versionCode);
        assertEquals(HttpStatus.OK, bundleResponse.getStatusCode());
        JsonNode bundle = requireBody(bundleResponse);
        JsonNode bucket = findByField(bundle.path("coefficientBuckets"), "bucketKey", "it.move_speed.percent_bonus");
        assertEquals("attribute", bucket.path("resolutionDomain").asText());
        assertEquals("move_speed", bucket.path("targetAttrKey").asText());
        assertEquals("add", bucket.path("aggregationMode").asText());
        assertFalse(bucket.path("provisional").asBoolean());
        assertEquals("测试：PUT 后桶描述", bucket.path("description").asText());
    }

    private void seedGame(String targetGameId) {
        jdbcTemplate.update(
            "INSERT INTO public.games (game_id, game_name, game_img_url) VALUES (?, ?, ?) ON CONFLICT (game_id) DO NOTHING",
            targetGameId,
            "IT " + targetGameId,
            null
        );
        ensurePublishedSnapshotTable();
        ensureCoefficientBucketTables();
        ensureStatusResourceTables();
        ensureFormulaPartitions(targetGameId);
        ensureCoefficientBucketPartitions(targetGameId);
        ensureStatusActionControlRulePartitions(targetGameId);
        ensureStatusResourcePartitions(targetGameId);
        jdbcTemplate.update(
            "INSERT INTO public.owner_categories (game_id, owner_type, name, description) VALUES (?, 'hero', ?, ?) "
                + "ON CONFLICT (game_id, owner_type) DO NOTHING",
            targetGameId,
            "Hero",
            "Integration test owner type"
        );
        jdbcTemplate.update(
            "INSERT INTO public.owner_categories (game_id, owner_type, name, description) VALUES (?, 'item', ?, ?) "
                + "ON CONFLICT (game_id, owner_type) DO NOTHING",
            targetGameId,
            "Item",
            "Integration test owner type"
        );
    }

    private void ensureFormulaPartitions(String targetGameId) {
        createGamePartition("formula_profiles", targetGameId);
        createGamePartition("formula_profiles_log", targetGameId);
        createGamePartition("formula_bindings", targetGameId);
        createGamePartition("formula_bindings_log", targetGameId);
    }

    private void ensureCoefficientBucketTables() {
        jdbcTemplate.execute(
            """
            CREATE TABLE IF NOT EXISTS public.coefficient_buckets (
                game_id varchar(64) NOT NULL,
                bucket_key varchar(64) NOT NULL,
                start_version_id bigint NOT NULL,
                end_version_id bigint NOT NULL,
                resolution_domain varchar(16) NOT NULL,
                stage_key varchar(32) NOT NULL,
                target_attr_key varchar(64),
                aggregation_mode varchar(16) NOT NULL,
                provisional boolean NOT NULL DEFAULT false,
                name varchar(100),
                description varchar(255),
                editor_hint jsonb NOT NULL DEFAULT '{}',
                bucket_config jsonb NOT NULL DEFAULT '{}',
                updated_at timestamp NOT NULL DEFAULT NOW(),
                CONSTRAINT pk_coefficient_buckets PRIMARY KEY (game_id, bucket_key)
            ) PARTITION BY LIST (game_id)
            """
        );
        jdbcTemplate.execute(
            """
            CREATE TABLE IF NOT EXISTS public.coefficient_buckets_log (
                game_id varchar(64) NOT NULL,
                bucket_key varchar(64) NOT NULL,
                start_version_id bigint NOT NULL,
                end_version_id bigint NOT NULL,
                resolution_domain varchar(16) NOT NULL,
                stage_key varchar(32) NOT NULL,
                target_attr_key varchar(64),
                aggregation_mode varchar(16) NOT NULL,
                provisional boolean NOT NULL DEFAULT false,
                name varchar(100),
                description varchar(255),
                editor_hint jsonb NOT NULL DEFAULT '{}',
                bucket_config jsonb NOT NULL DEFAULT '{}',
                CONSTRAINT pk_coefficient_buckets_log PRIMARY KEY (game_id, bucket_key, start_version_id)
            ) PARTITION BY LIST (game_id)
            """
        );
    }

    private void ensureStatusResourceTables() {
        jdbcTemplate.execute(
            """
            CREATE TABLE IF NOT EXISTS public.status_definitions (
                game_id varchar(64) NOT NULL,
                status_id varchar(64) NOT NULL,
                start_version_id bigint NOT NULL,
                end_version_id bigint NOT NULL,
                name varchar(100) NOT NULL,
                description text,
                status_kind varchar(24) NOT NULL,
                status_type_id int,
                control_profile_id varchar(64),
                stack_group_key varchar(64) NOT NULL,
                source_scope varchar(24) NOT NULL DEFAULT 'any_source',
                stack_mode varchar(24) NOT NULL DEFAULT 'refresh',
                max_stacks int NOT NULL DEFAULT 1,
                max_instances int,
                duration_mode varchar(16) NOT NULL DEFAULT 'timed',
                duration_ms int,
                duration_formula_id varchar(64),
                default_magnitude_formula_id varchar(64),
                snapshot_policy varchar(16) NOT NULL DEFAULT 'on_apply',
                is_dispellable boolean NOT NULL DEFAULT true,
                cleanse_priority int NOT NULL DEFAULT 0,
                extend jsonb NOT NULL DEFAULT '{}',
                updated_at timestamp NOT NULL DEFAULT NOW(),
                CONSTRAINT pk_status_definitions PRIMARY KEY (game_id, status_id)
            ) PARTITION BY LIST (game_id)
            """
        );
        jdbcTemplate.execute(
            """
            CREATE TABLE IF NOT EXISTS public.status_definitions_log (
                game_id varchar(64) NOT NULL,
                status_id varchar(64) NOT NULL,
                start_version_id bigint NOT NULL,
                end_version_id bigint NOT NULL,
                name varchar(100) NOT NULL,
                description text,
                status_kind varchar(24) NOT NULL,
                status_type_id int,
                control_profile_id varchar(64),
                stack_group_key varchar(64) NOT NULL,
                source_scope varchar(24) NOT NULL,
                stack_mode varchar(24) NOT NULL,
                max_stacks int NOT NULL,
                max_instances int,
                duration_mode varchar(16) NOT NULL,
                duration_ms int,
                duration_formula_id varchar(64),
                default_magnitude_formula_id varchar(64),
                snapshot_policy varchar(16) NOT NULL,
                is_dispellable boolean NOT NULL,
                cleanse_priority int NOT NULL,
                extend jsonb NOT NULL DEFAULT '{}',
                CONSTRAINT pk_status_definitions_log PRIMARY KEY (game_id, status_id, start_version_id)
            ) PARTITION BY LIST (game_id)
            """
        );
        jdbcTemplate.execute(
            """
            CREATE TABLE IF NOT EXISTS public.control_state_profiles (
                game_id varchar(64) NOT NULL,
                control_profile_id varchar(64) NOT NULL,
                start_version_id bigint NOT NULL,
                end_version_id bigint NOT NULL,
                name varchar(100) NOT NULL,
                description text,
                control_kind varchar(24) NOT NULL,
                movement_lock_mode varchar(24) NOT NULL DEFAULT 'none',
                cast_lock_mode varchar(24) NOT NULL DEFAULT 'none',
                attack_lock_mode varchar(24) NOT NULL DEFAULT 'none',
                input_override_mode varchar(32) NOT NULL DEFAULT 'none',
                displacement_kind varchar(24) NOT NULL DEFAULT 'none',
                blocks_control_input boolean NOT NULL DEFAULT false,
                grants_unstoppable boolean NOT NULL DEFAULT false,
                breaks_on_damage boolean NOT NULL DEFAULT false,
                tenacity_reducible boolean NOT NULL DEFAULT true,
                priority int NOT NULL DEFAULT 0,
                extend jsonb NOT NULL DEFAULT '{}',
                updated_at timestamp NOT NULL DEFAULT NOW(),
                CONSTRAINT pk_control_state_profiles PRIMARY KEY (game_id, control_profile_id)
            ) PARTITION BY LIST (game_id)
            """
        );
        jdbcTemplate.execute(
            """
            CREATE TABLE IF NOT EXISTS public.control_state_profiles_log (
                game_id varchar(64) NOT NULL,
                control_profile_id varchar(64) NOT NULL,
                start_version_id bigint NOT NULL,
                end_version_id bigint NOT NULL,
                name varchar(100) NOT NULL,
                description text,
                control_kind varchar(24) NOT NULL,
                movement_lock_mode varchar(24) NOT NULL,
                cast_lock_mode varchar(24) NOT NULL,
                attack_lock_mode varchar(24) NOT NULL,
                input_override_mode varchar(32) NOT NULL,
                displacement_kind varchar(24) NOT NULL,
                blocks_control_input boolean NOT NULL,
                grants_unstoppable boolean NOT NULL,
                breaks_on_damage boolean NOT NULL,
                tenacity_reducible boolean NOT NULL,
                priority int NOT NULL,
                extend jsonb NOT NULL DEFAULT '{}',
                CONSTRAINT pk_control_state_profiles_log PRIMARY KEY (game_id, control_profile_id, start_version_id)
            ) PARTITION BY LIST (game_id)
            """
        );
        jdbcTemplate.execute(
            """
            CREATE TABLE IF NOT EXISTS public.status_modifier_groups (
                game_id varchar(64) NOT NULL,
                status_id varchar(64) NOT NULL,
                group_key varchar(64) NOT NULL,
                start_version_id bigint NOT NULL,
                end_version_id bigint NOT NULL,
                group_name varchar(100),
                phase_key varchar(24) NOT NULL,
                snapshot_policy varchar(16) NOT NULL DEFAULT 'on_apply',
                interval_ms int,
                max_ticks int,
                priority int NOT NULL DEFAULT 0,
                extend jsonb NOT NULL DEFAULT '{}',
                updated_at timestamp NOT NULL DEFAULT NOW(),
                CONSTRAINT pk_status_modifier_groups PRIMARY KEY (game_id, status_id, group_key)
            ) PARTITION BY LIST (game_id)
            """
        );
        jdbcTemplate.execute(
            """
            CREATE TABLE IF NOT EXISTS public.status_modifier_groups_log (
                game_id varchar(64) NOT NULL,
                status_id varchar(64) NOT NULL,
                group_key varchar(64) NOT NULL,
                start_version_id bigint NOT NULL,
                end_version_id bigint NOT NULL,
                group_name varchar(100),
                phase_key varchar(24) NOT NULL,
                snapshot_policy varchar(16) NOT NULL,
                interval_ms int,
                max_ticks int,
                priority int NOT NULL,
                extend jsonb NOT NULL DEFAULT '{}',
                CONSTRAINT pk_status_modifier_groups_log PRIMARY KEY (game_id, status_id, group_key, start_version_id)
            ) PARTITION BY LIST (game_id)
            """
        );
        jdbcTemplate.execute(
            """
            CREATE TABLE IF NOT EXISTS public.status_attribute_modifiers (
                game_id varchar(64) NOT NULL,
                status_id varchar(64) NOT NULL,
                group_key varchar(64) NOT NULL,
                modifier_id varchar(64) NOT NULL,
                start_version_id bigint NOT NULL,
                end_version_id bigint NOT NULL,
                attr_key varchar(64) NOT NULL,
                modifier_mode varchar(24) NOT NULL,
                value numeric,
                formula_id varchar(64),
                bucket_key varchar(64),
                per_stack boolean NOT NULL DEFAULT false,
                priority int NOT NULL DEFAULT 0,
                extend jsonb NOT NULL DEFAULT '{}',
                updated_at timestamp NOT NULL DEFAULT NOW(),
                CONSTRAINT pk_status_attribute_modifiers PRIMARY KEY (game_id, status_id, group_key, modifier_id)
            ) PARTITION BY LIST (game_id)
            """
        );
        jdbcTemplate.execute(
            """
            CREATE TABLE IF NOT EXISTS public.status_attribute_modifiers_log (
                game_id varchar(64) NOT NULL,
                status_id varchar(64) NOT NULL,
                group_key varchar(64) NOT NULL,
                modifier_id varchar(64) NOT NULL,
                start_version_id bigint NOT NULL,
                end_version_id bigint NOT NULL,
                attr_key varchar(64) NOT NULL,
                modifier_mode varchar(24) NOT NULL,
                value numeric,
                formula_id varchar(64),
                bucket_key varchar(64),
                per_stack boolean NOT NULL,
                priority int NOT NULL,
                extend jsonb NOT NULL DEFAULT '{}',
                CONSTRAINT pk_status_attribute_modifiers_log PRIMARY KEY (game_id, status_id, group_key, modifier_id, start_version_id)
            ) PARTITION BY LIST (game_id)
            """
        );
        jdbcTemplate.execute(
            """
            CREATE TABLE IF NOT EXISTS public.status_periodic_hp_effects (
                game_id varchar(64) NOT NULL,
                status_id varchar(64) NOT NULL,
                group_key varchar(64) NOT NULL,
                effect_id varchar(64) NOT NULL,
                start_version_id bigint NOT NULL,
                end_version_id bigint NOT NULL,
                effect_kind varchar(16) NOT NULL,
                tick_formula_id varchar(64) NOT NULL,
                damage_type varchar(16),
                can_crit boolean NOT NULL DEFAULT false,
                affected_by_heal_modifier boolean,
                per_stack boolean NOT NULL DEFAULT false,
                extend jsonb NOT NULL DEFAULT '{}',
                updated_at timestamp NOT NULL DEFAULT NOW(),
                CONSTRAINT pk_status_periodic_hp_effects PRIMARY KEY (game_id, status_id, group_key, effect_id)
            ) PARTITION BY LIST (game_id)
            """
        );
        jdbcTemplate.execute(
            """
            CREATE TABLE IF NOT EXISTS public.status_periodic_hp_effects_log (
                game_id varchar(64) NOT NULL,
                status_id varchar(64) NOT NULL,
                group_key varchar(64) NOT NULL,
                effect_id varchar(64) NOT NULL,
                start_version_id bigint NOT NULL,
                end_version_id bigint NOT NULL,
                effect_kind varchar(16) NOT NULL,
                tick_formula_id varchar(64) NOT NULL,
                damage_type varchar(16),
                can_crit boolean NOT NULL,
                affected_by_heal_modifier boolean,
                per_stack boolean NOT NULL,
                extend jsonb NOT NULL DEFAULT '{}',
                CONSTRAINT pk_status_periodic_hp_effects_log PRIMARY KEY (game_id, status_id, group_key, effect_id, start_version_id)
            ) PARTITION BY LIST (game_id)
            """
        );
    }

    private void ensureCoefficientBucketPartitions(String targetGameId) {
        createGamePartition("coefficient_buckets", targetGameId);
        createGamePartition("coefficient_buckets_log", targetGameId);
    }

    private void ensureStatusActionControlRulePartitions(String targetGameId) {
        createGamePartition("status_action_control_rules", targetGameId);
        createGamePartition("status_action_control_rules_log", targetGameId);
    }

    private void ensureStatusResourcePartitions(String targetGameId) {
        createGamePartition("status_definitions", targetGameId);
        createGamePartition("status_definitions_log", targetGameId);
        createGamePartition("control_state_profiles", targetGameId);
        createGamePartition("control_state_profiles_log", targetGameId);
        createGamePartition("status_modifier_groups", targetGameId);
        createGamePartition("status_modifier_groups_log", targetGameId);
        createGamePartition("status_attribute_modifiers", targetGameId);
        createGamePartition("status_attribute_modifiers_log", targetGameId);
        createGamePartition("status_periodic_hp_effects", targetGameId);
        createGamePartition("status_periodic_hp_effects_log", targetGameId);
    }

    private void createGamePartition(String parentTable, String targetGameId) {
        String partitionTable = parentTable + "_" + targetGameId;
        jdbcTemplate.execute(
            "CREATE TABLE IF NOT EXISTS public." + partitionTable
                + " PARTITION OF public." + parentTable
                + " FOR VALUES IN ('" + targetGameId + "')"
        );
    }

    private void publish(String versionCode) {
        ResponseEntity<JsonNode> response = adminExchange(
            "/api/admin/games/" + gameId + "/versions:publish",
            HttpMethod.POST,
            Map.of("versionCode", versionCode)
        );
        assertEquals(HttpStatus.OK, response.getStatusCode());
    }

    private void ensurePublishedSnapshotTable() {
        jdbcTemplate.execute(
            """
            CREATE TABLE IF NOT EXISTS public.published_bundle_snapshots (
                game_id varchar(64) NOT NULL,
                version_id bigint NOT NULL,
                version_code varchar(32) NOT NULL,
                bundle_json jsonb NOT NULL,
                created_at timestamp NOT NULL DEFAULT NOW(),
                updated_at timestamp NOT NULL DEFAULT NOW(),
                CONSTRAINT pk_published_bundle_snapshots PRIMARY KEY (game_id, version_code),
                CONSTRAINT uq_published_bundle_snapshots_version UNIQUE (game_id, version_id)
            )
            """
        );
    }

    private void putBaselineEntities(String heroName) {
        putAttributeDefinition("attack_power");
        putType(1001);
        putTypeRelation(1001, "attribute", "attack_power");
        upsertHero("hero_ahri", heroName);
        putSkill("skill_orb", "hero", "hero_ahri");
        putItem("item_tome", List.of("skill_orb"), List.of("item_tome"));
        putFormulaProfile("formula_magic_damage");
        putFormulaBinding("skill", "skill_orb", "damage_raw", "formula_magic_damage");
    }

    private void putKatarinaMvpEntities() {
        putAttributeDefinition("hp", "生命值", "number", 0, "scalar", null);
        putAttributeDefinition("ad", "攻击力", "number", 0, "scalar", null);
        putAttributeDefinition("ap", "法术强度", "number", 0, "scalar", null);
        putAttributeDefinition("attack_speed", "攻击速度", "number", 0, "scalar", null);
        putAttributeDefinition("armor", "护甲", "number", 0, "scalar", null);
        putAttributeDefinition("magic_resist", "魔法抗性", "number", 0, "scalar", null);
        putAttributeDefinition("ability_haste", "技能极速", "number", 0, "scalar", null);
        putAttributeDefinition("physical_pen", "护甲穿透", "number", 0, "scalar", null);
        putAttributeDefinition("magic_pen", "法术穿透", "number", 0, "scalar", null);
        putAttributeDefinition("hp_regen", "生命回复", "number", 0, "rate", "hp");

        putHero(
            "hero_katarina",
            "卡特琳娜",
            "不祥之刃",
            "hero_katarina.png",
            Map.ofEntries(
                Map.entry("hp", 2508.0),
                Map.entry("ad", 112.4),
                Map.entry("ap", 0.0),
                Map.entry("attack_speed", 0.66),
                Map.entry("armor", 107.9),
                Map.entry("magic_resist", 66.85),
                Map.entry("move_speed", 335.0),
                Map.entry("ability_haste", 0.0),
                Map.entry("physical_pen", 0.0),
                Map.entry("magic_pen", 0.0),
                Map.entry("hp_regen", 0.0)
            ),
            Map.of("level", 18)
        );
        putHero(
            "hero_dummy_10000hp_100ar_100mr",
            "训练假人",
            "10000 HP / 100 AR / 100 MR",
            "hero_dummy.png",
            Map.ofEntries(
                Map.entry("hp", 10000.0),
                Map.entry("ad", 0.0),
                Map.entry("ap", 0.0),
                Map.entry("attack_speed", 0.0),
                Map.entry("armor", 100.0),
                Map.entry("magic_resist", 100.0),
                Map.entry("ability_haste", 0.0),
                Map.entry("physical_pen", 0.0),
                Map.entry("magic_pen", 0.0),
                Map.entry("hp_regen", 0.0)
            ),
            Map.of("role", "target_dummy")
        );

        putSkill(
            "skill_katarina_basic_attack",
            "hero",
            "hero_katarina",
            "A",
            "普通攻击",
            "卡特琳娜最小验证用的平A动作。",
            Map.of(
                "damageType", "physical",
                "attackRatio", 1.0,
                "defaultRepeatCount", 10
            ),
            Map.of(
                "repeatable", true,
                "drivenByAttackSpeed", true
            ),
            Map.of(
                "version", 1,
                "triggers", List.of(
                    Map.of(
                        "id", "basic_attack_hit",
                        "event", Map.of("type", "on_basic_attack_hit"),
                        "actions", List.of(
                            Map.of(
                                "type", "deal_damage",
                                "damage", Map.of(
                                    "source", "self",
                                    "target", "enemy",
                                    "damageType", "physical"
                                )
                            )
                        )
                    )
                )
            )
        );
        putSkill(
            "skill_katarina_r",
            "hero",
            "hero_katarina",
            "R",
            "死亡莲华",
            "在 2.5 秒内对目标造成 15 段魔法伤害。",
            Map.of(
                "damageType", "magic",
                "hitCount", 15,
                "hitIntervalMs", 167,
                "channelDurationMs", 2500,
                "baseDamageBySkillLevel", List.of(25.0, 37.5, 50.0),
                "adRatio", 0.16,
                "apRatio", 0.19,
                "bonusAttackSpeedRatio", 0.5,
                "defaultSkillLevel", 3
            ),
            Map.of(
                "channel", Map.of(
                    "durationMs", 2500,
                    "interruptible", true
                )
            ),
            Map.of(
                "version", 1,
                "triggers", List.of(
                    Map.of(
                        "id", "death_lotus_schedule",
                        "event", Map.of("type", "on_spell_cast"),
                        "actions", List.of(
                            Map.of(
                                "type", "schedule_tick",
                                "tickKey", "katarina_r_hit",
                                "everyMs", 167,
                                "times", 15
                            )
                        )
                    ),
                    Map.of(
                        "id", "death_lotus_hit",
                        "event", Map.of(
                            "type", "on_tick",
                            "tickKey", "katarina_r_hit"
                        ),
                        "actions", List.of(
                            Map.of(
                                "type", "deal_damage",
                                "damage", Map.of(
                                    "source", "self",
                                    "target", "enemy",
                                    "damageType", "magic"
                                )
                            )
                        )
                    )
                )
            )
        );

        putItem(
            "item_blade_of_the_ruined_king",
            "破败王者之刃",
            3200,
            "item_blade_of_the_ruined_king.png",
            Map.of(
                "ad", 55.0,
                "attack_speed", 0.3
            ),
            List.of(),
            List.of()
        );
        putItem(
            "item_nashors_tooth",
            "纳什之牙",
            3000,
            "item_nashors_tooth.png",
            Map.of(
                "ap", 90.0,
                "attack_speed", 0.5,
                "ability_haste", 15.0
            ),
            List.of(),
            List.of()
        );
    }

    private void putAttributeDefinition(String attrKey) {
        putAttributeDefinition(attrKey, attrKey, "number", 0, "scalar", null);
    }

    private void putAttributeDefinition(
        String attrKey,
        String attrName,
        String attrType,
        Number defaultValue,
        String valueKind,
        String rateTargetAttrKey
    ) {
        Map<String, Object> body = new java.util.LinkedHashMap<>();
        body.put("attrName", attrName);
        body.put("attrType", attrType);
        body.put("defaultValue", defaultValue);
        body.put("valueKind", valueKind);
        if (rateTargetAttrKey != null) {
            body.put("rateTargetAttrKey", rateTargetAttrKey);
        }

        ResponseEntity<JsonNode> response = adminExchange(
            "/api/admin/games/" + gameId + "/attribute-definitions/" + attrKey,
            HttpMethod.PUT,
            body
        );
        assertEquals(HttpStatus.OK, response.getStatusCode());
    }

    private void putType(int typeId) {
        putType(typeId, "Mage", "Integration test type");
    }

    private void putType(int typeId, String name, String description) {
        ResponseEntity<JsonNode> response = adminExchange(
            "/api/admin/games/" + gameId + "/types/" + typeId,
            HttpMethod.PUT,
            Map.of(
                "name", name,
                "description", description
            )
        );
        assertEquals(HttpStatus.OK, response.getStatusCode());
    }

    private void putTypeRelation(int typeId, String targetCategory, String targetId) {
        ResponseEntity<JsonNode> response = adminExchange(
            "/api/admin/games/" + gameId + "/type-relations/" + typeId + "/" + targetCategory + "/" + targetId,
            HttpMethod.PUT,
            Map.of("extend", Map.of("source", "it"))
        );
        assertEquals(HttpStatus.OK, response.getStatusCode());
    }

    private void upsertHero(String heroId, String heroName) {
        putHero(
            heroId,
            heroName,
            "Nine-Tailed Fox",
            "hero_ahri.png",
            Map.of("hp", 500),
            Map.of("hp", 80)
        );
    }

    private void putHero(
        String heroId,
        String name,
        String title,
        String avatarUrl,
        Map<String, Object> baseStats,
        Map<String, Object> statsByLevel
    ) {
        ResponseEntity<JsonNode> response = adminExchange(
            "/api/admin/games/" + gameId + "/heroes/" + heroId,
            HttpMethod.PUT,
            Map.of(
                "name", name,
                "title", title,
                "avatarUrl", avatarUrl,
                "baseStats", baseStats,
                "statsByLevel", statsByLevel
            )
        );
        assertEquals(HttpStatus.OK, response.getStatusCode());
    }

    private void putSkill(String skillId, String ownerType, String ownerId) {
        putSkill(
            skillId,
            ownerType,
            ownerId,
            "Q",
            "Orb of Deception",
            "Integration test skill",
            Map.of("baseDamage", 60, "apRatio", 0.4),
            Map.of("cast", Map.of("frontSwingMs", 250)),
            Map.of("version", 1, "triggers", List.of())
        );
    }

    private void putSkill(
        String skillId,
        String ownerType,
        String ownerId,
        String skillKey,
        String name,
        String description,
        Map<String, Object> params,
        Map<String, Object> timingProfile,
        Map<String, Object> mechanicsConfig
    ) {
        ResponseEntity<JsonNode> response = adminExchange(
            "/api/admin/games/" + gameId + "/skills/" + skillId,
            HttpMethod.PUT,
            Map.of(
                "ownerType", ownerType,
                "ownerId", ownerId,
                "skillKey", skillKey,
                "name", name,
                "description", description,
                "resourceCosts", List.of(50),
                "cooldowns", List.of(7),
                "params", params,
                "timingProfile", timingProfile,
                "mechanicsConfig", mechanicsConfig
            )
        );
        assertEquals(HttpStatus.OK, response.getStatusCode());
    }

    private void putItem(String itemId, List<String> skillRefs, List<String> recipeIds) {
        putItem(
            itemId,
            "Amplifying Tome",
            435,
            "item_tome.png",
            Map.of("attack_power", 20),
            skillRefs,
            recipeIds
        );
    }

    private void putItem(
        String itemId,
        String name,
        Integer goldCost,
        String iconUrl,
        Map<String, Object> statsModifier,
        List<String> skillRefs,
        List<String> recipeIds
    ) {
        ResponseEntity<JsonNode> response = adminExchange(
            "/api/admin/games/" + gameId + "/items/" + itemId,
            HttpMethod.PUT,
            Map.of(
                "name", name,
                "goldCost", goldCost,
                "iconUrl", iconUrl,
                "statsModifier", statsModifier,
                "skillRefs", skillRefs,
                "recipeIds", recipeIds
            )
        );
        assertEquals(HttpStatus.OK, response.getStatusCode());
    }

    private void putFormulaProfile(String formulaId) {
        ResponseEntity<JsonNode> response = adminExchange(
            "/api/admin/games/" + gameId + "/formula-profiles/" + formulaId,
            HttpMethod.PUT,
            Map.of(
                "formulaType", "damage",
                "formulaKind", "linear",
                "params", Map.of(
                    "baseVar", "base_damage",
                    "terms", List.of(Map.of("var", "ap", "coef", 0.4))
                ),
                "description", "Integration test formula profile"
            )
        );
        assertEquals(HttpStatus.OK, response.getStatusCode());
    }

    private void putFormulaBinding(String targetCategory, String targetId, String bindingKey, String formulaId) {
        ResponseEntity<JsonNode> response = adminExchange(
            "/api/admin/games/" + gameId + "/formula-bindings/" + targetCategory + "/" + targetId + "/" + bindingKey,
            HttpMethod.PUT,
            Map.of(
                "formulaId", formulaId,
                "overrideParams", Map.of("baseVar", "spell_damage")
            )
        );
        assertEquals(HttpStatus.OK, response.getStatusCode());
    }

    private void putStatusActionControlRule(String ruleId, Map<String, Object> body) {
        ResponseEntity<JsonNode> response = adminExchange(
            "/api/admin/games/" + gameId + "/status-action-control-rules/" + ruleId,
            HttpMethod.PUT,
            body
        );
        assertEquals(HttpStatus.OK, response.getStatusCode());
    }

    private void putCoefficientBucket(String bucketKey, Map<String, Object> body) {
        ResponseEntity<JsonNode> response = adminExchange(
            "/api/admin/games/" + gameId + "/coefficient-buckets/" + bucketKey,
            HttpMethod.PUT,
            body
        );
        assertEquals(HttpStatus.OK, response.getStatusCode());
    }

    private ResponseEntity<JsonNode> getCurrentVersion() {
        return restTemplate.getForEntity("/api/games/" + gameId + "/versions/current", JsonNode.class);
    }

    private ResponseEntity<JsonNode> getBundle(String versionCode) {
        return restTemplate.exchange(
            "/api/games/" + gameId + "/versions/" + versionCode + "/bundle",
            HttpMethod.GET,
            HttpEntity.EMPTY,
            JsonNode.class
        );
    }

    private ResponseEntity<JsonNode> adminExchange(String path, HttpMethod method, Object body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(createAdminJwt());
        HttpEntity<Object> request = new HttpEntity<>(body, headers);
        return restTemplate.exchange(path, method, request, JsonNode.class);
    }

    private String createAdminJwt() {
        long exp = Instant.now().plusSeconds(3600).getEpochSecond();
        try {
            JWTClaimsSet claimsSet = new JWTClaimsSet.Builder()
                .claim("email", "it-admin@example.com")
                .claim("canEdit", true)
                .claim("paid", true)
                .claim("exp", exp)
                .build();
            SignedJWT signedJWT = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.ES256).type(JOSEObjectType.JWT).build(),
                claimsSet
            );
            JWSSigner signer = new ECDSASigner(TEST_PRIVATE_KEY);
            signedJWT.sign(signer);
            return signedJWT.serialize();
        } catch (Exception ex) {
            throw new IllegalStateException("Unable to sign JWT for integration test", ex);
        }
    }

    private JsonNode requireBody(ResponseEntity<JsonNode> response) {
        assertNotNull(response.getBody());
        return response.getBody();
    }

    private boolean containsByField(JsonNode arrayNode, String fieldName, String expectedValue) {
        if (arrayNode == null || !arrayNode.isArray()) {
            return false;
        }
        for (JsonNode node : arrayNode) {
            if (expectedValue.equals(node.path(fieldName).asText())) {
                return true;
            }
        }
        return false;
    }

    private JsonNode findByField(JsonNode arrayNode, String fieldName, String expectedValue) {
        if (arrayNode == null || !arrayNode.isArray()) {
            throw new AssertionError("Expected array for field lookup: " + fieldName);
        }
        for (JsonNode node : arrayNode) {
            if (expectedValue.equals(node.path(fieldName).asText())) {
                return node;
            }
        }
        throw new AssertionError("Cannot find item where " + fieldName + "=" + expectedValue);
    }

    private boolean containsFormulaBinding(JsonNode arrayNode, String targetCategory, String targetId, String bindingKey) {
        if (arrayNode == null || !arrayNode.isArray()) {
            return false;
        }
        for (JsonNode node : arrayNode) {
            if (targetCategory.equals(node.path("targetCategory").asText())
                && targetId.equals(node.path("targetId").asText())
                && bindingKey.equals(node.path("bindingKey").asText())) {
                return true;
            }
        }
        return false;
    }

    private JsonNode findFormulaBinding(JsonNode arrayNode, String targetCategory, String targetId, String bindingKey) {
        if (arrayNode == null || !arrayNode.isArray()) {
            throw new AssertionError("Expected array for formula binding lookup");
        }
        for (JsonNode node : arrayNode) {
            if (targetCategory.equals(node.path("targetCategory").asText())
                && targetId.equals(node.path("targetId").asText())
                && bindingKey.equals(node.path("bindingKey").asText())) {
                return node;
            }
        }
        throw new AssertionError(
            "Cannot find formula binding where targetCategory=" + targetCategory + ", targetId=" + targetId + ", bindingKey=" + bindingKey
        );
    }

    private String generateGameId() {
        String timestamp = GAME_ID_TIME_FORMATTER.format(Instant.now());
        int suffix = ThreadLocalRandom.current().nextInt(1000, 10_000);
        return "it_" + timestamp + "_" + suffix;
    }

    private static KeyPair generateEcKeyPair() {
        try {
            KeyPairGenerator keyPairGenerator = KeyPairGenerator.getInstance("EC");
            keyPairGenerator.initialize(new ECGenParameterSpec("secp256r1"));
            return keyPairGenerator.generateKeyPair();
        } catch (Exception ex) {
            throw new IllegalStateException("Unable to generate EC key pair for integration test", ex);
        }
    }

    private static String toPublicKeyPem(ECPublicKey publicKey) {
        String base64 = Base64.getMimeEncoder(64, "\n".getBytes()).encodeToString(publicKey.getEncoded());
        return "-----BEGIN PUBLIC KEY-----\n" + base64 + "\n-----END PUBLIC KEY-----";
    }
}
