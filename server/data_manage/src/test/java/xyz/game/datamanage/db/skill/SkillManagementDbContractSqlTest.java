package xyz.game.datamanage.db.skill;

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

class SkillManagementDbContractSqlTest {

    private static final String SCHEMA_RELATIVE = "db/game_manage/schema.sql";
    private static final String MIGRATION_RELATIVE =
        "db/game_manage/migrations/compatibility/skill_management_compatibility_migration.sql";

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
    void schemaDefinesSkillsAndDedicatedRelationTable() {
        String skills = extractCreateTable(schemaSql, "skills");
        String relations = extractCreateTable(schemaSql, "skill_category_relations");
        String skillsNormalized = normalize(skills);
        String relationsNormalized = normalize(relations);

        assertTrue(skillsNormalized.contains("primary key (game_id, skill_key)"));
        assertTrue(skillsNormalized.contains("constraint pk_skills"));
        assertTrue(skillsNormalized.contains("foreign key (game_id) references public.games (game_id)"));
        assertTrue(skillsNormalized.contains("description varchar(2000)"));
        assertTrue(skillsNormalized.contains("max_level integer not null"));
        assertTrue(skillsNormalized.contains("max_level >= 1"));
        assertTrue(skillsNormalized.contains("status in ('enabled', 'disabled')"));
        assertTrue(skillsNormalized.contains("sort_order >= 0"));
        assertTrue(skillsNormalized.contains("skill_key ~ '^[a-z][a-z0-9_]{0,63}$'"));
        assertFalse(skillsNormalized.contains("on delete cascade"));
        assertFalse(skillsNormalized.contains("jsonb"));
        assertFalse(skillsNormalized.contains("integer[]"));
        assertFalse(skillsNormalized.contains("text[]"));
        assertFalse(skillsNormalized.contains("skill_category_keys"));
        assertFalse(schemaNormalized.contains("create unique index uq_skills_name"));
        assertTrue(schemaNormalized.contains(
            "create index ix_skills_list on public.skills (game_id, status, sort_order, name, skill_key)"
        ));

        assertTrue(relationsNormalized.contains("primary key (game_id, skill_key, skill_category_key)"));
        assertTrue(relationsNormalized.contains("constraint pk_skill_category_relations"));
        assertTrue(relationsNormalized.contains(
            "foreign key (game_id, skill_key) references public.skills (game_id, skill_key) on delete cascade"
        ));
        assertTrue(relationsNormalized.contains(
            "foreign key (game_id, skill_category_key) references public.skill_categories (game_id, skill_category_key) on delete restrict"
        ));
        assertFalse(relationsNormalized.contains("created_at"));
        assertFalse(relationsNormalized.contains("updated_at"));
        assertFalse(relationsNormalized.contains("status"));
        assertFalse(relationsNormalized.contains("jsonb"));
        assertFalse(relationsNormalized.contains("integer[]"));
        assertTrue(schemaNormalized.contains(
            "create index ix_skill_category_relations_category on public.skill_category_relations (game_id, skill_category_key, skill_key)"
        ));
    }

    @Test
    void compatibilityMigrationPreflightsStructureAndStaysIdempotent() {
        assertTrue(migrationNormalized.contains("create table if not exists public.skills"));
        assertTrue(migrationNormalized.contains("create table if not exists public.skill_category_relations"));
        assertTrue(migrationNormalized.contains("information_schema.columns"));
        assertTrue(migrationNormalized.contains("information_schema.tables"));
        assertTrue(migrationNormalized.contains("pg_constraint"));
        assertTrue(migrationNormalized.contains("raise exception"));
        assertTrue(migrationNormalized.contains("create index if not exists ix_skills_list"));
        assertTrue(migrationNormalized.contains("create index if not exists ix_skill_category_relations_category"));
        assertTrue(migrationNormalized.contains("on delete cascade"));
        assertTrue(migrationNormalized.contains("on delete restrict"));
        assertTrue(migrationNormalized.contains("confdeltype = 'c'"));
        assertTrue(migrationNormalized.contains("confdeltype in ('r', 'a')"));

        int catalogCheckPos = migrationNormalized.indexOf("do $$");
        int createSkillsPos = migrationNormalized.indexOf("create table if not exists public.skills");
        int createIndexPos = migrationNormalized.indexOf("create index if not exists ix_skills_list");
        assertTrue(catalogCheckPos >= 0 && catalogCheckPos < createSkillsPos);
        assertTrue(catalogCheckPos < createIndexPos);

        assertFalse(Pattern.compile("(?is)\\bdelete\\s+from\\b").matcher(migrationNormalized).find());
        assertFalse(Pattern.compile("(?is)\\bdrop\\s+table\\b").matcher(migrationNormalized).find());
        assertFalse(Pattern.compile("(?is)\\bdrop\\s+cascade\\b").matcher(migrationNormalized).find());
        assertFalse(Pattern.compile("(?is)\\binsert\\s+into\\b").matcher(migrationNormalized).find());
        assertFalse(migrationNormalized.contains("versions:publish"));
        assertFalse(migrationNormalized.contains("type_relations"));
        assertFalse(Pattern.compile("(?is)\\bprovider\\b").matcher(migrationNormalized).find());
        assertFalse(Pattern.compile("(?is)\\bability\\b").matcher(migrationNormalized).find());
    }

    @Test
    void compatibilityMigrationChecksConstraintAndIndexDefinitionsNotJustNames() {
        String catalogChecks = normalize(stripLineComments(extractDoBlock(migrationSql)));

        assertTrue(catalogChecks.contains("pg_get_constraintdef"));
        assertTrue(catalogChecks.contains("pg_attribute"));
        assertTrue(catalogChecks.contains("conkey"));
        assertTrue(catalogChecks.contains("confkey"));
        assertTrue(catalogChecks.contains("unnest("));
        assertTrue(catalogChecks.contains("pg_indexes"));
        assertTrue(catalogChecks.contains("pg_get_indexdef"));

        assertTrue(catalogChecks.contains("pk_skills"));
        assertTrue(catalogChecks.contains("array['game_id', 'skill_key']"));
        assertTrue(catalogChecks.contains("fk_skills_game"));
        assertTrue(catalogChecks.contains("array['game_id']"));
        assertTrue(catalogChecks.contains("confdeltype <> 'c'") || catalogChecks.contains("confdeltype<>'c'"));
        assertTrue(catalogChecks.contains("'public.games'::regclass"));

        assertTrue(catalogChecks.contains("ck_skills_key"));
        assertTrue(catalogChecks.contains("^[a-z][a-z0-9_]{0,63}$"));
        assertTrue(catalogChecks.contains("ck_skills_name"));
        assertTrue(catalogChecks.contains("btrim"));
        assertTrue(catalogChecks.contains("ck_skills_max_level"));
        assertTrue(
            catalogChecks.contains("max_level>=1") || catalogChecks.contains("max_level >= 1")
        );
        assertTrue(catalogChecks.contains("ck_skills_status"));
        assertTrue(catalogChecks.contains("enabled"));
        assertTrue(catalogChecks.contains("disabled"));
        assertTrue(catalogChecks.contains("ck_skills_sort_order"));
        assertTrue(
            catalogChecks.contains("sort_order>=0") || catalogChecks.contains("sort_order >= 0")
        );

        assertTrue(catalogChecks.contains("pk_skill_category_relations"));
        assertTrue(catalogChecks.contains("array['game_id', 'skill_key', 'skill_category_key']"));
        assertTrue(catalogChecks.contains("fk_skill_category_relations_skill"));
        assertTrue(catalogChecks.contains("'public.skills'::regclass"));
        assertTrue(catalogChecks.contains("fk_skill_category_relations_category"));
        assertTrue(catalogChecks.contains("array['game_id', 'skill_category_key']"));
        assertTrue(catalogChecks.contains("'public.skill_categories'::regclass"));

        assertTrue(catalogChecks.contains("ix_skills_list"));
        assertTrue(catalogChecks.contains("array['game_id', 'status', 'sort_order', 'name', 'skill_key']"));
        assertTrue(catalogChecks.contains("(game_id, status, sort_order, name, skill_key)"));
        assertTrue(catalogChecks.contains("ix_skill_category_relations_category"));
        assertTrue(catalogChecks.contains("array['game_id', 'skill_category_key', 'skill_key']"));
        assertTrue(catalogChecks.contains("(game_id, skill_category_key, skill_key)"));
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

    private static String extractDoBlock(String sql) {
        Matcher matcher = Pattern.compile("(?is)DO\\s+\\$\\$.*?END\\s+\\$\\$").matcher(sql);
        assertTrue(matcher.find(), "DO $$ catalog check block missing");
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
