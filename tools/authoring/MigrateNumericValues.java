import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
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
import xyz.game.datamanage.support.error.ApiException;

/** 已核对开发库的一次性数值形状迁移；由同游戏写事务完整校验并重建引用。 */
class MigrateNumericValues {
    private static final ObjectMapper JSON = new ObjectMapper().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);
    private static final String[][] GROUPS = {
        {"formulas", "skill_formulas", "formula_key", "formulaKey", "expression"},
        {"effects", "skill_effects", "effect_key", "effectKey", "results", "lifecycle"},
        {"internal-states", "skill_internal_states", "state_key", "stateKey", "detail"},
        {"processes", "skill_processes", "process_key", "processKey", "steps", "cooldown", "effect_bindings", "state_operations"},
        {"trigger-rules", "skill_trigger_rules", "rule_key", "ruleKey", "event_source", "condition_groups", "actions", "limits"}
    };

    public static void main(String[] args) throws Exception {
        if (args.length != 4 || !List.of("test0221", "test0221_aggregate_check_20260906").contains(args[1])
            || !List.of("--apply", "--check").contains(args[3])) {
            throw new IllegalArgumentException("参数：后端根目录 已核对数据库名 旧接口快照 --apply 或 --check");
        }
        Path root = Path.of(args[0]);
        Map<?, ?> config = new Yaml().load(Files.newInputStream(root.resolve("server/data_manage/src/main/resources/application.yml")));
        Map<?, ?> ds = (Map<?, ?>) ((Map<?, ?>) config.get("spring")).get("datasource");
        String original = System.getenv().getOrDefault("SPRING_DATASOURCE_URL", resolve(ds.get("url")));
        URI uri = URI.create(original.substring(5));
        if (!"/test0221".equals(uri.getPath())) throw new IllegalStateException("默认数据源不是已核对开发库");
        String url = "jdbc:" + new URI(uri.getScheme(), uri.getUserInfo(), uri.getHost(), uri.getPort(), "/" + args[1], uri.getQuery(), null);
        JdbcTemplate jdbc = new JdbcTemplate(new DriverManagerDataSource(url,
            System.getenv().getOrDefault("SPRING_DATASOURCE_USERNAME", resolve(ds.get("username"))),
            System.getenv().getOrDefault("SPRING_DATASOURCE_PASSWORD", resolve(ds.get("password")))));
        JsonNode before = JSON.readTree(Files.readString(Path.of(args[2])));
        ObjectNode expected = before.deepCopy();
        before.path("skills").properties().forEach(skill -> {
            ObjectNode destination = (ObjectNode) expected.path("skills").path(skill.getKey());
            for (String resource : List.of("effects", "internal-states", "processes", "trigger-rules")) {
                for (JsonNode object : destination.path(resource)) convert(resource, (ObjectNode) object);
            }
        });
        Path expectedFile = root.resolve("output/authoring-simplification/numeric-expected-" + args[1] + ".json");
        if (Files.exists(expectedFile)) {
            if (!same(expected, JSON.readTree(Files.readString(expectedFile)))) throw new IllegalStateException("既有预期快照不一致，停止覆盖");
        } else Files.writeString(expectedFile, JSON.writerWithDefaultPrettyPrinter().writeValueAsString(expected));
        TransactionTemplate transaction = new TransactionTemplate(new DataSourceTransactionManager(jdbc.getDataSource()));
        GameConfigurationWriteGuard guard = new GameConfigurationWriteGuard(jdbc);
        try {
            transaction.executeWithoutResult(status -> {
                String gameId = before.path("gameId").asText();
                guard.begin(gameId);
                if (!jdbc.queryForList("SELECT game_id FROM public.games ORDER BY game_id", String.class).equals(List.of(gameId))) {
                    throw new IllegalStateException("快照未覆盖全部游戏");
                }
                if ("--apply".equals(args[3])) {
                    compare(jdbc, before);
                    for (String[] group : GROUPS) {
                        if (group[0].equals("formulas")) continue;
                        expected.path("skills").properties().forEach(skill -> {
                            for (JsonNode object : skill.getValue().path(group[0])) {
                                for (int index = 4; index < group.length; index++) {
                                    String column = group[index];
                                    JsonNode value = field(object, column);
                                    int changed = jdbc.update("UPDATE public." + group[1] + " SET " + column
                                        + "=CAST(? AS jsonb) WHERE game_id=? AND skill_key=? AND " + group[2] + "=?",
                                        value.isNull() ? null : value.toString(), gameId, skill.getKey(), object.path(group[3]).asText());
                                    if (changed != 1) throw new IllegalStateException("目标聚合数量异常");
                                }
                            }
                        });
                    }
                }
                compare(jdbc, expected);
                Integer tables = jdbc.queryForObject("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relispartition", Integer.class);
                if (tables == null || tables != 24) throw new IllegalStateException("业务表数量不是24");
                String imageHash = jdbc.queryForObject("SELECT md5(string_agg(image_key || ':' || md5(image_base64),',' ORDER BY game_id,image_key)) FROM public.images", String.class);
                if (!"481cb9972a43e94bd6943dec777dc8fc".equals(imageHash)) throw new IllegalStateException("图片内容发生变化");
            });
        } catch (RuntimeException ex) {
            String state = "none";
            for (Throwable cause = ex; cause != null; cause = cause.getCause()) if (cause instanceof java.sql.SQLException sql) state = sql.getSQLState();
            System.err.println("numeric migration rolled back; error=" + ex.getClass().getSimpleName() + "; sqlState=" + state);
            if (ex instanceof ApiException businessError) {
                Files.writeString(root.resolve("output/authoring-simplification/numeric-migration-error.json"),
                    JSON.writerWithDefaultPrettyPrinter().writeValueAsString(Map.of("code", businessError.getCode(), "details", businessError.getDetails())));
            }
            // 不将数据源配置、连接串或底层异常信息输出至日志。
            throw new IllegalStateException("数值迁移失败，事务已回滚");
        }
        System.out.println("database=" + args[1] + " numericComparison=passed publicTables=24 imageHash=unchanged references="
            + jdbc.queryForObject("SELECT count(*) FROM public.skill_object_references", Long.class));
    }

    static void convert(String resource, ObjectNode object) {
        switch (resource) {
            case "effects" -> {
                rename(object.path("lifecycle"), "duration", "maxStacks", "applicationStacks", "periodicInterval");
                for (JsonNode result : object.path("results")) {
                    renameField(result.path("valueRule"), "formulaKey", "value");
                    rename(result.path("detail").path("critical"), "multiplier");
                    for (JsonNode rule : result.path("detail").path("vampRules")) rename(rule, "efficiency");
                }
            }
            case "internal-states" -> {
                renameField(object.path("detail"), "initialValueFormulaKey", "initialValue");
                renameField(object.path("detail"), "maxValueFormulaKey", "maxValue");
                rename(object.path("detail"), "recoveryInterval", "duration");
            }
            case "processes" -> {
                rename(object.path("cooldown"), "duration");
                for (JsonNode step : object.path("steps")) rename(step.path("detail"), "delay", "repeatCount", "interval", "duration", "executionCount", "minimumCharge", "maximumCharge", "window", "maximumRecastCount");
                for (JsonNode operation : object.path("stateOperations")) renameField(operation, "valueFormulaKey", "value");
            }
            case "trigger-rules" -> {
                rename(object.path("eventSource").path("detail"), "threshold");
                for (JsonNode group : object.path("conditionGroups")) for (JsonNode condition : group.path("conditions")) rename(condition.path("detail"), "comparison");
                rename(object.path("perTargetCooldown"), "duration");
                rename(object.path("maxTriggersPerProcess"), "limit");
            }
            default -> throw new IllegalArgumentException("未知数值所属对象");
        }
    }

    private static void rename(JsonNode owner, String... prefixes) {
        for (String prefix : prefixes) renameField(owner, prefix + "FormulaKey", prefix + "Value");
    }

    private static void renameField(JsonNode owner, String oldField, String newField) {
        if (!owner.isObject() || !owner.has(oldField)) return;
        ObjectNode object = (ObjectNode) owner;
        if (object.has(newField)) throw new IllegalStateException("同时出现新旧数值字段");
        JsonNode prior = object.remove(oldField);
        if (prior.isNull()) object.set(newField, JSON.nullNode());
        else {
            if (!prior.isTextual() || prior.asText().isBlank()) throw new IllegalStateException("旧公式标识不是非空字符串");
            object.set(newField, JSON.createObjectNode().put("kind", "FORMULA").put("formulaKey", prior.asText()));
        }
    }

    private static JsonNode field(JsonNode object, String column) {
        if (column.equals("limits")) return JSON.createObjectNode().setAll(Map.of("perTargetCooldown", object.path("perTargetCooldown"), "maxTriggersPerProcess", object.path("maxTriggersPerProcess")));
        String name = switch (column) {
            case "event_source" -> "eventSource"; case "condition_groups" -> "conditionGroups";
            case "effect_bindings" -> "effectBindings"; case "state_operations" -> "stateOperations"; default -> column;
        };
        JsonNode value = object.path(name);
        if (value.isMissingNode()) throw new IllegalStateException("接口快照缺少聚合字段 " + name);
        return value;
    }

    private static void compare(JdbcTemplate jdbc, JsonNode snapshot) {
        for (String[] group : GROUPS) {
            int expectedCount = 0;
            for (Map.Entry<String, JsonNode> skill : snapshot.path("skills").properties()) {
                for (JsonNode object : skill.getValue().path(group[0])) {
                    expectedCount++;
                    Map<String, Object> row = jdbc.queryForMap("SELECT * FROM public." + group[1] + " WHERE game_id=? AND skill_key=? AND " + group[2] + "=?", snapshot.path("gameId").asText(), skill.getKey(), object.path(group[3]).asText());
                    for (int index = 4; index < group.length; index++) {
                        String column = group[index];
                        try {
                            JsonNode actual = row.get(column) == null ? JSON.nullNode() : JSON.readTree(row.get(column).toString());
                            if (!same(field(object, column), actual)) throw new IllegalStateException("聚合快照不一致 " + skill.getKey() + "/" + group[0] + "/" + object.path(group[3]).asText() + "/" + column);
                        } catch (java.io.IOException ex) { throw new IllegalStateException("聚合字段解析失败"); }
                    }
                }
            }
            Integer actualCount = jdbc.queryForObject("SELECT count(*) FROM public." + group[1], Integer.class);
            if (actualCount == null || actualCount != expectedCount) throw new IllegalStateException("聚合总数与快照不符 " + group[1]);
        }
    }

    private static boolean same(JsonNode left, JsonNode right) {
        if (left.isNumber() && right.isNumber()) return left.decimalValue().compareTo(right.decimalValue()) == 0;
        if (left.isObject() && right.isObject()) {
            if (left.size() != right.size()) return false;
            for (Map.Entry<String, JsonNode> entry : left.properties()) if (!right.has(entry.getKey()) || !same(entry.getValue(), right.get(entry.getKey()))) return false;
            return true;
        }
        if (left.isArray() && right.isArray()) {
            if (left.size() != right.size()) return false;
            for (int index = 0; index < left.size(); index++) if (!same(left.get(index), right.get(index))) return false;
            return true;
        }
        return left.equals(right);
    }

    private static String resolve(Object raw) {
        String value = String.valueOf(raw);
        if (!value.startsWith("${") || !value.endsWith("}")) return value;
        String inner = value.substring(2, value.length() - 1);
        int split = inner.indexOf(':');
        return System.getenv().getOrDefault(split < 0 ? inner : inner.substring(0, split), split < 0 ? "" : inner.substring(split + 1));
    }
}
