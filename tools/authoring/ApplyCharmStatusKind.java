import java.nio.file.*;
import java.nio.channels.FileChannel;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.net.URI;
import java.security.MessageDigest;
import java.sql.*;
import java.util.*;
import org.yaml.snakeyaml.Yaml;
import com.fasterxml.jackson.databind.ObjectMapper;

/** 仅执行独立审查通过的魅惑状态约束增量；固定日志拒绝任何重放。 */
class ApplyCharmStatusKind {
    static final String APPROVED_SQL_SHA256 = "0832b2f0464fa586604b68741b5414baeab77c592a544b2d2587da5b9e837c72";
    static final Path SQL = Path.of("db/game_manage/migrations/add_charm_status_kind.sql");
    static final Path JOURNAL = Path.of("output/charm-status-preflight/migration-attempt.jsonl");
    static final ObjectMapper JSON = new ObjectMapper();
    static String resolve(Object raw) {
        String v = String.valueOf(raw);
        if (!v.startsWith("${") || !v.endsWith("}")) return v;
        String inner = v.substring(2, v.length() - 1); int i = inner.indexOf(':');
        return System.getenv().getOrDefault(i < 0 ? inner : inner.substring(0, i), i < 0 ? "" : inner.substring(i + 1));
    }
    static String sha(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }
    static void record(String stage, Object detail) throws Exception {
        byte[] bytes = (JSON.writeValueAsString(Map.of("at", java.time.Instant.now().toString(), "stage", stage, "detail", detail)) + "\n").getBytes(StandardCharsets.UTF_8);
        try (var file = FileChannel.open(JOURNAL, StandardOpenOption.WRITE, StandardOpenOption.APPEND)) {
            var buffer = ByteBuffer.wrap(bytes); while (buffer.hasRemaining()) file.write(buffer); file.force(true);
        }
    }
    static List<Map<String, Object>> query(Connection c, String sql) throws Exception {
        var rows = new ArrayList<Map<String, Object>>();
        try (var s = c.createStatement(); var r = s.executeQuery(sql)) {
            var m = r.getMetaData();
            while (r.next()) { var row = new LinkedHashMap<String, Object>();
                for (int i = 1; i <= m.getColumnCount(); i++) row.put(m.getColumnLabel(i), r.getString(i));
                rows.add(row);
            }
        }
        return rows;
    }
    static Map<String, Object> snapshot(Connection c) throws Exception {
        var result = new LinkedHashMap<String, Object>();
        result.put("database", query(c, "SELECT current_database() AS name"));
        result.put("tables", query(c, "SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relispartition ORDER BY c.relname"));
        result.put("statuses", query(c, "SELECT to_jsonb(s)::text AS body FROM public.statuses s ORDER BY game_id,status_key"));
        result.put("columns", query(c, "SELECT column_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='statuses' ORDER BY ordinal_position"));
        result.put("kindConstraint", query(c, "SELECT conname,convalidated,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.statuses'::regclass AND conname='ck_statuses_kind'"));
        result.put("statusReferences", query(c, "SELECT to_jsonb(r)::text AS body FROM public.skill_object_references r WHERE target_type='STATUS' ORDER BY game_id,source_skill_key,source_type,source_key,field_path"));
        for (String table : List.of("skill_effects", "skill_object_references")) {
            var rows = query(c, "SELECT to_jsonb(t)::text AS body FROM public." + table + " t ORDER BY to_jsonb(t)::text");
            result.put(table, Map.of("rows", rows.size(), "sha256", sha(JSON.writeValueAsBytes(rows))));
        }
        return result;
    }
    public static void main(String[] args) {
        try { run(args); }
        catch (Exception e) {
            System.err.println("charmStatusKindMigration=FAILED errorType=" + e.getClass().getSimpleName() + " sqlState=" + (e instanceof SQLException s ? s.getSQLState() : "none") + "; inspect journal and actual database before any further action");
            System.exit(1);
        }
    }
    static void run(String[] args) throws Exception {
        if (!Arrays.equals(args, new String[]{"--apply"})) throw new IllegalArgumentException();
        byte[] sql = Files.readAllBytes(SQL);
        if (!APPROVED_SQL_SHA256.equals(sha(sql))) throw new IllegalStateException("SQL hash mismatch");
        Map<?, ?> cfg;
        try (var in = Files.newInputStream(Path.of("server/data_manage/src/main/resources/application.yml"))) { cfg = new Yaml().load(in); }
        var ds = (Map<?, ?>)((Map<?, ?>)cfg.get("spring")).get("datasource");
        String url = System.getenv().getOrDefault("SPRING_DATASOURCE_URL", resolve(ds.get("url")));
        URI uri = URI.create(url.substring(5));
        if (!"192.168.5.6".equals(uri.getHost()) || uri.getPort() != 5432 || !"/test0221".equals(uri.getPath())) throw new IllegalStateException("Target mismatch");
        Properties props = new Properties();
        props.setProperty("user", System.getenv().getOrDefault("SPRING_DATASOURCE_USERNAME", resolve(ds.get("username"))));
        props.setProperty("password", System.getenv().getOrDefault("SPRING_DATASOURCE_PASSWORD", resolve(ds.get("password"))));
        props.setProperty("connectTimeout", "10"); props.setProperty("socketTimeout", "60");
        Files.createFile(JOURNAL); // CREATE_NEW：任何前次尝试都要求先独立恢复，不能重放。
        record("STARTED", Map.of("sqlSha256", APPROVED_SQL_SHA256, "host", uri.getHost(), "database", "test0221"));
        boolean submitted = false;
        try (Connection c = DriverManager.getConnection(url, props)) {
            c.setReadOnly(true);
            var before = snapshot(c);
            if (((List<?>)before.get("tables")).size() != 27 || ((List<?>)before.get("columns")).size() != 9) throw new IllegalStateException("Preflight shape mismatch");
            record("READ_ONLY_BEFORE", before);
            c.setReadOnly(false); // SQL 自身持有 BEGIN/COMMIT；连接保持自动提交，不嵌套事务。
            record("SQL_SUBMITTED", Map.of("sqlSha256", APPROVED_SQL_SHA256)); submitted = true;
            try (var s = c.createStatement()) {
                boolean more = s.execute(new String(sql, StandardCharsets.UTF_8));
                while (more || s.getUpdateCount() != -1) more = s.getMoreResults();
            }
            record("COMMIT_RETURNED", Map.of("scriptExecutions", 1));
            c.setReadOnly(true);
            var after = snapshot(c);
            if (!Objects.equals(before.get("tables"), after.get("tables"))
                || !Objects.equals(before.get("statuses"), after.get("statuses"))
                || !Objects.equals(before.get("columns"), after.get("columns"))
                || !Objects.equals(before.get("statusReferences"), after.get("statusReferences"))
                || !Objects.equals(before.get("skill_effects"), after.get("skill_effects"))
                || !Objects.equals(before.get("skill_object_references"), after.get("skill_object_references"))) throw new IllegalStateException("Readback drift after commit");
            var constraints = (List<?>) after.get("kindConstraint");
            if (constraints.size() != 1 || !((Map<?, ?>)constraints.getFirst()).get("definition").toString().contains("'CHARM'")) throw new IllegalStateException("Charm kind constraint missing after commit");
            record("IMMEDIATE_READBACK_PASS", after);
        } catch (Exception e) {
            record(submitted ? "ATTEMPT_REQUIRES_INDEPENDENT_RECOVERY" : "PREWRITE_FAILED", Map.of("errorType", e.getClass().getSimpleName(), "sqlState", e instanceof SQLException s ? s.getSQLState() : "none"));
            throw e;
        }
        System.out.println("charmStatusKindMigration=PASS scriptExecutions=1 independentReadback=pending journal=" + JOURNAL);
    }
}
