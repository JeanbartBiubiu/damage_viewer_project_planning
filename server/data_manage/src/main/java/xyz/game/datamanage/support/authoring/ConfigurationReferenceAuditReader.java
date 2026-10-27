package xyz.game.datamanage.support.authoring;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;
import xyz.game.datamanage.support.authoring.ConfigurationReferenceAuditor.Input;
import xyz.game.datamanage.support.authoring.ConfigurationReferenceAuditor.ReadCounts;
import xyz.game.datamanage.support.authoring.ConfigurationReferenceAuditor.Source;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Reference;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Target;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.TargetType;

/** 由调用方的同一只读事务先预检、再有界读取；不调用写入护栏。 */
@Component
public class ConfigurationReferenceAuditReader {
    private static final int QUERY_TIMEOUT_SECONDS = 30;
    private final JdbcTemplate jdbc;

    public ConfigurationReferenceAuditReader(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public Input read(String gameId) {
        long[] sources = query(SOURCE_COUNTS_SQL, gameId,
            (rs, row) -> new long[]{rs.getLong("row_count"), rs.getLong("content_bytes"), rs.getLong("max_source_bytes")}).getFirst();
        long[] references = query(REFERENCE_COUNTS_SQL, gameId,
            (rs, row) -> new long[]{rs.getLong("row_count"), rs.getLong("path_bytes")}).getFirst();
        long targets = query(CATALOG_COUNTS_SQL, gameId, (rs, row) -> rs.getLong("row_count")).getFirst();
        ReadCounts counts = new ReadCounts(sources[0], references[0], targets, sources[1], references[1], sources[2]);
        if (!ConfigurationReferenceAuditor.readBudgetProblems(counts).isEmpty())
            return new Input(gameId, counts, List.of(), List.of(), Set.of(), false);

        List<Source> sourceRows = query(SOURCES_SQL, gameId, (rs, row) -> new Source(
            SourceType.valueOf(rs.getString("source_type")), rs.getString("skill_key"), rs.getString("source_key"), rs.getString("data")));
        List<Reference> referenceRows = query(REFERENCES_SQL, gameId, (rs, row) -> new Reference(gameId,
            rs.getString("source_skill_key"), SourceType.valueOf(rs.getString("source_type")),
            rs.getString("source_key"), rs.getString("field_path"), new Target(TargetType.valueOf(rs.getString("target_type")),
                rs.getString("target_skill_key"), rs.getString("target_key"), rs.getString("target_sub_key"))));
        List<Target> catalogRows = query(CATALOG_SQL, gameId, (rs, row) -> new Target(
            TargetType.valueOf(rs.getString("target_type")), rs.getString("skill_key"), rs.getString("object_key"), ""));
        boolean complete = sourceRows.size() == counts.sourceCount()
            && referenceRows.size() == counts.existingReferenceCount() && catalogRows.size() == counts.catalogTargetCount();
        return new Input(gameId, counts, List.copyOf(sourceRows), List.copyOf(referenceRows),
            Set.copyOf(new LinkedHashSet<>(catalogRows)), complete);
    }

    private <T> List<T> query(String sql, String gameId, RowMapper<T> mapper) {
        return jdbc.query(sql, statement -> {
            statement.setString(1, gameId);
            statement.setQueryTimeout(QUERY_TIMEOUT_SECONDS);
        }, mapper);
    }

    static final String SOURCE_COUNTS_SQL = """
        SELECT count(*) AS row_count, coalesce(sum(octet_length(data)), 0)::bigint AS content_bytes,
               coalesce(max(octet_length(data)), 0)::bigint AS max_source_bytes
          FROM (
        """ + GameConfigurationWriteGuard.AGGREGATES_SQL + ") audit_sources";
    static final String REFERENCE_COUNTS_SQL = """
        SELECT count(*) AS row_count, coalesce(sum(octet_length(field_path)), 0)::bigint AS path_bytes
          FROM (
        """ + GameConfigurationWriteGuard.REFERENCES_SQL + ") audit_references";
    static final String CATALOG_COUNTS_SQL = "SELECT count(*) AS row_count FROM ("
        + GameConfigurationWriteGuard.CATALOG_SQL + ") audit_catalog";
    static final String SOURCES_SQL = "SELECT * FROM (" + GameConfigurationWriteGuard.AGGREGATES_SQL
        + ") audit_sources ORDER BY source_type, skill_key, source_key LIMIT " + (ConfigurationReferenceAuditor.MAX_SOURCES + 1);
    static final String REFERENCES_SQL = "SELECT * FROM (" + GameConfigurationWriteGuard.REFERENCES_SQL
        + ") audit_references ORDER BY source_skill_key, source_type, source_key, field_path,"
        + " target_type, target_skill_key, target_key, target_sub_key LIMIT " + (ConfigurationReferenceAuditor.MAX_EXISTING_REFERENCES + 1);
    static final String CATALOG_SQL = "SELECT * FROM (" + GameConfigurationWriteGuard.CATALOG_SQL
        + ") audit_catalog ORDER BY target_type, skill_key, object_key LIMIT " + (ConfigurationReferenceAuditor.MAX_CATALOG_TARGETS + 1);
}
