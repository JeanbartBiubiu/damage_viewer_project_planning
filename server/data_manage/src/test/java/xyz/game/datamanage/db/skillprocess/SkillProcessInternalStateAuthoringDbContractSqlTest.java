package xyz.game.datamanage.db.skillprocess;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;

/** 静态存储契约；真实迁移与回读由集成验收提供。 */
class SkillProcessInternalStateAuthoringDbContractSqlTest {

    private static final List<String> PROCESS_DETAILS = List.of(
        "skill_process_steps", "skill_process_delay_step_details", "skill_process_multi_hit_step_details",
        "skill_process_periodic_step_details", "skill_process_channel_step_details", "skill_process_charge_step_details",
        "skill_process_recast_step_details", "skill_process_empowered_attack_step_details", "skill_process_cooldowns",
        "skill_process_effect_bindings", "skill_process_state_operations"
    );
    private static final List<String> STATE_DETAILS = List.of(
        "skill_internal_state_counter_details", "skill_internal_state_ammo_details", "skill_internal_state_flag_details",
        "skill_internal_state_cooldown_details", "skill_internal_state_mode_options"
    );

    @Test
    void schemaKeepsTwoRootsWithTypedDocumentsAndNoDetailTables() throws IOException {
        String schema = read("db/game_manage/schema.sql").toLowerCase();
        assertTrue(schema.contains("create table public.skill_processes"));
        assertTrue(schema.contains("create table public.skill_internal_states"));
        for (String column : List.of("steps jsonb", "cooldown jsonb", "effect_bindings jsonb",
            "state_operations jsonb", "detail jsonb")) {
            assertTrue(schema.contains(column), column);
        }
        for (String table : java.util.stream.Stream.concat(PROCESS_DETAILS.stream(), STATE_DETAILS.stream()).toList()) {
            assertFalse(schema.contains("create table public." + table + " ("), table);
        }
        assertTrue(schema.contains("fk_skill_processes_skill"));
        assertTrue(schema.contains("fk_skill_internal_states_skill"));
    }

    @Test
    void migrationCoversEveryOldShapeAndKeepsStableOrderAndNullableFields() throws IOException {
        String process = read("db/game_manage/migrations/breaking/aggregate_parts/processes.sql");
        String state = read("db/game_manage/migrations/breaking/aggregate_parts/internal_states.sql");
        for (String table : PROCESS_DETAILS) {
            assertTrue(process.contains("FROM public." + table + " "), table);
        }
        for (String table : STATE_DETAILS) {
            assertTrue(state.contains("FROM public." + table + " "), table);
        }
        for (String type : List.of("IMMEDIATE", "DELAY", "MULTI_HIT", "PERIODIC", "CHANNEL", "CHARGE",
            "RECAST", "EMPOWERED_BASIC_ATTACK")) {
            assertTrue(process.contains("WHEN '" + type + "'"), type);
        }
        for (String type : List.of("COUNTER", "AMMO", "MODE", "FLAG", "INTERNAL_COOLDOWN")) {
            assertTrue(state.contains("WHEN '" + type + "'"), type);
        }
        assertTrue(process.contains("ORDER BY s.sort_order, s.step_key"));
        assertTrue(process.contains("ORDER BY b.sort_order, b.binding_key"));
        assertTrue(process.contains("ORDER BY o.sort_order, o.operation_key"));
        assertTrue(state.contains("ORDER BY o.sort_order, o.option_key"));
        assertTrue(process.contains("'startMoment', jsonb_build_object('momentType'"));
        assertTrue(process.contains("'valueFormulaKey', o.value_formula_key, 'optionKey', o.option_key"));
        assertFalse(process.toUpperCase().contains("DROP TABLE"));
        assertFalse(state.toUpperCase().contains("DROP TABLE"));
        assertFalse(process.contains("jsonb_strip_nulls"));
        assertFalse(state.contains("jsonb_strip_nulls"));
    }

    @Test
    void mappersUseRootDocumentsAndRetainReferenceProtectionQueries() throws IOException {
        String process = read("server/data_manage/src/main/resources/mapper/skillprocess/SkillProcessMapper.xml");
        String state = read("server/data_manage/src/main/resources/mapper/skillinternalstate/SkillInternalStateMapper.xml");
        for (String table : java.util.stream.Stream.concat(PROCESS_DETAILS.stream(), STATE_DETAILS.stream()).toList()) {
            assertFalse(process.contains("public." + table + " "), table);
            assertFalse(state.contains("public." + table + " "), table);
        }
        assertTrue(process.contains("jsonb_array_length(steps)"));
        assertTrue(process.contains("jsonb_array_elements(p.steps)"));
        assertTrue(process.contains("jsonb_array_elements(p.state_operations)"));
        assertTrue(process.contains("o->'moment'->>'momentType'"));
        assertTrue(process.contains("FOR UPDATE OF p"));
        assertTrue(process.contains("FOR UPDATE OF s"));
        assertTrue(state.contains("o->>'stateKey' = #{stateKey}"));
        assertTrue(state.contains("o->>'optionKey' IN"));
    }

    private static String read(String relative) throws IOException {
        Path current = Path.of("").toAbsolutePath();
        while (current != null) {
            Path candidate = current.resolve(relative);
            if (Files.isRegularFile(candidate)) {
                return Files.readString(candidate);
            }
            current = current.getParent();
        }
        throw new IOException("缺少文件: " + relative);
    }
}
