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
    void currentSchemaAcceptsTheJavaEventsAndHistoricalMigrationKeepsItsOldSet() throws Exception {
        Set<String> events = Arrays.stream(SkillTriggerEventType.values())
                .map(Enum::name).collect(Collectors.toSet());
        Path db = Path.of("../../db/game_manage");
        assertAcceptedEvents(Files.readString(db.resolve("schema.sql")), events, "schema.sql");
        assertAcceptedEvents(
                Files.readString(db.resolve("migrations/takedown_event.sql")),
                events,
                "migrations/takedown_event.sql"
        );

        Set<String> historicalEvents = events.stream()
                .filter(event -> !event.equals("TAKEDOWN"))
                .collect(Collectors.toSet());
        assertAcceptedEvents(
                Files.readString(db.resolve("migrations/source_initialized_event.sql")),
                historicalEvents,
                "migrations/source_initialized_event.sql"
        );
    }

    private static void assertAcceptedEvents(String sql, Set<String> expected, String file) {
        var constraint = Pattern.compile("CONSTRAINT\\s+ck_skill_trigger_rules_event_type\\s+CHECK\\s*\\(event_type\\s+IN\\s*\\(([^)]*)\\)", Pattern.CASE_INSENSITIVE)
                .matcher(sql);
        assertTrue(constraint.find(), file + " event constraint missing");
        Set<String> accepted = Pattern.compile("'([A-Z_]+)'").matcher(constraint.group(1))
                .results().map(match -> match.group(1)).collect(Collectors.toSet());
        assertEquals(expected, accepted, file + " and expected event types differ");
    }
}
