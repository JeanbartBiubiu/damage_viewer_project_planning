import java.io.InputStream;
import java.net.URI;
import java.nio.file.*;
import java.security.MessageDigest;
import java.sql.*;
import java.time.Instant;
import java.util.*;
import org.yaml.snakeyaml.Yaml;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.*;

/** 独立审查后的一次性约束迁移；凭据仅用于本地连接，不写入流水。 */
public class ApplyHealingRatioMax {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Path SQL = Path.of("db/game_manage/migrations/healing_ratio_max.sql");
    private static final Set<String> CHANGED = Set.of("ck_modifier_zones_calculation_mode", "ck_modifier_zones_combination");

    public static void main(String[] args) {
        boolean commitAttempted = false;
        boolean committed = false;
        Path journal = null;
        try {
            require(args.length == 3 && Set.of("apply", "verify").contains(args[0]), "ARGUMENTS_INVALID");
            Path frozenPath = Path.of(args[1]);
            JsonNode before = JSON.readTree(Files.readString(frozenPath));
            String sql = Files.readString(SQL);
            String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(SQL)));
            require(hash.equals(before.path("migrationSha256").asText()), "SQL_HASH_CHANGED");
            require("192.168.5.6".equals(before.path("host").asText()) && before.path("port").asInt() == 5432, "FROZEN_TARGET_INVALID");
            if ("verify".equals(args[0])) {
                try (Connection c = connect()) {
                    c.setReadOnly(true); c.setAutoCommit(false);
                    c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
                    JsonNode after = snapshot(c);
                    verifyAfter(before, after, sql);
                    c.rollback();
                    Files.writeString(Path.of(args[2]), JSON.writerWithDefaultPrettyPrinter().writeValueAsString(after), StandardOpenOption.CREATE_NEW);
                }
                System.out.println("INDEPENDENT_VERIFY_OK protectedTables=3 constraintsChanged=2");
                return;
            }
            journal = Path.of(args[2]);
            require(!Files.exists(journal), "JOURNAL_EXISTS_NO_REPLAY");
            ObjectNode started = JSON.createObjectNode().put("at", Instant.now().toString()).put("state", "STARTED")
                .put("database", "test0221").put("sqlSha256", hash).put("frozenSnapshot", frozenPath.toString());
            Files.writeString(journal, started + "\n", StandardOpenOption.CREATE_NEW);
            require(sql.split("(?m)^BEGIN;\\r?$", -1).length == 2 && sql.split("(?m)^COMMIT;\\r?$", -1).length == 2, "SQL_WRAPPER_INVALID");
            String body = sql.replaceFirst("(?m)^BEGIN;\\r?\\n", "").replaceFirst("(?m)^COMMIT;\\r?\\n?", "");
            int preflight = body.indexOf("DO $preflight$");
            require(preflight > 0, "SQL_PREFLIGHT_MISSING");
            try (Connection c = connect()) {
                c.setAutoCommit(false); c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
                try {
                    execute(c, body.substring(0, preflight)); // 同一事务先取得脚本中的全部锁，再比冻结前值。
                    JsonNode locked = snapshot(c);
                    verifyTarget(before, locked);
                    for (String field : List.of("constraints", "columns", "indexes", "protectedRows")) {
                        require(before.path(field).equals(locked.path(field)), "FROZEN_STATE_CHANGED_" + field);
                    }
                    execute(c, body);
                    JsonNode after = snapshot(c);
                    verifyAfter(before, after, sql);
                    append(journal, "PRECOMMIT_VERIFIED", null);
                    commitAttempted = true;
                    c.commit();
                    committed = true;
                    append(journal, "COMMITTED", null);
                } catch (Exception failure) {
                    if (!commitAttempted) {
                        c.rollback();
                        append(journal, "ROLLED_BACK", failure.getClass().getSimpleName());
                    }
                    throw failure;
                }
            }
            try (Connection independent = connect()) {
                independent.setReadOnly(true); independent.setAutoCommit(false);
                independent.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
                verifyAfter(before, snapshot(independent), sql);
                independent.rollback();
            }
            append(journal, "INDEPENDENT_VERIFIED", null);
            System.out.println("APPLY_AND_INDEPENDENT_VERIFY_OK database=test0221 protectedTables=3 constraintsChanged=2");
        } catch (Exception failure) {
            if (journal != null && Files.exists(journal) && commitAttempted) {
                try { append(journal, committed ? "COMMITTED_VERIFY_PENDING" : "COMMIT_UNCERTAIN", failure.getClass().getSimpleName()); }
                catch (Exception ignored) { }
            }
            System.err.println("MIGRATION_FAILED class=" + failure.getClass().getSimpleName()
                + (failure instanceof IllegalStateException && failure.getMessage() != null && failure.getMessage().matches("[A-Za-z_]+") ? " code=" + failure.getMessage() : "")
                + (failure instanceof SQLException sql ? " sqlState=" + sql.getSQLState() : "")
                + " commitAttempted=" + commitAttempted + " committed=" + committed);
            System.exit(1);
        }
    }

    private static void append(Path journal, String state, String errorClass) throws Exception {
        ObjectNode row = JSON.createObjectNode().put("at", Instant.now().toString()).put("state", state);
        if (errorClass != null) row.put("errorClass", errorClass);
        Files.writeString(journal, row + "\n", StandardOpenOption.APPEND);
    }

    private static void execute(Connection c, String sql) throws SQLException {
        try (Statement statement = c.createStatement()) {
            boolean result = statement.execute(sql);
            while (result || statement.getUpdateCount() != -1) result = statement.getMoreResults(Statement.CLOSE_CURRENT_RESULT);
        }
    }

    private static String between(String sql, String marker) {
        int start = sql.indexOf(marker), end = start < 0 ? -1 : sql.indexOf(marker, start + marker.length());
        require(start >= 0 && end > start, "SQL_EXPECTATION_MISSING");
        return sql.substring(start + marker.length(), end);
    }

    private static void verifyTarget(JsonNode before, JsonNode current) {
        require("test0221".equals(current.path("target").path(0).path("database").asText()), "DATABASE_MISMATCH");
        require(before.path("target").path(0).path("user").equals(current.path("target").path(0).path("user")), "DATABASE_USER_CHANGED");
    }

    private static void verifyAfter(JsonNode before, JsonNode after, String sql) {
        verifyTarget(before, after);
        for (String field : List.of("columns", "indexes", "protectedRows")) require(before.path(field).equals(after.path(field)), "UNEXPECTED_CHANGE_" + field);
        require(before.path("constraints").size() == after.path("constraints").size(), "CONSTRAINT_COUNT_CHANGED");
        Map<String, JsonNode> current = new HashMap<>();
        after.path("constraints").forEach(row -> current.put(row.path("name").asText(), row));
        for (JsonNode row : before.path("constraints")) {
            String name = row.path("name").asText();
            if (!CHANGED.contains(name)) require(row.equals(current.get(name)), "OTHER_CONSTRAINT_CHANGED");
        }
        for (String name : CHANGED) {
            JsonNode row = current.get(name);
            String expected = between(sql, name.endsWith("calculation_mode") ? "$new_mode$" : "$new_comb$");
            require(row != null && row.path("validated").asBoolean() && expected.equals(row.path("definition").asText()), "NEW_CONSTRAINT_INVALID");
        }
    }

    private static ObjectNode snapshot(Connection c) throws Exception {
        ObjectNode out = JSON.createObjectNode();
        out.set("target", rows(c, "select jsonb_build_object('database',current_database(),'user',current_user,'readOnly',current_setting('transaction_read_only'))::text"));
        out.set("constraints", rows(c, "select jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid),'validated',convalidated)::text from pg_constraint where conrelid='public.modifier_zones'::regclass order by conname"));
        out.set("columns", rows(c, "select jsonb_build_object('name',column_name,'type',data_type,'length',character_maximum_length,'nullable',is_nullable,'default',column_default)::text from information_schema.columns where table_schema='public' and table_name='modifier_zones' order by ordinal_position"));
        out.set("indexes", rows(c, "select jsonb_build_object('name',indexname,'definition',indexdef)::text from pg_indexes where schemaname='public' and tablename='modifier_zones' order by indexname"));
        ObjectNode protectedRows = out.putObject("protectedRows");
        for (String table : List.of("modifier_zones", "skill_effects", "skill_object_references")) {
            protectedRows.set(table, rows(c, "select jsonb_build_object('count',count(*),'md5',md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')))::text from public." + table + " t").get(0));
        }
        return out;
    }

    private static ArrayNode rows(Connection c, String sql) throws Exception {
        ArrayNode out = JSON.createArrayNode();
        try (Statement statement = c.createStatement(); ResultSet rs = statement.executeQuery(sql)) {
            while (rs.next()) out.add(JSON.readTree(rs.getString(1)));
        }
        return out;
    }

    private static Connection connect() throws Exception {
        Map<?, ?> config;
        try (InputStream input = Files.newInputStream(Path.of("server/data_manage/src/main/resources/application.yml"))) { config = new Yaml().load(input); }
        Map<?, ?> ds = (Map<?, ?>) ((Map<?, ?>) config.get("spring")).get("datasource");
        String url = System.getenv().getOrDefault("SPRING_DATASOURCE_URL", resolve(ds.get("url")));
        require(url.startsWith("jdbc:postgresql:"), "JDBC_TYPE_INVALID");
        URI uri = URI.create(url.substring(5));
        require("192.168.5.6".equals(uri.getHost()) && uri.getPort() == 5432 && "/test0221".equals(uri.getPath())
            && uri.getUserInfo() == null && uri.getQuery() == null && uri.getFragment() == null, "DATASOURCE_TARGET_INVALID");
        Properties props = new Properties();
        props.setProperty("user", System.getenv().getOrDefault("SPRING_DATASOURCE_USERNAME", resolve(ds.get("username"))));
        props.setProperty("password", System.getenv().getOrDefault("SPRING_DATASOURCE_PASSWORD", resolve(ds.get("password"))));
        props.setProperty("connectTimeout", "10"); props.setProperty("socketTimeout", "90");
        props.setProperty("ApplicationName", "healing-ratio-max-migration");
        return DriverManager.getConnection(url, props);
    }

    private static String resolve(Object raw) {
        require(raw instanceof String, "DATASOURCE_VALUE_MISSING");
        String value = (String) raw;
        if (!value.startsWith("${") || !value.endsWith("}")) return value;
        String inner = value.substring(2, value.length() - 1); int split = inner.indexOf(':');
        return System.getenv().getOrDefault(split < 0 ? inner : inner.substring(0, split), split < 0 ? "" : inner.substring(split + 1));
    }

    private static void require(boolean value, String code) { if (!value) throw new IllegalStateException(code); }
}
