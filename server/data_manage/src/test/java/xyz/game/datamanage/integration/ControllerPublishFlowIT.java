package xyz.game.datamanage.integration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
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

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("it")
@EnabledIfEnvironmentVariable(named = "IT_DB_URL", matches = ".+")
@EnabledIfEnvironmentVariable(named = "IT_DB_USERNAME", matches = ".+")
@EnabledIfEnvironmentVariable(named = "IT_ADMIN_JWT_SECRET", matches = ".+")
class ControllerPublishFlowIT {

    private static final int IT_GAME_DATA_THRESHOLD = 128;
    private static final int SAMPLE_GAME_ID_LIMIT = 10;
    private static final DateTimeFormatter GAME_ID_TIME_FORMATTER =
        DateTimeFormatter.ofPattern("yyyyMMddHHmmss").withZone(ZoneOffset.UTC);

    @Autowired
    private TestRestTemplate restTemplate;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Value("${app.auth.jwt.hs256-secret}")
    private String jwtSecret;

    private String gameId;

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
        long versionId = createVersion("1.0.0");
        putBaselineEntities("Ahri");

        publish(versionId);

        ResponseEntity<JsonNode> currentResponse = getCurrentVersion();
        assertEquals(HttpStatus.OK, currentResponse.getStatusCode());
        JsonNode current = requireBody(currentResponse);
        assertEquals(versionId, current.path("versionId").asLong());
        assertFalse(current.path("dataHash").asText().isBlank());

        ResponseEntity<JsonNode> bundleResponse = getBundle(versionId, null);
        assertEquals(HttpStatus.OK, bundleResponse.getStatusCode());
        assertNotNull(bundleResponse.getHeaders().getETag());
        JsonNode bundle = requireBody(bundleResponse);
        assertEquals(versionId, bundle.path("meta").path("versionId").asLong());
        assertEquals(current.path("dataHash").asText(), bundle.path("meta").path("dataHash").asText());
        assertTrue(containsByField(bundle.path("attributeDefinitions"), "attrKey", "attack_power"));
        assertTrue(containsByField(bundle.path("types"), "typeId", "1001"));
        assertTrue(containsByField(bundle.path("typeRelations"), "targetId", "attack_power"));
        assertTrue(containsByField(bundle.path("heroes"), "heroId", "hero_ahri"));
        assertTrue(containsByField(bundle.path("skills"), "skillId", "skill_orb"));
        assertTrue(containsByField(bundle.path("items"), "itemId", "item_tome"));
    }

    @Test
    void bundle_ifNoneMatch_shouldReturn304() {
        long versionId = createVersion("1.0.0");
        putBaselineEntities("Ahri");
        publish(versionId);

        ResponseEntity<JsonNode> firstBundle = getBundle(versionId, null);
        assertEquals(HttpStatus.OK, firstBundle.getStatusCode());
        String etag = firstBundle.getHeaders().getETag();
        assertNotNull(etag);

        ResponseEntity<JsonNode> secondBundle = getBundle(versionId, etag);
        assertEquals(HttpStatus.NOT_MODIFIED, secondBundle.getStatusCode());
        assertEquals(etag, secondBundle.getHeaders().getETag());
        assertNull(secondBundle.getBody());
    }

    @Test
    void prePublishChanges_shouldNotAffectCurrentAndCachedBundle_untilPublish() {
        long versionV1 = createVersion("1.0.0");
        putBaselineEntities("Ahri");
        publish(versionV1);

        JsonNode currentV1 = requireBody(getCurrentVersion());
        String currentDataHashV1 = currentV1.path("dataHash").asText();
        ResponseEntity<JsonNode> bundleV1Response = getBundle(versionV1, null);
        String etagV1 = bundleV1Response.getHeaders().getETag();
        JsonNode bundleV1 = requireBody(bundleV1Response);
        assertEquals("Ahri", findByField(bundleV1.path("heroes"), "heroId", "hero_ahri").path("name").asText());

        long versionV2 = createVersion("1.0.1");
        upsertHero("hero_ahri", "Ahri Rework");

        JsonNode currentBeforePublishV2 = requireBody(getCurrentVersion());
        assertEquals(versionV1, currentBeforePublishV2.path("versionId").asLong());
        assertEquals(currentDataHashV1, currentBeforePublishV2.path("dataHash").asText());

        JsonNode bundleBeforePublishV2 = requireBody(getBundle(versionV1, null));
        assertEquals("Ahri", findByField(bundleBeforePublishV2.path("heroes"), "heroId", "hero_ahri").path("name").asText());

        ResponseEntity<JsonNode> notFoundBundle = getBundle(versionV2, null);
        assertEquals(HttpStatus.NOT_FOUND, notFoundBundle.getStatusCode());

        publish(versionV2);

        JsonNode currentV2 = requireBody(getCurrentVersion());
        assertEquals(versionV2, currentV2.path("versionId").asLong());
        assertNotEquals(currentDataHashV1, currentV2.path("dataHash").asText());

        ResponseEntity<JsonNode> bundleV2Response = getBundle(versionV2, null);
        assertEquals(HttpStatus.OK, bundleV2Response.getStatusCode());
        JsonNode bundleV2 = requireBody(bundleV2Response);
        assertEquals("Ahri Rework", findByField(bundleV2.path("heroes"), "heroId", "hero_ahri").path("name").asText());
        assertNotEquals(etagV1, bundleV2Response.getHeaders().getETag());
    }

    private void seedGame(String targetGameId) {
        jdbcTemplate.update(
            "INSERT INTO public.games (game_id, game_name, game_img_url) VALUES (?, ?, ?) ON CONFLICT (game_id) DO NOTHING",
            targetGameId,
            "IT " + targetGameId,
            null
        );
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

    private long createVersion(String versionCode) {
        ResponseEntity<JsonNode> response = adminExchange(
            "/api/admin/games/" + gameId + "/versions",
            HttpMethod.POST,
            Map.of("versionCode", versionCode)
        );
        assertEquals(HttpStatus.OK, response.getStatusCode());
        return requireBody(response).path("versionId").asLong();
    }

    private void publish(long versionId) {
        ResponseEntity<JsonNode> response = adminExchange(
            "/api/admin/games/" + gameId + "/versions/" + versionId + ":publish",
            HttpMethod.POST,
            null
        );
        assertEquals(HttpStatus.OK, response.getStatusCode());
    }

    private void putBaselineEntities(String heroName) {
        putAttributeDefinition("attack_power");
        putType(1001);
        putTypeRelation(1001, "attribute", "attack_power");
        upsertHero("hero_ahri", heroName);
        putSkill("skill_orb", "hero", "hero_ahri");
        putItem("item_tome", List.of("skill_orb"), List.of("item_tome"));
    }

    private void putAttributeDefinition(String attrKey) {
        ResponseEntity<JsonNode> response = adminExchange(
            "/api/admin/games/" + gameId + "/attribute-definitions/" + attrKey,
            HttpMethod.PUT,
            Map.of(
                "attrName", "Attack Power",
                "attrType", "number",
                "defaultValue", 0
            )
        );
        assertEquals(HttpStatus.OK, response.getStatusCode());
    }

    private void putType(int typeId) {
        ResponseEntity<JsonNode> response = adminExchange(
            "/api/admin/games/" + gameId + "/types/" + typeId,
            HttpMethod.PUT,
            Map.of(
                "name", "Mage",
                "description", "Integration test type"
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
        ResponseEntity<JsonNode> response = adminExchange(
            "/api/admin/games/" + gameId + "/heroes/" + heroId,
            HttpMethod.PUT,
            Map.of(
                "name", heroName,
                "title", "Nine-Tailed Fox",
                "avatarUrl", "hero_ahri.png",
                "baseStats", Map.of("hp", 500),
                "statsByLevel", Map.of("hp", 80)
            )
        );
        assertEquals(HttpStatus.OK, response.getStatusCode());
    }

    private void putSkill(String skillId, String ownerType, String ownerId) {
        ResponseEntity<JsonNode> response = adminExchange(
            "/api/admin/games/" + gameId + "/skills/" + skillId,
            HttpMethod.PUT,
            Map.of(
                "ownerType", ownerType,
                "ownerId", ownerId,
                "skillKey", "Q",
                "name", "Orb of Deception",
                "description", "Integration test skill",
                "resourceCosts", List.of(50),
                "cooldowns", List.of(7),
                "mechanicsConfig", Map.of(
                    "version", 1,
                    "triggers", List.of()
                )
            )
        );
        assertEquals(HttpStatus.OK, response.getStatusCode());
    }

    private void putItem(String itemId, List<String> skillRefs, List<String> recipeIds) {
        ResponseEntity<JsonNode> response = adminExchange(
            "/api/admin/games/" + gameId + "/items/" + itemId,
            HttpMethod.PUT,
            Map.of(
                "name", "Amplifying Tome",
                "goldCost", 435,
                "iconUrl", "item_tome.png",
                "statsModifier", Map.of("attack_power", 20),
                "skillRefs", skillRefs,
                "recipeIds", recipeIds
            )
        );
        assertEquals(HttpStatus.OK, response.getStatusCode());
    }

    private ResponseEntity<JsonNode> getCurrentVersion() {
        return restTemplate.getForEntity("/api/games/" + gameId + "/versions/current", JsonNode.class);
    }

    private ResponseEntity<JsonNode> getBundle(long versionId, String ifNoneMatch) {
        HttpHeaders headers = new HttpHeaders();
        if (ifNoneMatch != null && !ifNoneMatch.isBlank()) {
            headers.set(HttpHeaders.IF_NONE_MATCH, ifNoneMatch);
        }
        return restTemplate.exchange(
            "/api/games/" + gameId + "/versions/" + versionId + "/bundle",
            HttpMethod.GET,
            new HttpEntity<>(headers),
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
        String header = base64Url("{\"alg\":\"HS256\",\"typ\":\"JWT\"}");
        String payload = base64Url(
            "{\"email\":\"it-admin@example.com\",\"canEdit\":true,\"exp\":" + exp + "}"
        );
        String signingInput = header + "." + payload;
        return signingInput + "." + base64Url(hmacSha256(signingInput, jwtSecret));
    }

    private byte[] hmacSha256(String content, String secret) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return mac.doFinal(content.getBytes(StandardCharsets.UTF_8));
        } catch (Exception ex) {
            throw new IllegalStateException("Unable to sign JWT for integration test", ex);
        }
    }

    private String base64Url(String value) {
        return base64Url(value.getBytes(StandardCharsets.UTF_8));
    }

    private String base64Url(byte[] value) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
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

    private String generateGameId() {
        String timestamp = GAME_ID_TIME_FORMATTER.format(Instant.now());
        int suffix = ThreadLocalRandom.current().nextInt(1000, 10_000);
        return "it_" + timestamp + "_" + suffix;
    }
}
