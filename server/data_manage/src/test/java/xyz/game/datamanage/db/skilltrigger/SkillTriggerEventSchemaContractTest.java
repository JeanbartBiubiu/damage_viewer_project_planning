package xyz.game.datamanage.db.skilltrigger;

import org.junit.jupiter.api.Test;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SkillTriggerEventSchemaContractTest {
    @Test
    void currentSchemaAndMigrationAcceptExactlyTheJavaEvents() throws Exception {
        Set<String> events = Arrays.stream(SkillTriggerEventType.values())
                .map(Enum::name).collect(Collectors.toSet());
        Path db = Path.of("../../db/game_manage");
        for (String file : new String[]{"schema.sql", "migrations/source_initialized_event.sql"}) {
            String sql = Files.readString(db.resolve(file));
            var constraint = Pattern.compile("CONSTRAINT\\s+ck_skill_trigger_rules_event_type\\s+CHECK\\s*\\(event_type\\s+IN\\s*\\(([^)]*)\\)", Pattern.CASE_INSENSITIVE)
                    .matcher(sql);
            assertTrue(constraint.find(), file + " event constraint missing");
            Set<String> accepted = Pattern.compile("'([A-Z_]+)'").matcher(constraint.group(1))
                    .results().map(match -> match.group(1)).collect(Collectors.toSet());
            assertEquals(events, accepted, file + " and application event types differ");
        }
    }
}
