package xyz.game.datamanage.db.modifierzone;

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
    void schemaDefinesIndependentZonesAndThreeResultReferences() throws IOException {
        String sql = normalized(read("db/game_manage/schema.sql"));
        String zones = tableBody(sql, "public.modifier_zones");
        String attributes = tableBody(sql, "public.skill_effect_attribute_change_details");
        String damage = tableBody(sql, "public.skill_effect_damage_modifier_details");
        String healing = tableBody(sql, "public.skill_effect_healing_modifier_details");

        assertTrue(zones.contains("primary key (game_id, modifier_zone_key)"));
        assertTrue(zones.contains("domain in ('attribute', 'damage', 'healing')"));
        assertTrue(zones.contains("calculation_mode in ('flat_add', 'ratio_add')"));
        assertTrue(zones.contains("damage_pre_defense"));
        assertTrue(zones.contains("damage_post_defense"));
        assertTrue(zones.contains("healing_result"));
        assertTrue(sql.contains("create unique index uq_modifier_zones_name"));

        assertTrue(attributes.contains("modifier_zone_key varchar(64)"));
        assertFalse(attributes.contains("modifier_zone_key varchar(64) not null"));
        assertTrue(damage.contains("modifier_zone_key varchar(64) not null"));
        assertTrue(healing.contains("modifier_zone_key varchar(64) not null"));
        assertTrue(sql.contains("fk_skill_effect_attribute_change_details_zone"));
        assertTrue(sql.contains("fk_skill_effect_damage_modifier_zone"));
        assertTrue(sql.contains("fk_skill_effect_healing_modifier_zone"));
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
    void deferredTriggersProtectDomainLifecycleAndDynamicFormulaRules() throws IOException {
        String sql = normalized(read("db/game_manage/triggers.sql"));

        assertTrue(sql.contains("damage_modifier modifier zone domain invalid"));
        assertTrue(sql.contains("healing_modifier modifier zone domain invalid"));
        assertTrue(sql.contains("persistent attribute adjustment requires modifier zone"));
        assertTrue(sql.contains("non-persistent attribute change forbids modifier zone"));
        assertTrue(sql.contains("moment_evaluation forbids reapplication_value_mode"));
        assertTrue(sql.contains("moment_evaluation formula uses runtime input"));
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
