package xyz.game.datamanage.db.skilleffect;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueKey;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultOutputKind;

/** Static SQL contract for public skill scope and skill haste modifier. */
class SkillScopeManagementDbContractSqlTest {

    private static final List<String> NEW_TABLES = List.of(
        "skill_effect_result_skill_scopes",
        "skill_effect_result_skill_targets",
        "skill_effect_result_skill_category_targets",
        "skill_effect_haste_modifier_details"
    );

    private static final List<String> RESULT_TYPES = List.of(
        "ATTACK_LINK_APPLICATION", "ATTRIBUTE_CHANGE", "COOLDOWN_CHANGE", "DAMAGE",
        "DAMAGE_IMMUNITY", "DAMAGE_MODIFIER", "DIRECT_HEAL", "EXECUTE",
        "HEALING_MODIFIER", "HEALTH_FLOOR", "HIT_LINK_APPLICATION",
        "LIFECYCLE_OPERATION", "NORMAL_SHIELD", "RESOURCE_CHANGE", "SKILL_HASTE_MODIFIER",
        "SPELL_SHIELD", "STATUS_OPERATION"
    );

    private static String schema;
    private static String triggers;
    private static String migration;

    @BeforeAll
    static void loadArtifacts() throws IOException {
        schema = read("db/game_manage/schema.sql");
        triggers = read("db/game_manage/triggers.sql");
        migration = read("db/game_manage/migrations/compatibility/skill_scope_management_migration.sql");
    }

    @Test
    void currentSchemaOwnsFinalEightyEightParentsAndSeventeenResults() {
        List<String> created = extractCreateTableNames(schema);
        assertEquals(88, created.size());
        assertEquals(17, SkillEffectResultType.values().length);
        assertEquals(21, SkillTriggerEventType.values().length);
        assertEquals(10, SkillTriggerPriorResultOutputKind.values().length);
        assertEquals(23, SkillTriggerEventValueKey.values().length);
        for (String table : NEW_TABLES) {
            assertTrue(created.contains(table), () -> "missing " + table);
        }
        assertFalse(created.contains("skill_effect_cooldown_change_targets"));
        assertFalse(schema.contains("CREATE TABLE public.skill_effect_cooldown_change_targets"));

        List<String> types = extractQuotedUppercase(extractConstraint(
            extractCreateTable(schema, "skill_effect_results"),
            "ck_skill_effect_results_type"
        ));
        assertEquals(RESULT_TYPES, types);
    }

    @Test
    void newTablesUseCompositeKeysRestrictCatalogDeletesAndOmitJsonbArrays() {
        String scopes = normalize(extractCreateTable(schema, "skill_effect_result_skill_scopes"));
        assertTrue(scopes.contains("primary key (game_id, skill_key, effect_key, result_key)"));
        assertTrue(scopes.contains("constraint fk_skill_effect_result_skill_scopes_result"));
        assertTrue(scopes.contains("on delete cascade"));
        assertTrue(scopes.contains("mode in ('all', 'skills', 'categories')"));

        String skills = normalize(extractCreateTable(schema, "skill_effect_result_skill_targets"));
        assertTrue(skills.contains(
            "primary key (game_id, skill_key, effect_key, result_key, affected_skill_key)"
        ));
        assertTrue(skills.contains("constraint fk_skill_effect_result_skill_targets_scope"));
        assertTrue(skills.contains("constraint fk_skill_effect_result_skill_targets_skill"));
        assertTrue(Pattern.compile(
            "(?is)fk_skill_effect_result_skill_targets_scope.*?on delete cascade"
        ).matcher(skills).find());
        assertFalse(Pattern.compile(
            "(?is)fk_skill_effect_result_skill_targets_skill[^,]*on delete cascade"
        ).matcher(skills).find());
        assertTrue(normalize(schema).contains(
            "create index ix_skill_effect_result_skill_targets_skill "
                + "on public.skill_effect_result_skill_targets "
                + "(game_id, affected_skill_key, skill_key, effect_key, result_key)"
        ));

        String categories = normalize(extractCreateTable(schema, "skill_effect_result_skill_category_targets"));
        assertTrue(categories.contains(
            "primary key (game_id, skill_key, effect_key, result_key, skill_category_key)"
        ));
        assertTrue(categories.contains("constraint fk_skill_effect_result_skill_category_targets_scope"));
        assertTrue(categories.contains("constraint fk_skill_effect_result_skill_category_targets_category"));
        assertTrue(Pattern.compile(
            "(?is)fk_skill_effect_result_skill_category_targets_scope.*?on delete cascade"
        ).matcher(categories).find());
        assertFalse(Pattern.compile(
            "(?is)fk_skill_effect_result_skill_category_targets_category[^,]*on delete cascade"
        ).matcher(categories).find());
        assertTrue(normalize(schema).contains(
            "create index ix_skill_effect_result_skill_category_targets_category "
                + "on public.skill_effect_result_skill_category_targets "
                + "(game_id, skill_category_key, skill_key, effect_key, result_key)"
        ));

        String haste = normalize(extractCreateTable(schema, "skill_effect_haste_modifier_details"));
        assertTrue(haste.contains("primary key (game_id, skill_key, effect_key, result_key)"));
        assertTrue(haste.contains("constraint fk_skill_effect_haste_modifier_details_result"));
        assertTrue(haste.contains("on delete cascade"));
        assertTrue(haste.contains("operation in ('increase', 'decrease')"));
        assertFalse(haste.contains("modifier_zone"));
        assertFalse(haste.contains("affected_skill"));

        for (String table : NEW_TABLES) {
            String body = normalize(extractCreateTable(schema, table));
            assertFalse(body.contains("jsonb"), () -> table + " must not use jsonb");
            assertFalse(body.contains("json "), () -> table + " must not use json");
            assertFalse(body.contains("integer[]"), () -> table + " must not use arrays");
            assertFalse(body.contains("text[]"), () -> table + " must not use arrays");
            assertFalse(body.contains("varchar[]"), () -> table + " must not use arrays");
            assertFalse(body.contains("object_type"), () -> table + " must not be polymorphic");
        }
    }

    @Test
    void deferredShapeWatchesPublicScopeAndHasteAndDropsOldTargetAssertion() {
        String normalized = normalize(triggers);
        assertTrue(normalized.contains("v_skill_scope_count int"));
        assertTrue(normalized.contains("v_haste_count int"));
        assertTrue(normalized.contains("v_result_type = 'skill_haste_modifier'"));
        assertTrue(normalized.contains("all skill scope must not have targets at commit"));
        assertTrue(normalized.contains("skills scope requires explicit skills at commit"));
        assertTrue(normalized.contains("categories scope requires skill categories at commit"));
        assertFalse(normalized.contains("v_cooldown_target_count"));
        assertFalse(triggers.contains("'skill_effect_cooldown_change_targets'"));
        for (String table : NEW_TABLES) {
            assertTrue(triggers.contains("'" + table + "'"), () -> "deferred list missing " + table);
        }
        assertTrue(triggers.contains("SKILL_HASTE_MODIFIER snapshot merge invalid"));
        assertTrue(triggers.contains("'SKILL_HASTE_MODIFIER'"));
    }

    @Test
    void migrationCopiesCooldownTargetsInOneTransactionAndIsFailClosed() {
        String normalized = normalize(migration);
        assertTrue(normalized.startsWith("-- 阶段 7 验收补项"));
        assertTrue(normalized.contains("begin;"));
        assertTrue(normalized.endsWith("commit;"));
        assertEquals(1, count(normalized, "begin;"));
        assertEquals(1, count(normalized, "commit;"));
        assertTrue(normalized.contains("parent table count drifted"));
        assertTrue(normalized.contains("skill scope structure is partial"));
        assertTrue(normalized.contains("precondition requires skill_effect_cooldown_change_targets"));
        assertTrue(normalized.contains("target state still has skill_effect_cooldown_change_targets"));
        assertTrue(normalized.contains("lock table public.skill_effect_results"));
        assertTrue(normalized.contains("access exclusive"));
        assertTrue(normalized.contains("insert into public.skill_effect_result_skill_scopes"));
        assertTrue(normalized.contains("'skills'"));
        assertTrue(normalized.contains("insert into public.skill_effect_result_skill_targets"));
        assertTrue(normalized.contains("from public.skill_effect_cooldown_change_targets"));
        assertTrue(normalized.contains("cooldown target copy count mismatch"));
        assertTrue(normalized.contains("counted.old_count <> counted.new_count"));
        assertTrue(normalized.contains("v_new_scope_count <> v_cooldown_result_count"));
        assertTrue(normalized.contains("v_new_target_count <> v_old_target_count"));
        assertTrue(normalized.contains("drop table public.skill_effect_cooldown_change_targets"));
        int copy = normalized.indexOf("insert into public.skill_effect_result_skill_targets");
        int drop = normalized.indexOf("drop table public.skill_effect_cooldown_change_targets");
        assertTrue(copy >= 0 && drop > copy);
        assertTrue(normalized.contains("v_new_count not in (0, 4)"));
        assertTrue(normalized.contains("unknown structure")
            || normalized.contains("skill_effect_result_skill_scopes unknown structure"));
        assertTrue(normalized.contains("v_state") || normalized.contains("v_new_count = 0"));
        assertFalse(normalized.contains("jsonb"));
        assertFalse(Pattern.compile("(?is)\\bdrop\\s+table\\s+[^;]*\\bcascade\\b").matcher(normalized).find());
        assertFalse(normalized.contains("insert into public.skill_effect_haste_modifier_details"));
    }

    @Test
    void migrationCreateTableBodiesMatchCurrentSchema() {
        for (String table : NEW_TABLES) {
            String schemaTable = normalize(stripIfNotExists(extractCreateTable(schema, table)));
            String migrationTable = normalize(stripIfNotExists(extractCreateTable(migration, table)));
            assertEquals(schemaTable, migrationTable, () -> "CREATE TABLE drifted for " + table);
        }
        assertTrue(normalize(migration).contains(
            "create index if not exists ix_skill_effect_result_skill_targets_skill"
        ));
        assertTrue(normalize(migration).contains(
            "create index if not exists ix_skill_effect_result_skill_category_targets_category"
        ));
    }

    @Test
    void migrationRefreshesShapeFunctionsThenDropsOldTable() {
        String normalized = normalize(migration);
        int functions = normalized.indexOf(
            "create or replace function public.trg_skill_effect_result_complete_shape()"
        );
        int lifecycle = normalized.indexOf(
            "create or replace function public.trg_skill_effect_lifecycle_aggregate_shape()"
        );
        int drop = normalized.indexOf("drop table public.skill_effect_cooldown_change_targets");
        int postcheck = normalized.indexOf("migration postcheck parent table count drifted");
        assertTrue(functions >= 0 && lifecycle > functions && drop > lifecycle && postcheck > drop);
        assertTrue(migration.contains("SKILL_HASTE_MODIFIER"));
        assertTrue(migration.contains("ALL skill scope must not have targets at commit"));
        assertFalse(Pattern.compile("(?is)v_cooldown_target_count\\s+int").matcher(
            extractFunction(migration, "trg_skill_effect_result_complete_shape")
        ).find());
    }

    private static String extractFunction(String sql, String name) {
        Matcher matcher = Pattern.compile(
            "(?is)CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\." + Pattern.quote(name)
                + "\\(\\)(.*?)COMMENT ON FUNCTION"
        ).matcher(sql);
        if (!matcher.find()) {
            throw new AssertionError("missing function " + name);
        }
        return matcher.group();
    }

    private static String stripIfNotExists(String sql) {
        return sql.replaceAll("(?i)IF\\s+NOT\\s+EXISTS\\s+", "");
    }

    private static List<String> extractCreateTableNames(String sql) {
        Matcher matcher = Pattern.compile("(?m)^CREATE TABLE public\\.([a-z0-9_]+)").matcher(sql);
        List<String> names = new ArrayList<>();
        while (matcher.find()) {
            names.add(matcher.group(1));
        }
        return names;
    }

    private static String extractCreateTable(String sql, String tableName) {
        Matcher matcher = Pattern.compile(
            "(?is)CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+public\\." + Pattern.quote(tableName)
                + "\\s*\\((.*?)\\n\\);"
        ).matcher(sql);
        if (!matcher.find()) {
            throw new AssertionError("missing CREATE TABLE public." + tableName);
        }
        return matcher.group();
    }

    private static String extractConstraint(String tableSql, String constraintName) {
        Matcher matcher = Pattern.compile(
            "(?is)CONSTRAINT\\s+" + Pattern.quote(constraintName) + "\\s+CHECK\\s*\\((.*?)\\)\\s*(?:,|\\n\\))"
        ).matcher(tableSql);
        if (!matcher.find()) {
            throw new AssertionError("missing constraint " + constraintName);
        }
        return matcher.group(1);
    }

    private static List<String> extractQuotedUppercase(String sql) {
        Matcher matcher = Pattern.compile("'([A-Z_]+)'").matcher(sql);
        List<String> values = new ArrayList<>();
        while (matcher.find()) {
            values.add(matcher.group(1));
        }
        return values.stream().sorted().toList();
    }

    private static int count(String sql, String token) {
        int found = 0;
        int from = 0;
        while (true) {
            int at = sql.indexOf(token, from);
            if (at < 0) {
                return found;
            }
            found++;
            from = at + token.length();
        }
    }

    private static String normalize(String sql) {
        return sql.toLowerCase().replaceAll("\\s+", " ").trim();
    }

    private static String read(String relative) throws IOException {
        Path root = findRepoRoot();
        return Files.readString(root.resolve(relative), StandardCharsets.UTF_8);
    }

    private static Path findRepoRoot() {
        Path current = Paths.get("").toAbsolutePath();
        while (current != null) {
            if (Files.isRegularFile(current.resolve("db/game_manage/schema.sql"))) {
                return current;
            }
            current = current.getParent();
        }
        throw new IllegalStateException("repository root not found");
    }
}
