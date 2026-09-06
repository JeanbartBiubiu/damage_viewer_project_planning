import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.DeserializationFeature;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import org.yaml.snakeyaml.Yaml;
import xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard;

/** 一次性人工迁移验收入口。配置凭据只在进程内读取，失败仅报告步骤和 SQL 状态。 */
class VerifyAggregateMigration {
    private static final ObjectMapper JSON = new ObjectMapper().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);
    private static String resolve(Object raw) {
        String value = String.valueOf(raw);
        if (!value.startsWith("${") || !value.endsWith("}")) return value;
        String inner = value.substring(2, value.length() - 1);
        int split = inner.indexOf(':');
        return System.getenv().getOrDefault(split < 0 ? inner : inner.substring(0, split), split < 0 ? "" : inner.substring(split + 1));
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 4 || !List.of("test0221", "test0221_aggregate_check_20260906").contains(args[1])) {
            throw new IllegalArgumentException("参数：后端根目录 已核对数据库名 聚合快照路径 --apply 或 --check");
        }
        Path root = Path.of(args[0]);
        Map<?, ?> config = new Yaml().load(Files.newInputStream(root.resolve("server/data_manage/src/main/resources/application.yml")));
        Map<?, ?> ds = (Map<?, ?>) ((Map<?, ?>) config.get("spring")).get("datasource");
        String original = System.getenv().getOrDefault("SPRING_DATASOURCE_URL", resolve(ds.get("url")));
        URI uri = URI.create(original.substring(5));
        if (!"/test0221".equals(uri.getPath())) throw new IllegalStateException("默认数据源不是已核对开发库");
        String url = "jdbc:" + new URI(uri.getScheme(), uri.getUserInfo(), uri.getHost(), uri.getPort(), "/" + args[1], uri.getQuery(), null);
        DriverManagerDataSource source = new DriverManagerDataSource(url,
            System.getenv().getOrDefault("SPRING_DATASOURCE_USERNAME", resolve(ds.get("username"))),
            System.getenv().getOrDefault("SPRING_DATASOURCE_PASSWORD", resolve(ds.get("password"))));
        JdbcTemplate jdbc = new JdbcTemplate(source);
        JsonNode snapshot = JSON.readTree(Files.readString(Path.of(args[2])));
        List<String> games = jdbc.queryForList("SELECT game_id FROM public.games ORDER BY game_id", String.class);
        if (!games.equals(List.of(snapshot.path("gameId").asText()))) throw new IllegalStateException("快照未覆盖全部游戏");
        TransactionTemplate tx = new TransactionTemplate(new DataSourceTransactionManager(source));
        GameConfigurationWriteGuard guard = new GameConfigurationWriteGuard(jdbc);
        try {
            tx.executeWithoutResult(status -> {
                guard.begin(games.getFirst());
                if ("--apply".equals(args[3])) {
                    try {
                        jdbc.execute(Files.readString(root.resolve("db/game_manage/migrations/breaking/skill_aggregate_migration.sql")));
                    } catch (java.io.IOException ex) { throw new IllegalStateException("无法读取迁移脚本", ex); }
                } else if (!"--check".equals(args[3])) throw new IllegalArgumentException("必须明确 --apply 或 --check");
                assertSavedObjects(jdbc, snapshot);
                Long tables = jdbc.queryForObject("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relispartition", Long.class);
                if (tables == null || tables != 24) throw new IllegalStateException("迁移后业务表数应为 24");
                String imageHash = jdbc.queryForObject("SELECT md5(string_agg(image_key || ':' || md5(image_base64),',' ORDER BY game_id,image_key)) FROM public.images", String.class);
                if (!"481cb9972a43e94bd6943dec777dc8fc".equals(imageHash)) throw new IllegalStateException("图片内容与备份前不同");
            });
            System.out.println("database=" + args[1] + " publicTables=24 aggregateComparison=passed imageHash=unchanged references="
                + jdbc.queryForObject("SELECT count(*) FROM public.skill_object_references", Long.class));
        } catch (RuntimeException ex) {
            String state = "none";
            for (Throwable cause = ex; cause != null; cause = cause.getCause()) if (cause instanceof java.sql.SQLException sql) state = sql.getSQLState();
            System.err.println("migration rolled back; error=" + ex.getClass().getSimpleName() + "; sqlState=" + state);
            // 保存错误到本地供定点读取；不打印配置、连接字符串或快照内容。
            Path report = root.resolve("output/authoring-simplification/migration-error.txt");
            StringBuilder details = new StringBuilder();
            for (Throwable cause = ex; cause != null; cause = cause.getCause()) details.append(cause.getClass().getSimpleName()).append(": ").append(cause.getMessage()).append('\n');
            Files.writeString(report, details.toString());
            System.exit(1);
        }
    }

    private static void assertSavedObjects(JdbcTemplate jdbc, JsonNode snapshot) {
        String[][] groups = {
            {"formulas", "skill_formulas", "formula_key", "formulaKey", "expression"},
            {"effects", "skill_effects", "effect_key", "effectKey", "results", "lifecycle"},
            {"internal-states", "skill_internal_states", "state_key", "stateKey", "detail"},
            {"processes", "skill_processes", "process_key", "processKey", "steps", "cooldown", "effect_bindings", "state_operations"},
            {"trigger-rules", "skill_trigger_rules", "rule_key", "ruleKey", "event_source", "condition_groups", "actions", "limits"}
        };
        for (String[] group : groups) {
            int expectedCount = 0;
            var skills = snapshot.path("skills").fields();
            while (skills.hasNext()) {
                var skill = skills.next();
                for (JsonNode expected : skill.getValue().path(group[0])) {
                    expectedCount++;
                    String key = expected.path(group[3]).asText();
                    Map<String, Object> row = jdbc.queryForMap("SELECT * FROM public." + group[1] + " WHERE game_id=? AND skill_key=? AND " + group[2] + "=?", snapshot.path("gameId").asText(), skill.getKey(), key);
                    for (int i = 4; i < group.length; i++) {
                        String column = group[i];
                        String field = switch (column) {
                            case "effect_bindings" -> "effectBindings"; case "state_operations" -> "stateOperations";
                            case "event_source" -> "eventSource"; case "condition_groups" -> "conditionGroups"; default -> column;
                        };
                        JsonNode value = "limits".equals(field) ? JSON.createObjectNode()
                            .setAll(Map.of("perTargetCooldown", expected.path("perTargetCooldown"), "maxTriggersPerProcess", expected.path("maxTriggersPerProcess"))) : expected.path(field);
                        try {
                            Object raw = row.get(column);
                            JsonNode actual = raw == null ? JSON.nullNode() : JSON.readTree(raw.toString());
                            if (!same(value, actual)) throw new IllegalStateException("聚合不一致 " + skill.getKey() + "/" + group[0] + "/" + key + "/" + field);
                        } catch (java.io.IOException ex) { throw new IllegalStateException("聚合字段无法解析", ex); }
                    }
                }
            }
            Integer count = jdbc.queryForObject("SELECT count(*) FROM public." + group[1], Integer.class);
            if (count == null || count != expectedCount) throw new IllegalStateException("聚合根计数不一致 " + group[1]);
        }
    }

    private static boolean same(JsonNode left, JsonNode right) {
        if (left.isNumber() && right.isNumber()) return left.decimalValue().compareTo(right.decimalValue()) == 0;
        if (left.isObject() && right.isObject()) {
            if (left.size() != right.size()) return false;
            var fields = left.fields();
            while (fields.hasNext()) { var field = fields.next(); if (!right.has(field.getKey()) || !same(field.getValue(), right.get(field.getKey()))) return false; }
            return true;
        }
        if (left.isArray() && right.isArray()) {
            if (left.size() != right.size()) return false;
            for (int i = 0; i < left.size(); i++) if (!same(left.get(i), right.get(i))) return false;
            return true;
        }
        return left.equals(right);
    }
}
