import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.InputStream;
import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;
import javax.sql.DataSource;
import org.springframework.core.Ordered;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.yaml.snakeyaml.Yaml;
import xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard;
import xyz.game.datamanage.support.error.ApiException;

/** 固定开发库的通用吸血规则一次性迁移。准备和回查只读；应用必须绑定冻结档案与脚本摘要。 */
class ApplyGameVampRules {
    private static final ObjectMapper JSON = new ObjectMapper().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);
    private static final String DATABASE = "test0221";
    private static final String HOST = "192.168.5.6";
    private static final String FORMAT = "game-vamp-rules-migration-v1";
    private static final Path SQL = Path.of("db/game_manage/migrations/game_vamp_rules.sql");
    private static final Path SOURCE = Path.of("tools/authoring/ApplyGameVampRules.java");
    private static final Path OUTPUT = Path.of("output/game-vamp-rules");
    private static final Set<String> BEFORE_TABLES = Set.of(
        "games", "attributes", "game_level_configs", "characters", "character_attributes", "equipment", "equipment_attributes",
        "skill_categories", "skills", "skill_category_relations", "skill_parameters", "skill_formulas", "damage_types",
        "modifier_zones", "statuses", "skill_effects", "skill_internal_states", "skill_processes", "skill_trigger_rules",
        "images", "character_skill_relations", "equipment_skill_relations", "image_relations", "skill_object_references",
        "runes", "rune_paths", "rune_skill_relations");
    private static final Pattern OLD_REFERENCE = Pattern.compile(
        "^results\\[[0-9]+\\]\\.detail\\.vampRules\\[[0-9]+\\]\\.efficiencyValue\\.(formulaKey|parameterKey)$");
    private static final String EFFECTS = "SELECT to_jsonb(e)::text FROM public.skill_effects e ORDER BY game_id,skill_key,effect_key";
    private static final String REFERENCES = "SELECT to_jsonb(r)::text FROM public.skill_object_references r ORDER BY game_id,source_skill_key,source_type,source_key,field_path,target_type,target_skill_key,target_key,target_sub_key";
    private static final String TRIGGERS = "SELECT to_jsonb(t)::text FROM public.skill_trigger_rules t ORDER BY game_id,skill_key,rule_key";
    private static final String TABLES = "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relispartition ORDER BY c.relname";

    public static void main(String[] args) {
        try { run(args); }
        catch (Exception error) {
            // 绝不输出连接串、配置、SQL异常正文、异常链或堆栈。
            String reason = error instanceof Failure failure ? failure.code : "UNEXPECTED_FAILURE";
            System.err.println("gameVampMigration=FAILED reason=" + reason + " errorType=" + error.getClass().getSimpleName()
                + " sqlState=" + sqlState(error) + "; use --check and inspect the existing attempt journal before further action");
            System.exit(1);
        }
    }

    private static void run(String[] args) throws Exception {
        require(args.length >= 2, "USAGE_ROOT_MODE_REQUIRED");
        Path root = Path.of(args[0]).toAbsolutePath().normalize();
        require(Files.isRegularFile(root.resolve(SOURCE)), "BACKEND_ROOT_INVALID");
        String mode = args[1];
        require((mode.equals("--prepare") && (args.length == 2 || args.length == 3))
            || (mode.equals("--apply") && args.length == 5) || (mode.equals("--check") && args.length == 4), "USAGE_INVALID");
        byte[] sql = Files.readAllBytes(root.resolve(SQL));
        String sqlSha = sha(sql);
        String toolSha = sha(Files.readAllBytes(root.resolve(SOURCE)));
        if (mode.equals("--prepare")) {
            Path archive = args.length == 3 ? Path.of(args[2]).toAbsolutePath().normalize()
                : root.resolve(OUTPUT).resolve("prepared-" + Instant.now().toString().replace(':', '-') + "-" + UUID.randomUUID() + ".json");
            require(!Files.exists(archive), "ARCHIVE_ALREADY_EXISTS");
            DataSource ds = dataSource(root);
            ObjectNode before = readOnlySnapshot(ds);
            require(tableNames(before).equals(new TreeSet<>(BEFORE_TABLES)), "PREPARE_REQUIRES_OLD_SCHEMA");
            ObjectNode expected = expected(before);
            List<String> blockers = priorHealingDependencies(before);
            ObjectNode archiveBody = JSON.createObjectNode();
            archiveBody.put("format", FORMAT).put("preparedAt", Instant.now().toString())
                .put("database", DATABASE).put("sqlSha256", sqlSha).put("toolSha256", toolSha)
                .put("backendClassesSha256", classesSha(root));
            archiveBody.set("before", before);
            archiveBody.set("expectedEffects", expected.path("effects"));
            archiveBody.set("expectedReferences", expected.path("references"));
            archiveBody.set("blockingPriorHealingPaths", JSON.valueToTree(blockers));
            archiveBody.put("eligible", blockers.isEmpty());
            byte[] bytes = JSON.writerWithDefaultPrettyPrinter().writeValueAsBytes(archiveBody);
            writeNew(archive, bytes);
            System.out.println("gameVampMigration=PREPARED database=" + DATABASE + " eligible=" + blockers.isEmpty()
                + " damageResults=" + damageCount(before.path("effects")) + " blockers=" + blockers.size()
                + " archive=" + archive + " archiveSha256=" + sha(bytes) + " sqlSha256=" + sqlSha);
            return;
        }
        Path archive = Path.of(args[2]).toAbsolutePath().normalize();
        require(args[3].matches("[0-9a-f]{64}"), "ARCHIVE_SHA_REQUIRED");
        byte[] bytes = Files.readAllBytes(archive);
        require(sha(bytes).equals(args[3]), "ARCHIVE_SHA_MISMATCH");
        JsonNode frozen = JSON.readTree(bytes);
        require(FORMAT.equals(frozen.path("format").asText()) && DATABASE.equals(frozen.path("database").asText()), "ARCHIVE_TARGET_INVALID");
        ObjectNode before = (ObjectNode) frozen.path("before");
        require(tableNames(before).equals(new TreeSet<>(BEFORE_TABLES)), "ARCHIVE_TABLES_INVALID");
        ObjectNode expected = expected(before);
        require(same(expected.path("effects"), frozen.path("expectedEffects"))
            && same(expected.path("references"), frozen.path("expectedReferences")), "ARCHIVE_EXPECTED_VALUES_INVALID");
        DataSource ds = dataSource(root);
        if (mode.equals("--check")) {
            // 不注册保护器、不重建引用、不创建临时表或尝试流水，也不写本地档案。
            ObjectNode actual = readOnlySnapshot(ds);
            boolean old = tableNames(actual).equals(new TreeSet<>(BEFORE_TABLES));
            if (old) require(same(before, actual), "CHECK_OLD_STATE_DRIFT"); else assertAfter(before, expected, actual);
            System.out.println("gameVampMigration=CHECK_PASS database=" + DATABASE + " state=" + (old ? "UNCHANGED" : "MIGRATED")
                + " damageResults=" + damageCount(actual.path("effects")) + " archiveSha256=" + args[3]);
            return;
        }
        require(args[4].matches("[0-9a-f]{64}") && sqlSha.equals(args[4])
            && sqlSha.equals(frozen.path("sqlSha256").asText()), "SQL_SHA_MISMATCH");
        require(toolSha.equals(frozen.path("toolSha256").asText()), "TOOL_CHANGED_AFTER_PREPARE");
        require(classesSha(root).equals(frozen.path("backendClassesSha256").asText()), "BACKEND_CLASSES_CHANGED_AFTER_PREPARE");
        require(frozen.path("eligible").asBoolean(false) && priorHealingDependencies(before).isEmpty(), "PRIOR_HEALING_DEPENDENCIES_BLOCK_MIGRATION");
        apply(root, ds, sql, before, expected, archive, args[3], sqlSha, toolSha);
    }

    private static void apply(Path root, DataSource ds, byte[] sql, ObjectNode before, ObjectNode expected,
                              Path archive, String archiveSha, String sqlSha, String toolSha) throws Exception {
        Path journal = root.resolve(OUTPUT).resolve("migration-attempt.jsonl");
        Files.createDirectories(journal.getParent());
        Files.createFile(journal); // 固定目标 + CREATE_NEW：任何旧尝试均禁止重放。
        append(journal, "STARTED", Map.of("attemptId", UUID.randomUUID().toString(), "database", DATABASE,
            "archive", archive.toString(), "archiveSha256", archiveSha, "sqlSha256", sqlSha, "toolSha256", toolSha));
        AtomicBoolean submitted = new AtomicBoolean();
        AtomicInteger completion = new AtomicInteger(TransactionSynchronization.STATUS_UNKNOWN);
        JdbcTemplate jdbc = new JdbcTemplate(ds);
        TransactionTemplate tx = new TransactionTemplate(new DataSourceTransactionManager(ds));
        tx.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        tx.setTimeout(180);
        try {
            tx.executeWithoutResult(status -> {
                jdbc.execute("SET LOCAL lock_timeout = '10s'");
                jdbc.execute("SET LOCAL statement_timeout = '120s'");
                require(DATABASE.equals(jdbc.queryForObject("SELECT current_database()", String.class)), "CONNECTED_DATABASE_INVALID");
                // 锁定全部现有业务表，保障前值比对到提交之间所有非目标行（包括图片和时间戳）不漂移。
                jdbc.execute("LOCK TABLE " + String.join(",", BEFORE_TABLES.stream().sorted().map(t -> "public." + t).toList())
                    + " IN SHARE ROW EXCLUSIVE MODE");
                GameConfigurationWriteGuard guard = new GameConfigurationWriteGuard(jdbc);
                for (String game : jdbc.queryForList("SELECT game_id FROM public.games ORDER BY game_id", String.class)) guard.begin(game);
                ObjectNode current = jdbc.execute((Connection connection) -> snapshot(connection));
                require(same(before, current), "LOCKED_BEFORE_STATE_DRIFT");
                append(journal, "LOCKED_PREVALUES_MATCHED", summary(current));
                jdbc.execute("CREATE TEMP TABLE vamp_migration_archive (LIKE public.skill_effects INCLUDING DEFAULTS) ON COMMIT DROP");
                for (JsonNode effect : before.path("effects")) if (hasDamage(effect)) {
                    require(jdbc.update("INSERT INTO pg_temp.vamp_migration_archive SELECT (jsonb_populate_record(NULL::public.skill_effects, ?::jsonb)).*",
                        effect.toString()) == 1, "TEMP_ARCHIVE_INSERT_FAILED");
                }
                append(journal, "SQL_SUBMITTED", Map.of("sqlSha256", sqlSha));
                submitted.set(true);
                jdbc.execute(new String(sql, StandardCharsets.UTF_8));
                append(journal, "SQL_RETURNED", Map.of("scriptExecutions", 1));
                // 守卫已经注册；相同最低优先级按注册顺序执行。确认本检查排在最后，
                // 保证比较的是守卫校验并重建引用之后、实际 COMMIT 之前的最终状态。
                TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                    @Override public int getOrder() { return Ordered.LOWEST_PRECEDENCE; }
                    @Override public void beforeCommit(boolean readOnly) {
                        require(!readOnly && TransactionSynchronizationManager.getSynchronizations().getLast() == this,
                            "FINAL_CHECK_ORDER_INVALID");
                        ObjectNode after = jdbc.execute((Connection connection) -> snapshot(connection));
                        assertAfter(before, expected, after);
                        append(journal, "FINAL_GUARD_AND_COMPARE_PASSED", summary(after));
                    }
                    @Override public void afterCompletion(int state) { completion.set(state); }
                });
            });
            append(journal, "COMMIT_RETURNED", Map.of("transactionCompletion", completion.get()));
            ObjectNode readback = readOnlySnapshot(ds); // 新连接、只读一致性快照，绝不复用已提交连接。
            assertAfter(before, expected, readback);
            Path evidence = root.resolve(OUTPUT).resolve("independent-readback-" + UUID.randomUUID() + ".json");
            writeNew(evidence, JSON.writerWithDefaultPrettyPrinter().writeValueAsBytes(readback));
            append(journal, "INDEPENDENT_READBACK_PASSED", Map.of("file", evidence.toString(), "summary", summary(readback)));
            System.out.println("gameVampMigration=APPLY_PASS database=" + DATABASE + " scriptExecutions=1 independentReadback=passed journal=" + journal);
        } catch (Exception error) {
            String stage = completion.get() == TransactionSynchronization.STATUS_ROLLED_BACK ? "ROLLED_BACK"
                : submitted.get() ? "REQUIRES_READONLY_RECOVERY" : "PREWRITE_FAILED";
            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("errorType", error.getClass().getSimpleName()); detail.put("sqlState", sqlState(error));
            detail.put("reason", error instanceof Failure failure ? failure.code : "UNEXPECTED_FAILURE");
            if (error instanceof ApiException api) { detail.put("code", api.getCode()); detail.put("fieldIssues", api.getDetails()); }
            try { append(journal, stage, detail); } catch (RuntimeException ignored) { /* 已有尝试文件仍阻止重放。 */ }
            throw error;
        }
    }

    private static ObjectNode readOnlySnapshot(DataSource ds) throws SQLException {
        try (Connection connection = ds.getConnection()) {
            connection.setReadOnly(true);
            connection.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
            connection.setAutoCommit(false);
            try {
                try (Statement statement = connection.createStatement(); ResultSet result = statement.executeQuery("SHOW transaction_read_only")) {
                    require(result.next() && "on".equals(result.getString(1)), "READ_ONLY_TRANSACTION_REQUIRED");
                }
                ObjectNode result = snapshot(connection);
                connection.rollback(); // 结束只读快照；从不提交写事务。
                return result;
            } catch (Exception error) {
                try { connection.rollback(); } catch (SQLException ignored) { }
                throw error;
            }
        }
    }

    private static ObjectNode snapshot(Connection connection) throws SQLException {
        ObjectNode result = JSON.createObjectNode();
        List<String> tables = strings(connection, TABLES);
        TreeSet<String> allowed = new TreeSet<>(BEFORE_TABLES); allowed.add("game_vamp_rules");
        require(allowed.containsAll(tables), "UNEXPECTED_PUBLIC_TABLE");
        result.set("tables", JSON.valueToTree(tables));
        require(strings(connection, "SELECT current_database()").equals(List.of(DATABASE)), "CONNECTED_DATABASE_INVALID");
        ObjectNode data = result.putObject("data");
        ObjectNode schemas = result.putObject("schemas");
        for (String table : tables) {
            data.set(table, digestQuery(connection, "SELECT to_jsonb(t)::text FROM public." + table + " t"));
            ObjectNode schema = schemas.putObject(table);
            schema.set("columns", rows(connection, "SELECT to_jsonb(c)::text FROM (SELECT column_name,data_type,udt_name,is_nullable,column_default,ordinal_position FROM information_schema.columns WHERE table_schema='public' AND table_name='" + table + "' ORDER BY ordinal_position) c"));
            schema.set("constraints", rows(connection, "SELECT to_jsonb(c)::text FROM (SELECT conname,contype,convalidated,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public." + table + "'::regclass ORDER BY conname) c"));
            schema.set("indexes", rows(connection, "SELECT to_jsonb(i)::text FROM (SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='" + table + "' ORDER BY indexname) i"));
        }
        result.set("effects", rows(connection, EFFECTS));
        result.set("references", rows(connection, REFERENCES));
        result.set("triggers", rows(connection, TRIGGERS));
        return result;
    }

    private static ObjectNode expected(ObjectNode before) {
        ObjectNode expected = before.deepCopy();
        for (JsonNode effect : expected.path("effects")) for (JsonNode result : effect.path("results")) {
            if (!"DAMAGE".equals(result.path("resultType").asText())) continue;
            JsonNode raw = result.path("detail");
            require(raw.isObject() && raw.path("vampRules").isArray() && !raw.has("vampQualification") && !raw.has("vampOverrides"), "OLD_DAMAGE_SHAPE_INVALID");
            ObjectNode detail = (ObjectNode) raw;
            detail.remove("vampRules"); detail.put("vampQualification", "UNRESOLVED"); detail.putArray("vampOverrides");
        }
        ArrayNode references = expected.putArray("references");
        for (JsonNode reference : before.path("references")) {
            if (!"EFFECT".equals(reference.path("source_type").asText()) || !OLD_REFERENCE.matcher(reference.path("field_path").asText()).matches()) {
                references.add(reference.deepCopy());
            }
        }
        ((ObjectNode) expected.path("data")).set("skill_effects", digestRows(expected.path("effects")));
        ((ObjectNode) expected.path("data")).set("skill_object_references", digestRows(references));
        return expected;
    }

    private static void assertAfter(ObjectNode before, ObjectNode expected, ObjectNode actual) {
        TreeSet<String> tables = new TreeSet<>(BEFORE_TABLES); tables.add("game_vamp_rules");
        require(tableNames(actual).equals(tables), "AFTER_TABLE_SET_INVALID");
        for (String table : BEFORE_TABLES) {
            require(same(before.path("schemas").path(table), actual.path("schemas").path(table)), "EXISTING_SCHEMA_CHANGED_" + table);
            require(same(expected.path("data").path(table), actual.path("data").path(table)), "TABLE_DATA_CHANGED_" + table);
        }
        require(same(expected.path("effects"), actual.path("effects")), "EFFECT_TRANSFORMATION_MISMATCH");
        require(same(expected.path("references"), actual.path("references")), "REFERENCE_TRANSFORMATION_MISMATCH");
        require(same(before.path("triggers"), actual.path("triggers")), "TRIGGER_CHANGED");
        require(actual.path("data").path("game_vamp_rules").path("rows").asLong(-1) == 0, "MIGRATION_MUST_NOT_ENABLE_RULES");
        Set<String> columns = new TreeSet<>();
        for (JsonNode column : actual.path("schemas").path("game_vamp_rules").path("columns")) {
            require(columns.add(column.path("column_name").asText()), "NEW_RULE_COLUMN_DUPLICATED");
            require("NO".equals(column.path("is_nullable").asText()), "NEW_RULE_COLUMN_NULLABLE");
        }
        require(columns.equals(Set.of("game_id", "vamp_type", "source_attribute_key", "basis_output_kind", "default_efficiency", "delivery_kinds", "origin_kinds", "skill_category_keys")), "NEW_RULE_COLUMNS_INVALID");
        Set<String> constraints = new TreeSet<>();
        Set<String> notNullConstraints = new TreeSet<>();
        Map<String, String> expectedNotNull = new LinkedHashMap<>();
        for (String column : columns) expectedNotNull.put("game_vamp_rules_" + column + "_not_null", "NOT NULL " + column);
        for (JsonNode constraint : actual.path("schemas").path("game_vamp_rules").path("constraints")) {
            require(constraint.path("convalidated").asBoolean(false), "NEW_CONSTRAINT_UNVALIDATED");
            String name = constraint.path("conname").asText();
            String type = constraint.path("contype").asText();
            if ("n".equals(type)) {
                require(expectedNotNull.containsKey(name)
                    && expectedNotNull.get(name).equals(constraint.path("definition").asText())
                    && notNullConstraints.add(name), "NEW_RULE_NOT_NULL_CONSTRAINT_INVALID");
            } else {
                String expectedType = name.startsWith("pk_") ? "p" : name.startsWith("fk_") ? "f" : "c";
                require(Set.of("p", "f", "c").contains(type) && expectedType.equals(type)
                    && constraints.add(name), "NEW_RULE_CONSTRAINT_TYPE_INVALID");
            }
        }
        require(notNullConstraints.equals(expectedNotNull.keySet()), "NEW_RULE_NOT_NULL_CONSTRAINTS_MISSING");
        require(constraints.equals(Set.of("pk_game_vamp_rules", "fk_game_vamp_rules_game", "fk_game_vamp_rules_attribute",
            "ck_game_vamp_rules_type", "ck_game_vamp_rules_basis", "ck_game_vamp_rules_efficiency", "ck_game_vamp_rules_delivery",
            "ck_game_vamp_rules_origin", "ck_game_vamp_rules_categories")), "NEW_RULE_CONSTRAINTS_INVALID");
    }

    private static List<String> priorHealingDependencies(ObjectNode snapshot) {
        Map<String, JsonNode> effects = new LinkedHashMap<>();
        for (JsonNode effect : snapshot.path("effects")) effects.put(key(effect, "game_id", "skill_key", "effect_key"), effect);
        List<String> paths = new ArrayList<>();
        for (JsonNode trigger : snapshot.path("triggers")) {
            Map<String, JsonNode> actions = new LinkedHashMap<>();
            for (JsonNode action : trigger.path("actions")) actions.put(action.path("actionKey").asText(), action);
            for (JsonNode action : trigger.path("actions")) for (JsonNode binding : action.path("runtimeInputBindings")) {
                JsonNode detail = binding.path("detail");
                if (!"PRIOR_ACTION_RESULT".equals(binding.path("sourceType").asText()) || !"ACTUAL_HEALING".equals(detail.path("outputKind").asText())) continue;
                JsonNode source = actions.get(detail.path("sourceActionKey").asText());
                if (source == null) continue;
                JsonNode effect = effects.get(key(trigger, "game_id", "skill_key") + "/" + source.path("detail").path("effectKey").asText());
                if (effect == null) continue;
                for (JsonNode result : effect.path("results")) if ("DAMAGE".equals(result.path("resultType").asText())
                    && result.path("resultKey").asText().equals(detail.path("sourceResultKey").asText())) {
                    paths.add(key(trigger, "game_id", "skill_key", "rule_key") + "/actions/" + action.path("actionKey").asText()
                        + "/runtimeInputBindings/" + binding.path("bindingKey").asText());
                }
            }
        }
        return paths.stream().sorted().toList();
    }

    private static DataSource dataSource(Path root) throws Exception {
        Map<?, ?> config;
        try (InputStream input = Files.newInputStream(root.resolve("server/data_manage/src/main/resources/application.yml"))) { config = new Yaml().load(input); }
        Map<?, ?> datasource = (Map<?, ?>) ((Map<?, ?>) config.get("spring")).get("datasource");
        String url = System.getenv().getOrDefault("SPRING_DATASOURCE_URL", resolve(datasource.get("url")));
        require(url.startsWith("jdbc:postgresql:"), "JDBC_TYPE_INVALID");
        URI uri = URI.create(url.substring(5));
        require("postgresql".equals(uri.getScheme()) && HOST.equals(uri.getHost()) && uri.getPort() == 5432
            && ("/" + DATABASE).equals(uri.getPath()) && uri.getUserInfo() == null && uri.getQuery() == null && uri.getFragment() == null, "DATASOURCE_TARGET_INVALID");
        DriverManagerDataSource result = new DriverManagerDataSource(url,
            System.getenv().getOrDefault("SPRING_DATASOURCE_USERNAME", resolve(datasource.get("username"))),
            System.getenv().getOrDefault("SPRING_DATASOURCE_PASSWORD", resolve(datasource.get("password"))));
        java.util.Properties properties = new java.util.Properties();
        properties.setProperty("connectTimeout", "10"); properties.setProperty("socketTimeout", "180");
        properties.setProperty("ApplicationName", "game-vamp-rules-migration"); result.setConnectionProperties(properties);
        return result;
    }

    private static String resolve(Object raw) {
        require(raw instanceof String, "DATASOURCE_VALUE_MISSING");
        String value = (String) raw;
        if (!value.startsWith("${") || !value.endsWith("}")) return value;
        String inner = value.substring(2, value.length() - 1); int split = inner.indexOf(':');
        return System.getenv().getOrDefault(split < 0 ? inner : inner.substring(0, split), split < 0 ? "" : inner.substring(split + 1));
    }

    private static ArrayNode rows(Connection connection, String sql) throws SQLException {
        ArrayNode rows = JSON.createArrayNode();
        try (Statement statement = connection.createStatement(); ResultSet result = statement.executeQuery(sql)) {
            while (result.next()) rows.add(parse(result.getString(1)));
        }
        return rows;
    }

    private static List<String> strings(Connection connection, String sql) throws SQLException {
        List<String> rows = new ArrayList<>();
        try (Statement statement = connection.createStatement(); ResultSet result = statement.executeQuery(sql)) {
            while (result.next()) rows.add(result.getString(1));
        }
        return rows;
    }

    private static ObjectNode digestQuery(Connection connection, String sql) throws SQLException {
        List<String> hashes = new ArrayList<>();
        try (Statement statement = connection.createStatement(); ResultSet result = statement.executeQuery(sql)) {
            while (result.next()) hashes.add(sha(canonicalBytes(parse(result.getString(1)))));
        }
        return digestHashes(hashes);
    }

    private static ObjectNode digestRows(JsonNode rows) {
        List<String> hashes = new ArrayList<>();
        for (JsonNode row : rows) hashes.add(sha(canonicalBytes(row)));
        return digestHashes(hashes);
    }

    private static ObjectNode digestHashes(List<String> hashes) {
        hashes.sort(Comparator.naturalOrder());
        ObjectNode result = JSON.createObjectNode();
        return result.put("rows", hashes.size()).put("sha256", sha((String.join("\n", hashes) + "\n").getBytes(StandardCharsets.UTF_8)));
    }

    private static JsonNode normalized(JsonNode node) {
        if (node.isObject()) {
            ObjectNode result = JSON.createObjectNode();
            TreeSet<String> keys = new TreeSet<>(); node.fieldNames().forEachRemaining(keys::add);
            for (String key : keys) result.set(key, normalized(node.get(key)));
            return result;
        }
        if (node.isArray()) { ArrayNode result = JSON.createArrayNode(); for (JsonNode value : node) result.add(normalized(value)); return result; }
        if (node.isNumber()) return JSON.getNodeFactory().numberNode(node.decimalValue().stripTrailingZeros());
        return node;
    }

    private static byte[] canonicalBytes(JsonNode node) {
        try { return JSON.writeValueAsBytes(normalized(node)); } catch (Exception error) { throw new Failure("CANONICAL_JSON_FAILED"); }
    }
    private static boolean same(JsonNode left, JsonNode right) { return java.util.Arrays.equals(canonicalBytes(left), canonicalBytes(right)); }
    private static JsonNode parse(String value) { try { return JSON.readTree(value); } catch (Exception error) { throw new Failure("JSON_PARSE_FAILED"); } }
    private static String key(JsonNode row, String... fields) { return String.join("/", java.util.Arrays.stream(fields).map(field -> row.path(field).asText()).toList()); }
    private static boolean hasDamage(JsonNode effect) { for (JsonNode result : effect.path("results")) if ("DAMAGE".equals(result.path("resultType").asText())) return true; return false; }
    private static int damageCount(JsonNode effects) { int count = 0; for (JsonNode effect : effects) for (JsonNode result : effect.path("results")) if ("DAMAGE".equals(result.path("resultType").asText())) count++; return count; }
    private static TreeSet<String> tableNames(JsonNode snapshot) { TreeSet<String> names = new TreeSet<>(); for (JsonNode table : snapshot.path("tables")) names.add(table.asText()); return names; }
    private static Map<String, Object> summary(ObjectNode snapshot) { return Map.of("tables", snapshot.path("tables").size(), "effects", snapshot.path("effects").size(), "damageResults", damageCount(snapshot.path("effects")), "references", snapshot.path("references").size(), "data", snapshot.path("data")); }

    private static String classesSha(Path root) throws Exception {
        Path classes = root.resolve("server/data_manage/target/classes").toRealPath();
        Path loaded = Path.of(GameConfigurationWriteGuard.class.getProtectionDomain().getCodeSource().getLocation().toURI()).toRealPath();
        require(loaded.equals(classes), "VALIDATOR_CLASSPATH_INVALID");
        List<String> entries = new ArrayList<>();
        try (var files = Files.walk(classes)) {
            for (Path file : files.filter(p -> p.toString().endsWith(".class")).sorted().toList()) {
                entries.add(classes.relativize(file).toString().replace('\\', '/') + ":" + sha(Files.readAllBytes(file)));
            }
        }
        require(!entries.isEmpty(), "BACKEND_CLASSES_MISSING");
        return sha(String.join("\n", entries).getBytes(StandardCharsets.UTF_8));
    }

    private static String sha(byte[] bytes) { try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); } catch (Exception error) { throw new Failure("SHA256_UNAVAILABLE"); } }
    private static void require(boolean condition, String code) { if (!condition) throw new Failure(code); }
    private static final class Failure extends RuntimeException { final String code; Failure(String code) { super(code); this.code = code; } }
    private static String sqlState(Throwable error) { for (Throwable current = error; current != null; current = current.getCause()) if (current instanceof SQLException sql) return sql.getSQLState(); return "none"; }
    private static void writeNew(Path path, byte[] bytes) throws Exception {
        Files.createDirectories(path.getParent());
        try (FileChannel channel = FileChannel.open(path, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
            ByteBuffer buffer = ByteBuffer.wrap(bytes); while (buffer.hasRemaining()) channel.write(buffer); channel.force(true);
        }
    }
    private static void append(Path journal, String stage, Object detail) {
        try {
            byte[] bytes = (JSON.writeValueAsString(Map.of("at", Instant.now().toString(), "stage", stage, "detail", detail)) + "\n").getBytes(StandardCharsets.UTF_8);
            try (FileChannel channel = FileChannel.open(journal, StandardOpenOption.WRITE, StandardOpenOption.APPEND)) {
                ByteBuffer buffer = ByteBuffer.wrap(bytes); while (buffer.hasRemaining()) channel.write(buffer); channel.force(true);
            }
        } catch (Exception error) { throw new Failure("JOURNAL_WRITE_FAILED"); }
    }
}
