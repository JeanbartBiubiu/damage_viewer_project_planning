package xyz.game.datamanage.tools;

import java.io.PrintStream;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

public final class GamePartitionCleanupMain {

    static final String DB_URL_ENV = "IT_DB_URL";
    static final String DB_USERNAME_ENV = "IT_DB_USERNAME";
    static final String DB_PASSWORD_ENV = "IT_DB_PASSWORD";

    private static final Pattern GAME_ID_PATTERN = Pattern.compile("^[a-z0-9_]+$");
    private static final List<String> PARTITION_PREFIXES = List.of(
        "heroes_",
        "skills_",
        "items_",
        "attribute_definitions_",
        "attribute_definitions_log_",
        "images_",
        "types_",
        "types_log_",
        "type_relations_",
        "type_relations_log_",
        "heroes_log_",
        "skills_log_",
        "items_log_",
        "status_action_control_rules_",
        "status_action_control_rules_log_"
    );

    private GamePartitionCleanupMain() {
    }

    public static void main(String[] args) throws Exception {
        CleanupOptions options = parseArgs(args);
        run(options, System.out);
    }

    static CleanupOptions parseArgs(String[] args) {
        String gameId = null;
        String confirm = null;
        boolean dryRun = false;

        for (String arg : args) {
            if ("--dryRun".equals(arg)) {
                dryRun = true;
                continue;
            }
            if (arg.startsWith("--gameId=")) {
                gameId = arg.substring("--gameId=".length()).trim();
                continue;
            }
            if (arg.startsWith("--confirm=")) {
                confirm = arg.substring("--confirm=".length()).trim();
                continue;
            }
            throw new IllegalArgumentException("Unknown argument: " + arg);
        }

        if (gameId == null || gameId.isBlank()) {
            throw new IllegalArgumentException("Missing required argument: --gameId=<game_id>");
        }
        if (!GAME_ID_PATTERN.matcher(gameId).matches()) {
            throw new IllegalArgumentException("Invalid gameId format: only [a-z0-9_] is allowed");
        }

        String expectedConfirm = "DROP_" + gameId;
        if (!expectedConfirm.equals(confirm)) {
            throw new IllegalArgumentException("Invalid --confirm value. Expected: --confirm=" + expectedConfirm);
        }

        return new CleanupOptions(gameId, dryRun);
    }

    static List<String> buildStatements(String gameId) {
        String safeGameId = escapeSqlLiteral(gameId);
        List<String> statements = new ArrayList<>(PARTITION_PREFIXES.size() + 3);
        for (String prefix : PARTITION_PREFIXES) {
            statements.add("DROP TABLE IF EXISTS public." + prefix + gameId + " CASCADE");
        }
        statements.add("DELETE FROM public.owner_categories WHERE game_id = '" + safeGameId + "'");
        statements.add("DELETE FROM public.game_versions WHERE game_id = '" + safeGameId + "'");
        statements.add("DELETE FROM public.games WHERE game_id = '" + safeGameId + "'");
        return statements;
    }

    static void run(CleanupOptions options, PrintStream out) throws SQLException {
        List<String> statements = buildStatements(options.gameId());
        if (options.dryRun()) {
            out.println("DRY-RUN mode enabled. Planned SQL statements:");
            for (String statement : statements) {
                out.println(statement + ";");
            }
            return;
        }

        String dbUrl = requireEnv(DB_URL_ENV, false);
        String username = requireEnv(DB_USERNAME_ENV, false);
        String password = requireEnv(DB_PASSWORD_ENV, true);

        try (Connection connection = DriverManager.getConnection(dbUrl, username, password)) {
            connection.setAutoCommit(false);
            try (Statement statement = connection.createStatement()) {
                for (String sql : statements) {
                    statement.execute(sql);
                }
                connection.commit();
            } catch (SQLException ex) {
                connection.rollback();
                throw ex;
            }
        }

        out.println("Cleanup finished for gameId=" + options.gameId());
    }

    private static String requireEnv(String key, boolean allowBlank) {
        String value = System.getenv(key);
        if (value == null || (!allowBlank && value.isBlank())) {
            throw new IllegalArgumentException("Missing required environment variable: " + key);
        }
        return value;
    }

    private static String escapeSqlLiteral(String value) {
        return value.replace("'", "''");
    }

    record CleanupOptions(String gameId, boolean dryRun) {
    }
}
