package xyz.game.datamanage.service.simulation.availability;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class SimulationAvailabilityMapperTest {
    @Test
    void batchStatementIsMappedReadOnlyAndCoversAllBusinessParts() throws Exception {
        String resource = "mapper/simulation/SimulationAvailabilityMapper.xml";
        Configuration configuration = new Configuration();
        try (InputStream input = getClass().getClassLoader().getResourceAsStream(resource)) {
            assertNotNull(input);
            new XMLMapperBuilder(input, configuration, resource, configuration.getSqlFragments()).parse();
        }
        var statement = configuration.getMappedStatement("xyz.game.datamanage.mapper.simulation.SimulationAvailabilityMapper.readGameRows");
        String sql = statement.getBoundSql(Map.of("gameId", "lol")).getSql().toLowerCase();
        assertEquals("SELECT", statement.getSqlCommandType().name());
        assertEquals(1, statement.getBoundSql(Map.of("gameId", "lol")).getParameterMappings().size());
        for (String table : new String[] {"characters", "character_attributes", "character_skill_relations", "equipment",
            "equipment_attributes", "equipment_skill_relations", "skills", "skill_parameters", "skill_formulas", "skill_effects",
            "skill_internal_states", "skill_processes", "skill_trigger_rules", "skill_category_relations", "skill_object_references",
            "attributes", "skill_categories", "damage_types", "modifier_zones", "statuses", "game_vamp_rules", "game_level_configs", "game_calculation_rules"}) {
            assertTrue(sql.contains("public." + table + " t join selected_game using (game_id)"), table);
        }
        assertFalse(sql.contains("for update"));
        assertFalse(sql.contains("insert "));
        assertFalse(sql.contains("delete "));
        assertTrue(sql.contains("array['created_at', 'updated_at']"));
        assertEquals("xyz.game.datamanage.mapper.simulation.SimulationAvailabilityMapper$Row", statement.getResultMaps().getFirst().getType().getName());
    }
}
