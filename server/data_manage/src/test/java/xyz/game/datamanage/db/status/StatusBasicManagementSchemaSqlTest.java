package xyz.game.datamanage.db.status;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

class StatusBasicManagementSchemaSqlTest {

    private static final String SCHEMA_RELATIVE = "db/game_manage/schema.sql";
    private static final String MIGRATION_RELATIVE =
        "db/game_manage/migrations/compatibility/status_basic_management_migration.sql";

    private static String schemaSql;
    private static String migrationSql;
    private static String schemaNormalized;
    private static String migrationNormalized;

    @BeforeAll
    static void loadArtifacts() throws IOException {
        schemaSql = readRelative(SCHEMA_RELATIVE);
        migrationSql = readRelative(MIGRATION_RELATIVE);
        schemaNormalized = normalize(schemaSql);
        migrationNormalized = normalize(stripLineComments(migrationSql));
    }

    @Test
    void schemaDefinesIndependentStatusesTableWithoutCategoryOrLifecycle() {
        String table = normalize(extractCreateTable(schemaSql, "statuses"));

        assertTrue(table.contains("constraint pk_statuses"));
        assertTrue(table.contains("primary key (game_id, status_key)"));
        assertTrue(table.contains("constraint fk_statuses_game"));
        assertTrue(table.contains("foreign key (game_id) references public.games (game_id)"));
        assertTrue(table.contains("status_key varchar(64) not null"));
        assertTrue(table.contains("status_kind varchar(32) not null"));
        assertTrue(table.contains("status_kind in ('stun', 'movement_slow', 'root')"));
        assertFalse(table.contains("status_kind varchar(32) not null default"));
        assertTrue(table.contains("name varchar(100) not null"));
        assertTrue(table.contains("description varchar(2000)"));
        assertTrue(table.contains("status varchar(16) not null default 'enabled'"));
        assertTrue(table.contains("sort_order integer not null default 0"));
        assertTrue(table.contains("created_at timestamptz not null default now()"));
        assertTrue(table.contains("updated_at timestamptz not null default now()"));
        assertTrue(table.contains("status_key ~ '^[a-z][a-z0-9_]{0,63}$'"));
        assertTrue(table.contains("btrim(name) <> ''"));
        assertTrue(table.contains("status in ('enabled', 'disabled')"));
        assertTrue(table.contains("sort_order >= 0"));
        assertFalse(table.contains("on delete"));
        assertFalse(table.contains("jsonb"));
        assertFalse(table.contains("json "));
        assertFalse(table.contains("integer[]"));
        assertFalse(table.contains("text[]"));
        assertFalse(table.contains("category"));
        assertFalse(table.contains("duration"));
        assertFalse(table.contains("stack"));
        assertFalse(table.contains("refresh"));
        assertFalse(table.contains("period"));
        assertFalse(table.contains("control"));
        assertFalse(table.contains("immun"));
        assertFalse(table.contains("formula"));
        assertFalse(table.contains("revision"));
        assertFalse(table.contains("extend"));

        assertTrue(schemaNormalized.contains(
            "create unique index uq_statuses_name on public.statuses (game_id, lower(btrim(name)))"
        ));
        assertFalse(schemaNormalized.contains("create unique index if not exists uq_statuses_name"));
    }

    @Test
    void compatibilityMigrationStrictlyPreflightsExistingTableAndCreatesOnlyWhenMissing() {
        String catalogChecks = normalize(stripLineComments(extractDoBlock(migrationSql)));

        assertTrue(catalogChecks.contains("information_schema.tables"));
        assertTrue(catalogChecks.contains("information_schema.columns"));
        assertTrue(catalogChecks.contains("pg_constraint"));
        assertTrue(catalogChecks.contains("pg_get_constraintdef"));
        assertTrue(catalogChecks.contains("pg_attribute"));
        assertTrue(catalogChecks.contains("conkey"));
        assertTrue(catalogChecks.contains("confkey"));
        assertTrue(catalogChecks.contains("unnest("));
        assertTrue(catalogChecks.contains("pg_indexes"));
        assertTrue(catalogChecks.contains("pg_index"));
        assertTrue(catalogChecks.contains("pg_get_expr"));
        assertTrue(catalogChecks.contains("indexprs"));
        assertTrue(catalogChecks.contains("raise exception"));
        assertFalse(catalogChecks.contains("pg_get_indexdef"));

        assertTrue(catalogChecks.contains("pk_statuses"));
        assertTrue(catalogChecks.contains("array['game_id', 'status_key']"));
        assertTrue(catalogChecks.contains("fk_statuses_game"));
        assertTrue(catalogChecks.contains("'public.games'::regclass"));
        assertTrue(catalogChecks.contains("confdeltype <> 'c'") || catalogChecks.contains("confdeltype<>'c'"));
        assertTrue(catalogChecks.contains("ck_statuses_key"));
        assertTrue(catalogChecks.contains("^[a-z][a-z0-9_]{0,63}$"));
        assertTrue(catalogChecks.contains("ck_statuses_name"));
        assertTrue(catalogChecks.contains("btrim"));
        assertTrue(catalogChecks.contains("ck_statuses_status"));
        assertTrue(catalogChecks.contains("enabled"));
        assertTrue(catalogChecks.contains("disabled"));
        assertTrue(catalogChecks.contains("ck_statuses_sort_order"));
        assertTrue(
            catalogChecks.contains("sort_order>=0") || catalogChecks.contains("sort_order >= 0")
        );
        assertTrue(catalogChecks.contains("uq_statuses_name"));
        assertTrue(catalogChecks.contains("indisunique = true") || catalogChecks.contains("indisunique=true"));
        assertTrue(catalogChecks.contains("indpred is null"));
        assertTrue(catalogChecks.contains("indnkeyatts = 2") || catalogChecks.contains("indnkeyatts=2"));
        assertTrue(catalogChecks.contains("indnatts = 2") || catalogChecks.contains("indnatts=2"));
        assertTrue(catalogChecks.contains("indkey"));
        assertTrue(catalogChecks.contains("attname = 'game_id'"));
        assertTrue(catalogChecks.contains("replace(pg_get_expr(i.indexprs, i.indrelid), '::text', '')"));
        assertTrue(catalogChecks.contains("lower(btrim(name))"));
        assertTrue(catalogChecks.contains("(game_id, lower(btrim(name)))"));
        assertFalse(Pattern.compile("pg_get_indexdef[^;]*ilike").matcher(catalogChecks).find());
        assertFalse(Pattern.compile("pg_get_expr[^;]*ilike").matcher(catalogChecks).find());

        int tableExistsPos = catalogChecks.indexOf("table_name = 'statuses'");
        int createPos = catalogChecks.indexOf("create table public.statuses");
        int indexPos = catalogChecks.indexOf("create unique index uq_statuses_name");
        int uniqueIndexCheckPos = catalogChecks.indexOf("indexname = 'uq_statuses_name'");
        assertTrue(tableExistsPos >= 0 && tableExistsPos < createPos);
        assertTrue(createPos >= 0 && indexPos > createPos);
        assertTrue(uniqueIndexCheckPos >= 0 && uniqueIndexCheckPos < createPos);

        assertFalse(catalogChecks.contains("create table if not exists"));
        assertFalse(catalogChecks.contains("create unique index if not exists"));
        assertFalse(Pattern.compile(
            "if exists \\( select 1 from pg_indexes[^)]*uq_statuses_name"
        ).matcher(catalogChecks).find());

        assertTrue(migrationNormalized.contains("create table public.statuses"));
        assertTrue(migrationNormalized.contains("create unique index uq_statuses_name"));
        assertFalse(migrationNormalized.contains("create table if not exists public.statuses"));
        assertFalse(migrationNormalized.contains("create unique index if not exists uq_statuses_name"));
    }

    @Test
    void schemaAndMigrationShareTheFrozenCreateTableBody() {
        String schemaTable = normalize(extractCreateTable(schemaSql, "statuses"));
        String migrationTable = normalize(extractCreateTable(migrationSql, "statuses"));
        assertTrue(schemaTable.contains("constraint pk_statuses"));
        assertTrue(migrationTable.contains("constraint pk_statuses"));
        assertTrue(migrationTable.contains("description varchar(2000)"));
        assertTrue(migrationTable.contains("foreign key (game_id) references public.games (game_id)"));
        assertTrue(migrationTable.contains("status in ('enabled', 'disabled')"));
        assertFalse(migrationTable.contains("on delete"));
        assertFalse(migrationTable.contains("jsonb"));
        assertFalse(migrationTable.contains("category"));
    }

    @Test
    void artifactsDoNotTouchLegacyStatusOrPublishSurfaces() {
        assertFalse(schemaNormalized.contains("status_definitions"));
        assertFalse(migrationNormalized.contains("status_definitions"));
        assertFalse(Pattern.compile("(?is)\\bprovider\\b").matcher(migrationNormalized).find());
        assertFalse(Pattern.compile("(?is)\\bability\\b").matcher(migrationNormalized).find());
        assertFalse(migrationNormalized.contains("combat-data"));
        assertFalse(migrationNormalized.contains("versions:publish"));
        assertFalse(Pattern.compile("(?is)\\bdrop\\b").matcher(migrationNormalized).find());
        assertFalse(Pattern.compile("(?is)\\bdelete\\s+from\\b").matcher(migrationNormalized).find());
        assertFalse(Pattern.compile("(?is)\\bcascade\\b").matcher(migrationNormalized).find());
        assertFalse(migrationNormalized.contains("种子"));
        assertFalse(migrationNormalized.contains("发布"));
        assertFalse(schemaNormalized.contains("jsonb")
            && schemaNormalized.contains("create table public.statuses")
            && extractCreateTable(schemaSql, "statuses").toLowerCase().contains("jsonb"));
    }

    private static String extractCreateTable(String sql, String tableName) {
        Matcher matcher = Pattern.compile(
            "(?is)CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+public\\."
                + Pattern.quote(tableName)
                + "\\s*\\("
        ).matcher(sql);
        assertTrue(matcher.find(), "CREATE TABLE public." + tableName + " missing");
        int depth = 0;
        boolean inParens = false;
        for (int i = matcher.end() - 1; i < sql.length(); i++) {
            char ch = sql.charAt(i);
            if (ch == '(') {
                depth++;
                inParens = true;
            } else if (ch == ')') {
                depth--;
                if (inParens && depth == 0) {
                    int end = i + 1;
                    while (end < sql.length() && sql.charAt(end) != ';') {
                        end++;
                    }
                    return sql.substring(matcher.start(), Math.min(end + 1, sql.length()));
                }
            }
        }
        fail("unable to extract CREATE TABLE body for " + tableName);
        return "";
    }

    @Test
    void kindMigrationChecksFrozenIdentityAndKeepsOriginalRowsUntouched() throws IOException {
        String sql = normalize(stripLineComments(readRelative("db/game_manage/migrations/status_kinds_and_slow_strength.sql")));
        assertTrue(sql.startsWith("begin;"));
        assertTrue(sql.endsWith("commit;"));
        assertTrue(sql.contains("current_database() <> 'test0221'"));
        assertTrue(sql.contains("count(*) from public.statuses) <> 1"));
        assertTrue(sql.contains("status_key = 'vertigo' and name = '眩晕'"));
        assertTrue(sql.contains("source_key = 'event_horizon_stun'"));
        assertTrue(sql.contains("e.results->0 = $result$"));
        assertTrue(sql.contains("alter column status_kind drop default"));
        assertTrue(sql.contains("to_jsonb(s) - 'status_kind'"));
        assertTrue(sql.contains("slow_effects_before except"));
        assertTrue(sql.contains("slow_references_before except"));
        assertFalse(sql.contains("update public.statuses"));
        assertFalse(sql.contains("delete from"));
    }

    @Test
    void rootMigrationOnlyExpandsReviewedConstraintAndPreservesEveryBusinessRow() throws IOException {
        String sql = normalize(stripLineComments(readRelative("db/game_manage/migrations/add_root_status_kind.sql")));
        assertTrue(sql.startsWith("begin;"));
        assertTrue(sql.endsWith("commit;"));
        assertTrue(sql.contains("current_database() <> 'test0221'"));
        assertTrue(sql.contains("lock table public.games in share row exclusive mode"));
        assertTrue(sql.contains("lock table public.statuses in access exclusive mode"));
        assertTrue(sql.contains("lock table public.skill_effects, public.skill_object_references in share row exclusive mode"));
        assertTrue(sql.contains("data_type = 'character varying' and character_maximum_length = 32"));
        assertTrue(sql.contains("is_nullable = 'no' and column_default is null"));
        assertTrue(sql.contains("contype = 'c' and convalidated"));
        assertTrue(sql.contains("pg_get_constraintdef(oid) = $old$check (((status_kind)::text = any ((array['stun'::character varying, 'movement_slow'::character varying])::text[])))$old$"));
        assertTrue(sql.contains("count(*) from public.statuses) <> 1"));
        assertTrue(sql.contains("status_key = 'vertigo' and name = '眩晕' and status_kind = 'stun'"));
        assertTrue(sql.contains("created_at = timestamptz '2026-08-28 22:55:06.53067+08'"));
        assertTrue(sql.contains("updated_at = timestamptz '2026-08-28 22:55:06.53067+08'"));
        assertTrue(sql.contains("count(*) from public.skill_effects) <> 923"));
        assertTrue(sql.contains("count(*) from public.skill_object_references) <> 9026"));
        assertTrue(sql.contains("drop constraint ck_statuses_kind"));
        assertTrue(sql.contains("add constraint ck_statuses_kind check (status_kind in ('stun', 'movement_slow', 'root'))"));
        assertTrue(sql.contains("pg_get_constraintdef(oid) = $new$check (((status_kind)::text = any ((array['stun'::character varying, 'movement_slow'::character varying, 'root'::character varying])::text[])))$new$"));
        for (String table : List.of("root_status_before", "root_effects_before", "root_references_before")) {
            assertTrue(sql.contains("select body from " + table + " except all select to_jsonb("));
            assertTrue(sql.contains("except all select body from " + table));
        }
        assertFalse(Pattern.compile("\\b(insert\\s+into|update|delete\\s+from|truncate)\\s+public\\.").matcher(sql).find());
        assertFalse(sql.contains("add column"));
        assertFalse(sql.contains("drop table"));
        assertFalse(sql.contains("cascade"));
        assertFalse(sql.contains("status_kinds_and_slow_strength.sql"));
    }

    private static String extractDoBlock(String sql) {
        Matcher matcher = Pattern.compile("(?is)DO\\s+\\$.*?\\$.*?END\\s*\\$.*?\\$").matcher(sql);
        assertTrue(matcher.find(), "DO catalog check block missing");
        return matcher.group();
    }

    private static String stripLineComments(String raw) {
        return Pattern.compile("(?m)--[^\\n]*").matcher(raw).replaceAll("");
    }

    private static String normalize(String value) {
        return value.toLowerCase().replaceAll("\\s+", " ").trim();
    }

    private static String readRelative(String relative) throws IOException {
        return Files.readString(resolveRelative(relative), StandardCharsets.UTF_8);
    }

    private static Path resolveRelative(String relative) {
        Path cwd = Paths.get("").toAbsolutePath().normalize();
        List<Path> candidates = List.of(
            cwd.resolve("../../" + relative).normalize(),
            cwd.resolve("../" + relative).normalize(),
            cwd.resolve(relative).normalize()
        );
        for (Path candidate : candidates) {
            if (Files.isRegularFile(candidate)) {
                return candidate;
            }
        }
        fail("unable to resolve " + relative + " from cwd=" + cwd);
        return null;
    }
}
