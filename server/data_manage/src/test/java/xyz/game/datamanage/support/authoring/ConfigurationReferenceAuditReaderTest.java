package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementSetter;
import org.springframework.jdbc.core.RowMapper;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Target;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.TargetType;

class ConfigurationReferenceAuditReaderTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final ConfigurationReferenceAuditReader reader = new ConfigurationReferenceAuditReader(jdbc);
    private final List<String> queries = new ArrayList<>();
    private String expectedGame;
    private long sourceCount;
    private long referenceCount;
    private long catalogCount;
    private long sourceBytes;
    private long pathBytes;
    private long maxSourceBytes;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setup() {
        expectedGame = "lol";
        when(jdbc.query(anyString(), any(PreparedStatementSetter.class), any(RowMapper.class))).thenAnswer(invocation -> {
            String sql = invocation.getArgument(0);
            queries.add(sql);
            PreparedStatement statement = mock(PreparedStatement.class);
            invocation.<PreparedStatementSetter>getArgument(1).setValues(statement);
            verify(statement).setString(1, expectedGame);
            verify(statement).setQueryTimeout(30);
            verifyNoMoreInteractions(statement);
            assertFalse(sql.toUpperCase().matches("(?s).*\\b(INSERT|UPDATE|DELETE|FOR UPDATE)\\b.*"));
            RowMapper<?> mapper = invocation.getArgument(2);
            List<Map<String, Object>> rows;
            if (sql.equals(ConfigurationReferenceAuditReader.SOURCE_COUNTS_SQL)) {
                rows = List.of(Map.of("row_count", sourceCount, "content_bytes", sourceBytes, "max_source_bytes", maxSourceBytes));
            } else if (sql.equals(ConfigurationReferenceAuditReader.REFERENCE_COUNTS_SQL)) {
                rows = List.of(Map.of("row_count", referenceCount, "path_bytes", pathBytes));
            } else if (sql.equals(ConfigurationReferenceAuditReader.CATALOG_COUNTS_SQL)) {
                rows = List.of(Map.of("row_count", catalogCount));
            } else if (!expectedGame.equals("lol")) {
                rows = List.of();
            } else if (sql.equals(ConfigurationReferenceAuditReader.SOURCES_SQL)) {
                rows = List.of(Map.of("source_type", "EFFECT", "skill_key", "skill", "source_key", "effect", "data", "{\"results\":[]}"));
            } else if (sql.equals(ConfigurationReferenceAuditReader.REFERENCES_SQL)) {
                rows = List.of(Map.of("source_skill_key", "skill", "source_type", "EFFECT", "source_key", "effect", "field_path", "field",
                    "target_type", "ATTRIBUTE", "target_skill_key", "", "target_key", "hp", "target_sub_key", ""));
            } else if (sql.equals(ConfigurationReferenceAuditReader.CATALOG_SQL)) {
                rows = List.of(Map.of("target_type", "ATTRIBUTE", "skill_key", "", "object_key", "hp"));
            } else throw new AssertionError("Unexpected SQL");
            List<Object> result = new ArrayList<>();
            for (Map<String, Object> row : rows) {
                ResultSet rs = mock(ResultSet.class);
                when(rs.getLong(anyString())).thenAnswer(call -> ((Number) row.get(call.getArgument(0))).longValue());
                when(rs.getString(anyString())).thenAnswer(call -> (String) row.get(call.getArgument(0)));
                result.add(mapper.mapRow(rs, result.size()));
            }
            return result;
        });
    }

    @Test
    void preflightsAllCountsAndBytesBeforeBoundedBodyReads() {
        sourceCount = referenceCount = catalogCount = 1;
        sourceBytes = maxSourceBytes = 14;
        pathBytes = 5;
        var result = reader.read("lol");
        assertTrue(result.readComplete());
        assertEquals(new ConfigurationReferenceAuditor.ReadCounts(1, 1, 1, 14, 5, 14), result.counts());
        assertEquals(SourceType.EFFECT, result.sources().getFirst().type());
        assertEquals("lol", result.existingReferences().getFirst().gameId());
        assertEquals(Set.of(new Target(TargetType.ATTRIBUTE, "", "hp", "")), result.catalog());
        assertEquals(List.of(ConfigurationReferenceAuditReader.SOURCE_COUNTS_SQL,
            ConfigurationReferenceAuditReader.REFERENCE_COUNTS_SQL, ConfigurationReferenceAuditReader.CATALOG_COUNTS_SQL,
            ConfigurationReferenceAuditReader.SOURCES_SQL, ConfigurationReferenceAuditReader.REFERENCES_SQL,
            ConfigurationReferenceAuditReader.CATALOG_SQL), queries);
        verify(jdbc, never()).setQueryTimeout(anyInt());
    }

    @Test
    void countsOverBudgetNeverReadSourceOrReferenceBodies() {
        sourceCount = 5001;
        referenceCount = 50001;
        catalogCount = 20001;
        sourceBytes = 32L * 1024 * 1024;
        maxSourceBytes = 2L * 1024 * 1024 + 1;
        pathBytes = 1;
        var result = reader.read("lol");
        assertFalse(result.readComplete());
        assertTrue(result.sources().isEmpty());
        assertTrue(result.existingReferences().isEmpty());
        assertTrue(result.catalog().isEmpty());
        assertEquals(5001, result.counts().sourceCount());
        assertEquals(50001, result.counts().existingReferenceCount());
        assertEquals(20001, result.counts().catalogTargetCount());
        assertEquals(3, queries.size());
        var report = ConfigurationReferenceAuditor.audit(result);
        assertNull(report.totalIssueCount());
        assertNull(report.counts().extractedReferenceCount());
    }

    @Test
    void exactBudgetsStillReadBodiesAndMismatchFailsClosed() {
        sourceCount = 5000;
        referenceCount = 50000;
        catalogCount = 20000;
        sourceBytes = 30L * 1024 * 1024;
        pathBytes = maxSourceBytes = 2L * 1024 * 1024;
        var result = reader.read("lol");
        assertEquals(6, queries.size());
        assertFalse(result.readComplete());
        var report = ConfigurationReferenceAuditor.audit(result);
        assertFalse(report.complete());
        assertFalse(report.healthy());
        assertNull(report.totalIssueCount());
        assertEquals("AUDIT_LIMIT_EXCEEDED", report.issues().getFirst().code());
    }

    @Test
    void otherGamesUseOnlyTheirBoundScope() {
        expectedGame = "other";
        var input = reader.read("other");
        assertTrue(input.readComplete());
        assertTrue(input.sources().isEmpty());
        assertTrue(input.existingReferences().isEmpty());
        assertTrue(ConfigurationReferenceAuditor.audit(input).healthy());
    }

    @Test
    void sqlReusesGuardProjectionsWithCompleteStableOrderAndInsuranceLimit() {
        assertTrue(ConfigurationReferenceAuditReader.SOURCE_COUNTS_SQL.contains(GameConfigurationWriteGuard.AGGREGATES_SQL));
        assertTrue(ConfigurationReferenceAuditReader.REFERENCE_COUNTS_SQL.contains(GameConfigurationWriteGuard.REFERENCES_SQL));
        assertTrue(ConfigurationReferenceAuditReader.CATALOG_COUNTS_SQL.contains(GameConfigurationWriteGuard.CATALOG_SQL));
        assertTrue(ConfigurationReferenceAuditReader.SOURCES_SQL.endsWith("ORDER BY source_type, skill_key, source_key LIMIT 5001"));
        assertTrue(ConfigurationReferenceAuditReader.REFERENCES_SQL.endsWith(
            "ORDER BY source_skill_key, source_type, source_key, field_path, target_type, target_skill_key, target_key, target_sub_key LIMIT 50001"));
        assertTrue(ConfigurationReferenceAuditReader.CATALOG_SQL.endsWith("ORDER BY target_type, skill_key, object_key LIMIT 20001"));
        assertTrue(ConfigurationReferenceAuditReader.SOURCE_COUNTS_SQL.contains("octet_length(data)"));
        assertTrue(ConfigurationReferenceAuditReader.REFERENCE_COUNTS_SQL.contains("octet_length(field_path)"));
        verifyNoInteractions(jdbc);
    }

    @Test
    void queryFailurePropagatesInsteadOfReturningEmptyHealthyReport() {
        reset(jdbc);
        when(jdbc.query(anyString(), any(PreparedStatementSetter.class), any(RowMapper.class)))
            .thenThrow(new DataAccessResourceFailureException("test failure"));
        assertThrows(DataAccessResourceFailureException.class, () -> reader.read("lol"));
    }
}
