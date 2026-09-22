package xyz.game.datamanage.db.modifierzone;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Locale;
import org.junit.jupiter.api.Test;

class ModifierZoneManagementDbContractSqlTest {

    @Test
    void schemaKeepsIndependentZonesAndResultsReferenceThemFromJson() throws IOException {
        String sql = normalized(read("db/game_manage/schema.sql"));
        String zones = tableBody(sql, "public.modifier_zones");
        String effects = tableBody(sql, "public.skill_effects");

        assertTrue(zones.contains("primary key (game_id, modifier_zone_key)"));
        assertTrue(zones.contains("domain in ('attribute', 'damage', 'healing', 'shield')"));
        assertTrue(zones.contains("calculation_mode in ('flat_add', 'ratio_add', 'ratio_max')"));
        assertTrue(zones.contains("varchar(16) not null"));
        assertTrue(zones.contains("and calculation_mode = 'ratio_max'"));
        assertTrue(zones.contains("and application_stage = 'healing_result'"));
        assertTrue(zones.contains("damage_pre_defense"));
        assertTrue(zones.contains("damage_post_defense"));
        assertTrue(zones.contains("healing_result"));
        assertTrue(sql.contains("create unique index uq_modifier_zones_name"));

        assertTrue(effects.contains("results jsonb not null"));
        for (String oldTable : new String[] {"skill_effect_attribute_change_details", "skill_effect_damage_modifier_details",
                "skill_effect_healing_modifier_details"}) {
            assertFalse(sql.contains("create table public." + oldTable));
        }
        String mapper = read("server/data_manage/src/main/resources/mapper/modifierzone/ModifierZoneMapper.xml");
        String effectMapper = read("server/data_manage/src/main/resources/mapper/skilleffect/SkillEffectMapper.xml");
        String readModel = read("server/data_manage/src/main/resources/mapper/authoring/AuthoringReadModel.xml");
        for (String fragment : new String[] {"effectAttributeChangeDetails", "effectDamageModifierDetails", "effectHealingModifierDetails", "effectShieldReceivedModifierDetails"}) {
            assertTrue(mapper.contains("AuthoringReadModel." + fragment));
            assertTrue(readModel.contains("<sql id=\"" + fragment + "\">"));
        }
        assertTrue(readModel.contains("jsonb_array_elements(r.results)"));
        assertTrue(readModel.contains("j->'detail'->>'modifierZoneKey'"));
        assertTrue(effectMapper.contains("calculation_mode"));
        assertTrue(effectMapper.contains("SkillEffectModifierZoneLockRow"));
    }

    @Test
    void migrationOnlyAllowsTheOwnerApprovedExistingMapping() throws IOException {
        String sql = normalized(read(
            "db/game_manage/migrations/compatibility/modifier_zone_management_migration.sql"
        ));

        assertTrue(sql.contains("modifier zone migration requires owner mapping or deletion first"));
        assertTrue(sql.contains("b.moment = 'persistent'"));
        assertTrue(sql.contains("d.operation in ('increase', 'decrease')"));
        assertTrue(sql.contains("'attribute_percent_bonus'"));
        assertTrue(sql.contains("d.skill_key = 'ez_p'"));
        assertTrue(sql.contains("d.effect_key = 'rising_spell_force'"));
        assertTrue(sql.contains("d.result_key = 'attack_speed_gain'"));
        assertTrue(sql.contains("d.attribute_key = 'bonus_attack_speed_percent'"));
        assertTrue(sql.contains("update public.skill_effect_attribute_change_details"));
        assertFalse(sql.contains("set modifier_zone_key = coalesce"));
    }

    @Test
    void servicesProtectDomainLifecycleDynamicInputsAndReferencedZoneMutation() throws IOException {
        String effects = read("server/data_manage/src/main/java/xyz/game/datamanage/service/skilleffect/SkillEffectService.java");
        String zones = read("server/data_manage/src/main/java/xyz/game/datamanage/service/modifierzone/ModifierZoneService.java");
        String references = read("server/data_manage/src/main/java/xyz/game/datamanage/support/authoring/SkillObjectReferences.java");
        for (String domain : new String[] {"ATTRIBUTE", "DAMAGE", "HEALING"}) assertTrue(effects.contains("ModifierZoneDomain." + domain));
        assertTrue(effects.contains("MODIFIER_ZONE_DOMAIN_MISMATCH"));
        assertTrue(effects.contains("boolean persistentAdjustment"));
        assertTrue(effects.contains("HealingRatioMaxSemantics.addReferenceIssues("));
        assertTrue(effects.contains("zone.calculationMode()"));
        assertTrue(effects.contains("\"该结果不能选择乘区\""));
        assertTrue(effects.contains("\"乘区不能为空\""));
        assertTrue(effects.contains("SkillEffectLifecycleValueReadMode.MOMENT_EVALUATION"));
        assertTrue(effects.contains("behavior.reapplicationValueMode() != null"));
        assertTrue(effects.contains("RUNTIME_INPUT_FORBIDDEN"));
        assertTrue(zones.contains("configurationWrites.begin(gameId)"));
        assertTrue(zones.contains("structuralFieldsChanged(current, request)"));
        assertTrue(zones.contains("ModifierZoneCombinations.isLegal"));
        assertTrue(zones.contains("calculationMode == ModifierZoneCalculationMode.RATIO_MAX"));
        assertTrue(zones.contains("referenceCount(gameId, modifierZoneKey) > 0"));
        assertTrue(references.contains("\"modifierZoneKey\", TargetType.MODIFIER_ZONE"));
    }

    @Test
    void healingRatioMaxMigrationOnlyExpandsTwoExistingChecks() throws IOException {
        String sql = read("db/game_manage/migrations/healing_ratio_max.sql");
        String executable = sql.replaceAll("(?m)--[^\\n]*", "");
        assertTrue(sql.contains("BEGIN;"));
        assertTrue(sql.contains("COMMIT;"));
        assertTrue(sql.contains("ck_modifier_zones_calculation_mode"));
        assertTrue(sql.contains("ck_modifier_zones_combination"));
        assertTrue(sql.contains("RATIO_MAX"));
        assertTrue(sql.contains("禁止重放"));
        assertTrue(sql.contains("约束漂移或已执行"));
        assertTrue(sql.contains("DROP CONSTRAINT ck_modifier_zones_calculation_mode"));
        assertTrue(sql.contains("DROP CONSTRAINT ck_modifier_zones_combination"));
        assertFalse(executable.toLowerCase(Locale.ROOT).contains("cascade"));
        assertFalse(executable.contains("ALTER TABLE public.modifier_zones ADD COLUMN"));
        assertFalse(executable.contains("CREATE TABLE public."));
        assertFalse(executable.contains("DROP TABLE public."));
        assertFalse(executable.contains("CREATE INDEX"));
        assertTrue(sql.contains("pk_modifier_zones"));
        assertTrue(sql.contains("fk_modifier_zones_game"));
        assertTrue(sql.contains("uq_modifier_zones_name"));
        assertTrue(sql.contains("character_maximum_length = 16"));
        assertTrue(sql.contains("healing_ratio_max_zones_before"));
        assertTrue(sql.contains("EXCEPT ALL"));
        assertEquals(2, count(executable, "DROP CONSTRAINT"));
        String schema = normalized(read("db/game_manage/schema.sql"));
        assertTrue(schema.contains("calculation_mode in ('flat_add', 'ratio_add', 'ratio_max')"));
        assertTrue(schema.contains("domain = 'healing' and calculation_mode = 'ratio_max'"));
    }

    private static int count(String text, String fragment) {
        int total = 0;
        for (int index = 0; (index = text.indexOf(fragment, index)) >= 0; index += fragment.length()) {
            total++;
        }
        return total;
    }

    private static String tableBody(String sql, String table) {
        int start = sql.indexOf("create table " + table);
        int end = sql.indexOf(";", start);
        assertTrue(start >= 0 && end > start, "missing " + table);
        return sql.substring(start, end);
    }

    private static String read(String relative) throws IOException {
        return Files.readString(resolveRepositoryRoot().resolve(relative), StandardCharsets.UTF_8);
    }

    private static String normalized(String value) {
        return value.toLowerCase(Locale.ROOT).replaceAll("\\s+", " ").trim();
    }

    private static Path resolveRepositoryRoot() {
        Path current = Paths.get("").toAbsolutePath().normalize();
        for (Path candidate = current; candidate != null; candidate = candidate.getParent()) {
            if (Files.isRegularFile(candidate.resolve("server/data_manage/pom.xml"))) {
                return candidate;
            }
        }
        throw new IllegalStateException("cannot resolve repository root from " + current);
    }
}
