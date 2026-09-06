package xyz.game.datamanage.db.skilleffect;

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

/** 历史兼容迁移的安全边界；当前聚合业务行为由 SkillEffectServiceTest 覆盖。 */
class SkillEffectBasicResultManagementDbContractSqlTest {

    private static final String MIGRATION_RELATIVE =
        "db/game_manage/migrations/compatibility/skill_effect_basic_result_management_migration.sql";

    private static final List<String> TARGET_TABLES = List.of(
        "skill_effects",
        "skill_effect_results",
        "skill_effect_result_values",
        "skill_effect_damage_details",
        "skill_effect_attribute_change_details",
        "skill_effect_resource_change_details",
        "skill_effect_cooldown_change_details",
        "skill_effect_status_operation_details"
    );

    private static final List<String> INTERNAL_CASCADE_FKS = List.of(
        "fk_skill_effect_results_effect",
        "fk_skill_effect_result_values_result",
        "fk_skill_effect_damage_details_result",
        "fk_skill_effect_attribute_change_details_result",
        "fk_skill_effect_resource_change_details_result",
        "fk_skill_effect_cooldown_change_details_result",
        "fk_skill_effect_status_operation_details_result"
    );

    private static String migrationSql;
    private static String migrationNormalized;

    @BeforeAll
    static void loadArtifacts() throws IOException {
        migrationSql = readRelative(MIGRATION_RELATIVE);
        migrationNormalized = normalize(stripLineComments(migrationSql));
    }

    @Test
    void compatibilityMigrationPreflightsPrerequisitesAndFailsClosedOnPartialStructure() {
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
        assertTrue(catalogChecks.contains("raise exception"));

        assertTrue(catalogChecks.contains("prerequisite public.skills is missing or incompatible"));
        assertTrue(catalogChecks.contains("prerequisite public.skill_formulas is missing or incompatible"));
        assertTrue(catalogChecks.contains("prerequisite public.damage_types is missing or incompatible"));
        assertTrue(catalogChecks.contains("prerequisite public.attributes is missing or incompatible"));
        assertTrue(catalogChecks.contains("prerequisite public.statuses is missing or incompatible"));
        assertTrue(catalogChecks.contains("pk_skills"));
        assertTrue(catalogChecks.contains("pk_skill_formulas"));
        assertTrue(catalogChecks.contains("pk_damage_types"));
        assertTrue(catalogChecks.contains("pk_attributes"));
        assertTrue(catalogChecks.contains("pk_statuses"));

        assertTrue(catalogChecks.contains("existing_count not in (0, 8)"));
        assertTrue(catalogChecks.contains("partial target structure exists"));
        assertTrue(catalogChecks.contains("confdeltype <> 'c'") || catalogChecks.contains("confdeltype<>'c'"));
        assertTrue(catalogChecks.contains("confdeltype = 'c'") || catalogChecks.contains("confdeltype='c'"));

        int prereqPos = catalogChecks.indexOf("prerequisite public.skills");
        int partialPos = catalogChecks.indexOf("existing_count not in (0, 8)");
        int createPos = catalogChecks.indexOf("create table public.skill_effects");
        assertTrue(prereqPos >= 0 && prereqPos < partialPos);
        assertTrue(partialPos >= 0 && partialPos < createPos);

        assertFalse(catalogChecks.contains("create table if not exists"));
        assertFalse(catalogChecks.contains("create index if not exists"));
        for (String tableName : TARGET_TABLES) {
            assertTrue(catalogChecks.contains("create table public." + tableName));
        }
    }

    @Test
    void compatibilityMigrationNormalizesNumericCastsWhenCheckingMultiplierConstraint() {
        String catalogChecks = stripLineComments(extractDoBlock(migrationSql));
        int start = catalogChecks.indexOf("ck_skill_effect_result_values_multiplier");
        assertTrue(start >= 0, "multiplier constraint check missing");
        int end = catalogChecks.indexOf("ck_skill_effect_result_values_bounds", start);
        assertTrue(end > start, "bounds constraint check missing after multiplier check");
        String multiplierCheck = catalogChecks.substring(start, end);

        assertTrue(multiplierCheck.contains("pg_get_constraintdef"));
        assertTrue(multiplierCheck.contains("regexp_replace"));
        assertTrue(
            Pattern.compile("fixed_multiplier\\s*>=\\s*0").matcher(multiplierCheck).find(),
            "must still require expression fixed_multiplier >= 0"
        );
        assertTrue(
            multiplierCheck.contains("(0)::numeric"),
            "must normalize PostgreSQL numeric constant casts such as (0)::numeric"
        );
        assertTrue(
            Pattern.compile("\\[\\(\\)\\]").matcher(multiplierCheck).find(),
            "must strip unsemantic parentheses after numeric-cast normalization"
        );
        assertFalse(
            Pattern.compile("fixed_multiplier\\s*>\\s*0").matcher(multiplierCheck).find(),
            "must not treat fixed_multiplier > 0 as compatible"
        );
        assertFalse(
            Pattern.compile("fixed_multiplier\\s*>=\\s*1").matcher(multiplierCheck).find(),
            "must not treat fixed_multiplier >= 1 as compatible"
        );
    }

    @Test
    void migrationDoesNotReadLegacyDataSeedDeleteOrDropCascade() {
        assertFalse(migrationNormalized.contains("create table if not exists public.skill_effects"));
        assertFalse(Pattern.compile("(?is)\\bdelete\\s+from\\b").matcher(migrationNormalized).find());
        assertFalse(Pattern.compile("(?is)\\bdrop\\s+table\\b").matcher(migrationNormalized).find());
        assertFalse(Pattern.compile("(?is)\\bdrop\\s+cascade\\b").matcher(migrationNormalized).find());
        assertFalse(Pattern.compile("(?is)drop\\s+\\w+\\s+.*cascade").matcher(migrationNormalized).find());
        assertFalse(Pattern.compile("(?is)\\binsert\\s+into\\b").matcher(migrationNormalized).find());
        assertFalse(Pattern.compile("(?i)\\bability\\b").matcher(migrationNormalized).find());
        assertFalse(migrationNormalized.contains("provider"));
        assertFalse(migrationNormalized.contains("combat-data"));
        assertFalse(migrationNormalized.contains("versions:publish"));
        assertFalse(migrationNormalized.contains("wasm"));
        assertFalse(migrationNormalized.contains("种子"));
        assertFalse(migrationNormalized.contains("发布"));
        assertFalse(migrationNormalized.contains("status_definitions"));
        assertFalse(migrationNormalized.contains("old_effect"));
        assertFalse(migrationNormalized.contains("legacy_effect"));

        Matcher cascade = Pattern.compile("on delete cascade").matcher(migrationNormalized);
        int cascadeCount = 0;
        while (cascade.find()) {
            cascadeCount++;
        }
        assertTrue(cascadeCount >= INTERNAL_CASCADE_FKS.size());
        for (String constraint : INTERNAL_CASCADE_FKS) {
            assertTrue(
                migrationNormalized.contains(constraint),
                () -> "migration missing ownership FK " + constraint
            );
        }
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
