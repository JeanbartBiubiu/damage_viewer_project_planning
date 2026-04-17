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
        out.println("  heroes      = " + seedData.heroes().size());
        out.println("  skills      = " + seedData.skills().size());
        out.println("  items       = " + seedData.items().size());
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
        upsert(httpClient, options.apiBaseUrl(), adminToken, gameId, "/heroes/", "heroId", seedData.heroes());
        upsert(httpClient, options.apiBaseUrl(), adminToken, gameId, "/skills/", "skillId", seedData.skills());
        upsert(httpClient, options.apiBaseUrl(), adminToken, gameId, "/items/", "itemId", seedData.items());

        if (!options.publish()) {
            out.println("Import finished without publish.");
            return;
        }

        JsonNode publishResponse = requestJson(
            httpClient,
            buildUri(options.apiBaseUrl(), "/api/admin/games/" + encodeSegment(gameId) + "/versions:publish"),
            "POST",
            adminToken,
            OBJECT_MAPPER.createObjectNode().put("versionCode", versionCode)
        );
        out.println("Published versionCode=" + publishResponse.path("versionCode").asText(versionCode));

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
            readObjectArray(root, "heroes"),
            readObjectArray(root, "skills"),
            readObjectArray(root, "items"),
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
            String entityId = requireText(entity, idField);
            requestJson(
                httpClient,
                buildUri(apiBaseUrl, "/api/admin/games/" + encodeSegment(gameId) + pathPrefix + encodeSegment(entityId)),
                "PUT",
                adminToken,
                entity
            );
        }
    }

    private static void verifyPublishedResult(
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
        verifySize(bundleResponse.path("attributeDefinitions"), seedData.attributeDefinitions().size(), "attributeDefinitions");
        verifySize(bundleResponse.path("heroes"), seedData.heroes().size(), "heroes");
        verifySize(bundleResponse.path("skills"), seedData.skills().size(), "skills");
        verifySize(bundleResponse.path("items"), seedData.items().size(), "items");
    }

    private static void verifySize(JsonNode arrayNode, int expectedSize, String fieldName) {
        if (!arrayNode.isArray()) {
            throw new IllegalStateException("bundle field `" + fieldName + "` is not array");
        }
        if (arrayNode.size() != expectedSize) {
            throw new IllegalStateException(
                "bundle field `" + fieldName + "` size mismatch. expected=" + expectedSize + ", actual=" + arrayNode.size()
            );
        }
    }

    private static JsonNode requestJson(
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
        if (response.statusCode() / 100 != 2) {
            throw new IllegalStateException(
                "HTTP " + method + " " + uri + " failed: status=" + response.statusCode() + ", body=" + response.body()
            );
        }
        if (response.body() == null || response.body().isBlank()) {
            return OBJECT_MAPPER.createObjectNode();
        }
        return OBJECT_MAPPER.readTree(response.body());
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

    record SeedData(
        String gameId,
        String versionCode,
        List<ObjectNode> ownerCategories,
        List<ObjectNode> attributeDefinitions,
        List<ObjectNode> heroes,
        List<ObjectNode> skills,
        List<ObjectNode> items,
        List<ObjectNode> scenarios
    ) {
    }
}
