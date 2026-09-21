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

/** 仅执行独立审查通过的击飞状态约束增量；固定日志拒绝任何重放。 */
class ApplyAirborneStatusKind {
    static final String APPROVED_SQL_SHA256 = "ed0852b458be7970dd49543dbb7762c643bb44db8e0cf6afefe4f0c656bbd6de";
    static final Path SQL = Path.of("db/game_manage/migrations/add_airborne_status_kind.sql");
    static final Path JOURNAL = Path.of("output/airborne-status-preflight/migration-attempt.jsonl");
    static final Path SELF = Path.of("tools/authoring/ApplyAirborneStatusKind.java");
    static final Path BEFORE = Path.of("C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/击飞状态管理补齐/03-实库迁移前快照.json");
    static final Path INSPECTOR = Path.of("C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/击飞状态管理补齐/InspectAirborneStatusKind.java");
    static final Path REVIEW = Path.of("C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/击飞状态管理补齐/05-迁移及最终代码独立评审.json");
    static final String BEFORE_SHA256 = "d7c6cb17e8ba736c90b6ab95705376069a1a7bcb7d8e074809190c5af8b76c36";
    static final String EXPECTED_CONSTRAINT = "CHECK (((status_kind)::text = ANY ((ARRAY['STUN'::character varying, 'MOVEMENT_SLOW'::character varying, 'ROOT'::character varying, 'SILENCE'::character varying, 'CHARM'::character varying, 'AIRBORNE'::character varying])::text[])))";
    static final String EXPECTED_COMMENT = "状态行为身份：眩晕、普通移动减速、禁锢、沉默、魅惑或击飞；创建后不可改";
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
  static Map<String,Object> snapshot(Connection c) throws Exception {
    var s = new LinkedHashMap<String,Object>();
    s.put("database",query(c,"SELECT current_database() AS name,current_user AS actor"));
    s.put("tables",query(c,"SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relispartition ORDER BY c.relname"));
    s.put("statuses",query(c,"SELECT to_jsonb(s)::text AS body FROM public.statuses s ORDER BY game_id,status_key"));
    s.put("columns",query(c,"SELECT column_name,data_type,character_maximum_length,is_nullable,column_default,ordinal_position FROM information_schema.columns WHERE table_schema='public' AND table_name='statuses' ORDER BY ordinal_position"));
    s.put("kindConstraint",query(c,"SELECT conname,convalidated,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.statuses'::regclass AND conname='ck_statuses_kind'"));
    s.put("otherConstraints",query(c,"SELECT conname,convalidated,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.statuses'::regclass AND conname<>'ck_statuses_kind' ORDER BY conname"));
    s.put("kindComment",query(c,"SELECT col_description('public.statuses'::regclass,attnum) AS comment FROM pg_attribute WHERE attrelid='public.statuses'::regclass AND attname='status_kind' AND NOT attisdropped"));
    s.put("statusReferences",query(c,"SELECT to_jsonb(r)::text AS body FROM public.skill_object_references r WHERE target_type='STATUS' ORDER BY game_id,source_skill_key,source_type,source_key,field_path"));
    for(String table:List.of("skill_effects","skill_object_references")) {
      var rows=query(c,"SELECT to_jsonb(t)::text AS body FROM public."+table+" t ORDER BY to_jsonb(t)::text");
      s.put(table,Map.of("rows",rows.size(),"sha256",sha(JSON.writeValueAsBytes(rows))));
    }
    return s;
  }
    public static void main(String[] args) {
        try { run(args); }
        catch (Exception e) {
            System.err.println("airborneStatusKindMigration=FAILED errorType=" + e.getClass().getSimpleName() + " sqlState=" + (e instanceof SQLException s ? s.getSQLState() : "none") + "; inspect journal and actual database before any further action");
            System.exit(1);
        }
    }
    static void run(String[] args) throws Exception {
        if (!Arrays.equals(args, new String[]{"--apply"})) throw new IllegalArgumentException();
        byte[] sql = Files.readAllBytes(SQL);
        if (!APPROVED_SQL_SHA256.equals(sha(sql))) throw new IllegalStateException("SQL hash mismatch");
        byte[] beforeBytes = Files.readAllBytes(BEFORE);
        if (!BEFORE_SHA256.equals(sha(beforeBytes))) throw new IllegalStateException("Baseline hash mismatch");
        var review = JSON.readTree(Files.readAllBytes(REVIEW));
        if (!"APPROVED".equals(review.path("status").asText())) throw new IllegalStateException("Independent review not approved");
        for (Path required : List.of(SQL, SELF, BEFORE, INSPECTOR)) {
            String key = required.toString().replace('\\', '/');
            if (!sha(Files.readAllBytes(required)).equals(review.path("approvedFiles").path(key).asText()))
                throw new IllegalStateException("Reviewed file hash mismatch");
        }
        var expectedBefore = JSON.readTree(beforeBytes).path("snapshot");
        Map<?, ?> cfg;
        try (var in = Files.newInputStream(Path.of("server/data_manage/src/main/resources/application.yml"))) { cfg = new Yaml().load(in); }
        var ds = (Map<?, ?>)((Map<?, ?>)cfg.get("spring")).get("datasource");
        String url = System.getenv().getOrDefault("SPRING_DATASOURCE_URL", resolve(ds.get("url")));
        if (!url.startsWith("jdbc:postgresql://")) throw new IllegalStateException("JDBC target mismatch");
        URI uri = URI.create(url.substring(5));
        if (!"192.168.5.6".equals(uri.getHost()) || uri.getPort() != 5432 || !"/test0221".equals(uri.getPath())) throw new IllegalStateException("Target mismatch");
        Properties props = new Properties();
        props.setProperty("user", System.getenv().getOrDefault("SPRING_DATASOURCE_USERNAME", resolve(ds.get("username"))));
        props.setProperty("password", System.getenv().getOrDefault("SPRING_DATASOURCE_PASSWORD", resolve(ds.get("password"))));
        props.setProperty("connectTimeout", "10"); props.setProperty("socketTimeout", "60"); props.setProperty("options", "-c timezone=UTC");
        Files.createDirectories(JOURNAL.getParent());
        Files.createFile(JOURNAL); // CREATE_NEW：任何前次尝试都要求先独立恢复，不能重放。
        record("STARTED", Map.of("sqlSha256", APPROVED_SQL_SHA256, "host", uri.getHost(), "database", "test0221"));
        boolean submitted = false;
        try (Connection c = DriverManager.getConnection(url, props)) {
            c.setReadOnly(true);
            c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
            c.setAutoCommit(false);
            var before = snapshot(c);
            c.rollback();
            if (!JSON.valueToTree(before).equals(expectedBefore)) throw new IllegalStateException("Approved baseline drift");
            record("READ_ONLY_BEFORE", before);
            c.setAutoCommit(true);
            c.setReadOnly(false); // SQL 自身持有 BEGIN/COMMIT；不嵌套事务。
            record("SQL_SUBMITTED", Map.of("sqlSha256", APPROVED_SQL_SHA256)); submitted = true;
            try (var s = c.createStatement()) {
                boolean more = s.execute(new String(sql, StandardCharsets.UTF_8));
                while (more || s.getUpdateCount() != -1) more = s.getMoreResults();
            }
            record("COMMIT_RETURNED", Map.of("scriptExecutions", 1));
            c.setReadOnly(true);
            c.setAutoCommit(false);
            var after = snapshot(c);
            c.rollback();
            for (String key : before.keySet()) {
                if (!Set.of("kindConstraint", "kindComment").contains(key) && !Objects.equals(before.get(key), after.get(key)))
                    throw new IllegalStateException("Readback drift after commit");
            }
            var constraints = (List<?>)after.get("kindConstraint");
            if (constraints.size()!=1 || !"t".equals(((Map<?,?>)constraints.getFirst()).get("convalidated"))
                || !EXPECTED_CONSTRAINT.equals(((Map<?,?>)constraints.getFirst()).get("definition")))
                throw new IllegalStateException("Airborne constraint missing after commit");
            var comments = (List<?>)after.get("kindComment");
            if (comments.size()!=1 || !EXPECTED_COMMENT.equals(((Map<?,?>)comments.getFirst()).get("comment")))
                throw new IllegalStateException("Airborne comment missing after commit");
            record("IMMEDIATE_READBACK_PASS", after);
        } catch (Exception e) {
            record(submitted ? "ATTEMPT_REQUIRES_INDEPENDENT_RECOVERY" : "PREWRITE_FAILED", Map.of("errorType", e.getClass().getSimpleName(), "sqlState", e instanceof SQLException s ? s.getSQLState() : "none"));
            throw e;
        }
        System.out.println("airborneStatusKindMigration=PASS scriptExecutions=1 independentReadback=pending journal=" + JOURNAL);
    }
}
