import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.yaml.snakeyaml.Yaml;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;

/**
 * 只读、独立的状态种类迁移回读；不执行迁移 SQL，不执行 DDL，不写业务表。
 */
class IndependentStatusKindReadback {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Path CONFIG = Path.of("server/data_manage/src/main/resources/application.yml");
    private static final Path JOURNAL = Path.of("output/status-kind-preflight/migration-attempt.jsonl");
    private static final Path REPORT = Path.of("output/status-kind-preflight/independent-readback.json");
    private static int selectCount;

    private static String sha(List<Map<String, Object>> rows) throws Exception {
        byte[] bytes = JSON.writeValueAsBytes(rows);
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    private static String resolve(Object raw) {
        String value = String.valueOf(raw);
        if (!value.startsWith("${") || !value.endsWith("}")) return value;
        String inner = value.substring(2, value.length() - 1);
        int colon = inner.indexOf(':');
        String name = colon < 0 ? inner : inner.substring(0, colon);
        String fallback = colon < 0 ? "" : inner.substring(colon + 1);
        return System.getenv().getOrDefault(name, fallback);
    }

    private static List<Map<String, Object>> query(Connection connection, String sql) throws Exception {
        if (!sql.stripLeading().toLowerCase(Locale.ROOT).startsWith("select")) {
            throw new IllegalArgumentException("non-SELECT statement rejected");
        }
        selectCount++;
        List<Map<String, Object>> rows = new ArrayList<>();
        try (PreparedStatement statement = connection.prepareStatement(sql);
             ResultSet result = statement.executeQuery()) {
            var metadata = result.getMetaData();
            while (result.next()) {
                Map<String, Object> row = new LinkedHashMap<>();
                for (int i = 1; i <= metadata.getColumnCount(); i++) {
                    row.put(metadata.getColumnLabel(i), result.getString(i));
                }
                rows.add(row);
            }
        }
        return rows;
    }

    private static ArrayNode rowsAsJson(List<Map<String, Object>> rows) {
        ArrayNode result = JSON.createArrayNode();
        for (Map<String, Object> row : rows) result.add(JSON.valueToTree(row));
        return result;
    }

    private static ArrayNode bodyRowsAsJson(List<Map<String, Object>> rows) throws Exception {
        ArrayNode result = JSON.createArrayNode();
        for (Map<String, Object> row : rows) result.add(JSON.readTree(String.valueOf(row.get("body"))));
        return result;
    }

    private static ArrayNode journalBodyRows(JsonNode detail, String key) throws Exception {
        ArrayNode result = JSON.createArrayNode();
        for (JsonNode row : detail.path(key)) result.add(JSON.readTree(row.path("body").asText()));
        return result;
    }

    private static Map<String, JsonNode> readJournal() throws Exception {
        Map<String, JsonNode> details = new LinkedHashMap<>();
        for (String line : Files.readAllLines(JOURNAL, StandardCharsets.UTF_8)) {
            if (line.isBlank()) continue;
            JsonNode entry = JSON.readTree(line);
            String stage = entry.path("stage").asText();
            if (details.put(stage, entry.path("detail")) != null) {
                throw new IllegalStateException("duplicate journal stage: " + stage);
            }
        }
        return details;
    }

    private static void addCheck(List<Map<String, Object>> checks, String name, boolean pass, String detail) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("name", name);
        row.put("status", pass ? "PASS" : "DIFF");
        row.put("detail", detail);
        checks.add(row);
    }

    private static JsonNode findRow(ArrayNode rows, String key, String value) {
        for (JsonNode row : rows) {
            if (value.equals(row.path(key).asText())) return row;
        }
        return null;
    }

    private static String envOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }

    private static String connectionTarget(String url) {
        URI uri = URI.create(url.substring("jdbc:".length()));
        return uri.getHost() + ":" + uri.getPort() + uri.getPath();
    }

    private static void writeReport(Map<String, Object> report) throws Exception {
        Files.writeString(REPORT, JSON.writerWithDefaultPrettyPrinter().writeValueAsString(report) + "\n",
                StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
    }

    public static void main(String[] args) throws Exception {
        Map<String, Object> report = new LinkedHashMap<>();
        List<Map<String, Object>> checks = new ArrayList<>();
        Connection connection = null;
        boolean rolledBack = false;
        String failureType = null;
        String failureSqlState = null;
        try {
            Class.forName("org.postgresql.Driver");
            Map<?, ?> config;
            try (var input = Files.newInputStream(CONFIG)) {
                config = new Yaml().load(input);
            }
            Map<?, ?> spring = (Map<?, ?>) config.get("spring");
            Map<?, ?> datasource = (Map<?, ?>) spring.get("datasource");
            String url = envOr("SPRING_DATASOURCE_URL", resolve(datasource.get("url")));
            String user = envOr("SPRING_DATASOURCE_USERNAME", resolve(datasource.get("username")));
            String password = envOr("SPRING_DATASOURCE_PASSWORD", resolve(datasource.get("password")));
            URI uri = URI.create(url.substring("jdbc:".length()));
            if (!"192.168.5.6".equals(uri.getHost()) || uri.getPort() != 5432 || !"/test0221".equals(uri.getPath())) {
                throw new IllegalStateException("target mismatch: " + connectionTarget(url));
            }

            Properties properties = new Properties();
            properties.setProperty("user", user);
            properties.setProperty("password", password);
            properties.setProperty("connectTimeout", "10");
            properties.setProperty("socketTimeout", "60");
            connection = DriverManager.getConnection(url, properties);
            connection.setReadOnly(true);
            connection.setAutoCommit(false);

            List<Map<String, Object>> database = query(connection, "SELECT current_database() AS name");
            List<Map<String, Object>> tables = query(connection,
                    "SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                            + "WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relispartition ORDER BY c.relname");
            List<Map<String, Object>> statuses = query(connection,
                    "SELECT to_jsonb(s)::text AS body FROM public.statuses s ORDER BY game_id,status_key");
            List<Map<String, Object>> columns = query(connection,
                    "SELECT column_name,is_nullable,column_default FROM information_schema.columns "
                            + "WHERE table_schema='public' AND table_name='statuses' ORDER BY ordinal_position");
            List<Map<String, Object>> statusReferences = query(connection,
                    "SELECT to_jsonb(r)::text AS body FROM public.skill_object_references r "
                            + "WHERE target_type='STATUS' ORDER BY game_id,source_skill_key,source_type,source_key,field_path");
            List<Map<String, Object>> skillEffects = query(connection,
                    "SELECT to_jsonb(t)::text AS body FROM public.skill_effects t ORDER BY to_jsonb(t)::text");
            List<Map<String, Object>> skillObjectReferences = query(connection,
                    "SELECT to_jsonb(t)::text AS body FROM public.skill_object_references t ORDER BY to_jsonb(t)::text");
            List<Map<String, Object>> constraints = query(connection,
                    "SELECT conname AS name, pg_get_constraintdef(oid, true) AS definition "
                            + "FROM pg_constraint WHERE conrelid='public.statuses'::regclass AND contype='c' ORDER BY conname");
            List<Map<String, Object>> readOnlyState = query(connection,
                    "SELECT current_setting('transaction_read_only') AS value");

            Map<String, JsonNode> journal = readJournal();
            JsonNode before = journal.get("READ_ONLY_BEFORE");
            JsonNode immediate = journal.get("IMMEDIATE_READBACK_PASS");
            if (before == null || immediate == null) throw new IllegalStateException("journal baseline missing");

            ArrayNode actualTables = rowsAsJson(tables);
            ArrayNode actualStatuses = bodyRowsAsJson(statuses);
            ArrayNode actualColumns = rowsAsJson(columns);
            ArrayNode actualStatusReferences = bodyRowsAsJson(statusReferences);
            ArrayNode actualConstraints = rowsAsJson(constraints);
            ArrayNode beforeStatuses = journalBodyRows(before, "statuses");
            ArrayNode beforeStatusReferences = journalBodyRows(before, "statusReferences");
            ArrayNode immediateStatusReferences = journalBodyRows(immediate, "statusReferences");
            String effectsSha = sha(skillEffects);
            String referencesSha = sha(skillObjectReferences);

            boolean tablesUnchanged = actualTables.equals(before.path("tables"))
                    && actualTables.equals(immediate.path("tables")) && actualTables.size() == 27;
            addCheck(checks, "27逻辑表名单未变", tablesUnchanged,
                    "actual=" + actualTables.size() + ", before=" + before.path("tables").size()
                            + ", immediate=" + immediate.path("tables").size());

            JsonNode statusKindColumn = findRow(actualColumns, "column_name", "status_kind");
            boolean statusKindShape = statusKindColumn != null
                    && "NO".equals(statusKindColumn.path("is_nullable").asText())
                    && statusKindColumn.path("column_default").isNull();
            addCheck(checks, "status_kind非空且无默认值", statusKindShape,
                    statusKindColumn == null ? "missing" : statusKindColumn.toString());

            boolean kindConstraint = false;
            for (JsonNode constraint : actualConstraints) {
                String name = constraint.path("name").asText();
                String definition = constraint.path("definition").asText().replaceAll("\\s+", " ").toUpperCase(Locale.ROOT);
                if ("CK_STATUSES_KIND".equals(name.toUpperCase(Locale.ROOT))
                        && definition.contains("CHECK") && definition.contains("STATUS_KIND")
                        && definition.contains("'STUN'") && definition.contains("'MOVEMENT_SLOW'")) {
                    kindConstraint = true;
                    break;
                }
            }
            addCheck(checks, "status_kind枚举约束", kindConstraint, actualConstraints.toString());

            int vertigoCount = 0;
            boolean vertigoIsStun = false;
            for (JsonNode status : actualStatuses) {
                if ("lol".equals(status.path("game_id").asText())
                        && "vertigo".equals(status.path("status_key").asText())) {
                    vertigoCount++;
                    vertigoIsStun = "STUN".equals(status.path("status_kind").asText());
                }
            }
            boolean uniqueVertigo = vertigoCount == 1 && vertigoIsStun && actualStatuses.size() == 1;
            addCheck(checks, "唯一lol/vertigo为STUN", uniqueVertigo,
                    "matching=" + vertigoCount + ", totalStatuses=" + actualStatuses.size());

            ArrayNode oldStatuses = JSON.createArrayNode();
            for (JsonNode status : actualStatuses) {
                ObjectNode old = (ObjectNode) status.deepCopy();
                old.remove("status_kind");
                oldStatuses.add(old);
            }
            boolean oldStatusFields = oldStatuses.equals(beforeStatuses);
            addCheck(checks, "旧字段与时间戳完全不变", oldStatusFields,
                    "currentWithoutKind=" + oldStatuses.size() + ", baseline=" + beforeStatuses.size());

            boolean refsUnchanged = actualStatusReferences.equals(beforeStatusReferences)
                    && actualStatusReferences.equals(immediateStatusReferences);
            addCheck(checks, "STATUS引用完整不变", refsUnchanged,
                    "actual=" + actualStatusReferences.size() + ", baseline=" + beforeStatusReferences.size());

            int expectedEffectRows = before.path("skill_effects").path("rows").asInt(-1);
            int expectedReferenceRows = before.path("skill_object_references").path("rows").asInt(-1);
            String expectedEffectSha = before.path("skill_effects").path("sha256").asText();
            String expectedReferenceSha = before.path("skill_object_references").path("sha256").asText();
            boolean effectsUnchanged = skillEffects.size() == expectedEffectRows
                    && effectsSha.equals(expectedEffectSha)
                    && effectsSha.equals(immediate.path("skill_effects").path("sha256").asText());
            boolean referencesUnchanged = skillObjectReferences.size() == expectedReferenceRows
                    && referencesSha.equals(expectedReferenceSha)
                    && referencesSha.equals(immediate.path("skill_object_references").path("sha256").asText());
            addCheck(checks, "skill_effects行数与排序JSON哈希不变", effectsUnchanged,
                    "rows=" + skillEffects.size() + ", sha256=" + effectsSha);
            addCheck(checks, "skill_object_references行数与排序JSON哈希不变", referencesUnchanged,
                    "rows=" + skillObjectReferences.size() + ", sha256=" + referencesSha);

            boolean readOnly = !readOnlyState.isEmpty() && "on".equalsIgnoreCase(String.valueOf(readOnlyState.get(0).get("value")));
            addCheck(checks, "只读事务", readOnly, readOnlyState.toString());

            report.put("status", checks.stream().allMatch(row -> "PASS".equals(row.get("status"))) ? "PASS" : "DIFF");
            report.put("target", "192.168.5.6:5432/test0221");
            report.put("database", database.isEmpty() ? "" : database.get(0).get("name"));
            report.put("selectCount", selectCount);
            report.put("checks", checks);
            report.put("sha256", Map.of("skill_effects", effectsSha, "skill_object_references", referencesSha));
            report.put("journalStages", journal.keySet());
        } catch (Exception error) {
            failureType = error.getClass().getSimpleName();
            failureSqlState = error instanceof SQLException sql ? sql.getSQLState() : "none";
            report.put("status", "ERROR");
            report.put("target", "192.168.5.6:5432/test0221");
            report.put("selectCount", selectCount);
            report.put("errorType", failureType);
            report.put("sqlState", failureSqlState);
        } finally {
            if (connection != null) {
                try {
                    connection.rollback();
                    rolledBack = true;
                } finally {
                    connection.close();
                }
            }
            report.put("rolledBack", rolledBack);
            report.put("reportPath", REPORT.toString());
            writeReport(report);
        }

        System.out.println("statusKindIndependentReadback=" + report.get("status")
                + " selectCount=" + selectCount + " rolledBack=" + rolledBack
                + " report=" + REPORT + " sha256=" + report.getOrDefault("sha256", "unavailable"));
        if (!"PASS".equals(report.get("status"))) System.exit(2);
    }
}
