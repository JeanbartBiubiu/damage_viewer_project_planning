import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import org.yaml.snakeyaml.Yaml;

/** 共同公式切换只读预检；连接凭据只留在本机进程内。 */
public final class InspectFormulaTransition {
    private static final ObjectMapper JSON = new ObjectMapper();

    public static void main(String[] args) throws Exception {
        Map<?, ?> configuration;
        try (var input = Files.newInputStream(Path.of("server/data_manage/src/main/resources/application.yml"))) {
            configuration = new Yaml().load(input);
        }
        Map<?, ?> datasource = (Map<?, ?>) ((Map<?, ?>) configuration.get("spring")).get("datasource");
        String url = System.getenv().getOrDefault("SPRING_DATASOURCE_URL", resolve(datasource.get("url")));
        String user = System.getenv().getOrDefault("SPRING_DATASOURCE_USERNAME", resolve(datasource.get("username")));
        String password = System.getenv().getOrDefault("SPRING_DATASOURCE_PASSWORD", resolve(datasource.get("password")));
        ObjectNode report = JSON.createObjectNode();
        try (Connection connection = DriverManager.getConnection(url, user, password)) {
            connection.setReadOnly(true);
            connection.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
            connection.setAutoCommit(false);
            try (var statement = connection.createStatement(); var rows = statement.executeQuery(
                "select current_database(), current_user, current_setting('server_version'), current_setting('transaction_read_only')")) {
                rows.next();
                report.put("database", rows.getString(1)).put("user", rows.getString(2))
                    .put("serverVersion", rows.getString(3)).put("readOnly", rows.getString(4));
            }
            var constraints = report.putArray("constraints");
            try (var statement = connection.createStatement(); var rows = statement.executeQuery(
                "select c.conname, pg_get_constraintdef(c.oid) from pg_constraint c " +
                "where c.conrelid in ('public.damage_types'::regclass, 'public.skill_object_references'::regclass) order by c.conname")) {
                while (rows.next()) constraints.addObject().put("name", rows.getString(1)).put("definition", rows.getString(2));
            }
            var formulas = report.putArray("formulas");
            try (var statement = connection.createStatement(); var rows = statement.executeQuery(
                "select game_id, damage_type_key, status, calculation_formula::text from public.damage_types order by game_id, damage_type_key")) {
                while (rows.next()) {
                    String game = rows.getString(1);
                    ObjectNode formula = formulas.addObject().put("gameId", game).put("damageTypeKey", rows.getString(2)).put("status", rows.getString(3));
                    String stored = rows.getString(4);
                    formula.put("configured", stored != null);
                    if (stored == null) continue;
                    JsonNode root = JSON.readTree(stored);
                    formula.put("format", root.has("stages") ? "COMMON" : "FIVE_FIELDS").put("nodeCount", count(root));
                    Set<String> keys = new LinkedHashSet<>();
                    references(root, keys);
                    var attributes = formula.putArray("attributes");
                    for (String key : keys) {
                        try (PreparedStatement query = connection.prepareStatement("select status from public.attributes where game_id=? and attribute_key=?")) {
                            query.setString(1, game); query.setString(2, key);
                            try (ResultSet result = query.executeQuery()) { attributes.addObject().put("attributeKey", key).put("status", result.next() ? result.getString(1) : "MISSING"); }
                        }
                    }
                }
            }
            try (var statement = connection.createStatement(); var rows = statement.executeQuery("select count(*) from public.skill_object_references")) {
                rows.next(); report.put("referenceRows", rows.getLong(1));
            }
            connection.rollback();
            System.out.println(JSON.writerWithDefaultPrettyPrinter().writeValueAsString(report));
        } catch (java.sql.SQLException error) {
            System.out.println("{\"connected\":false,\"sqlState\":\"" + error.getSQLState() + "\"}");
            System.exit(1);
        }
    }

    private static int count(JsonNode node) {
        int count = node.has("nodeType") || node.has("op") ? 1 : 0;
        for (JsonNode child : node) count += count(child);
        return count;
    }

    private static void references(JsonNode node, Set<String> keys) {
        if (node.has("attributeKey") && node.path("attributeKey").isTextual()) keys.add(node.path("attributeKey").textValue());
        for (JsonNode child : node) references(child, keys);
    }

    private static String resolve(Object value) {
        String text = String.valueOf(value);
        if (!text.startsWith("${") || !text.endsWith("}")) return text;
        String inner = text.substring(2, text.length() - 1);
        int split = inner.indexOf(':');
        return System.getenv().getOrDefault(split < 0 ? inner : inner.substring(0, split), split < 0 ? "" : inner.substring(split + 1));
    }
}
