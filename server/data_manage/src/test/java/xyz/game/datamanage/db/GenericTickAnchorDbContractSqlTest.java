package xyz.game.datamanage.db;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.IOException;
import java.io.InputStream;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

/**
 * Static DB/API contract for optional tick_anchor pair on provider_lifecycles
 * (main/log), compatibility migration, and mapper publish-copy paths. Does not
 * connect to a live database.
 */
class GenericTickAnchorDbContractSqlTest {

    private static final String SCHEMA_RELATIVE = "db/game_manage/schema.sql";
    private static final String MIGRATION_RELATIVE =
        "db/game_manage/migrations/compatibility/"
            + "generic_tick_anchor_compatibility_migration.sql";
    private static final String RESERVED_RELATIVE =
        "db/game_manage/seeds/reserved_types_seed.sql";
    private static final String LIFECYCLE_MAPPER_RESOURCE =
        "/mapper/combatdata/provider_lifecycles/CombatProviderLifecyclesMapper.xml";

    private static String schemaSql;
    private static String migrationSql;
    private static String reservedSql;
    private static String lifecycleMapperXml;
    private static Document lifecycleMapperDoc;

    @BeforeAll
    static void loadArtifacts() throws Exception {
        schemaSql = readRelative(SCHEMA_RELATIVE);
        migrationSql = readRelative(MIGRATION_RELATIVE);
        reservedSql = readRelative(RESERVED_RELATIVE);
        try (InputStream in =
            GenericTickAnchorDbContractSqlTest.class.getResourceAsStream(LIFECYCLE_MAPPER_RESOURCE)) {
            assertNotNull(in, "mapper xml missing on classpath: " + LIFECYCLE_MAPPER_RESOURCE);
            byte[] bytes = in.readAllBytes();
            lifecycleMapperXml = new String(bytes, StandardCharsets.UTF_8);
            lifecycleMapperDoc = parseXmlWithoutExternalDtd(bytes);
        }
    }

    @Test
    void providerLifecyclesAndLogHaveNullableTickAnchorPairWithChecksAndFk() {
        String main = extractCreateTable(schemaSql, "provider_lifecycles");
        String log = extractCreateTable(schemaSql, "provider_lifecycles_log");

        assertTrue(
            Pattern.compile("tick_anchor_scope_type_id\\s+int").matcher(main).find(),
            "provider_lifecycles.tick_anchor_scope_type_id must be int");
        assertTrue(
            Pattern.compile("tick_anchor_scope_type_id\\s+int").matcher(log).find(),
            "provider_lifecycles_log.tick_anchor_scope_type_id must be int");
        assertFalse(
            Pattern.compile("tick_anchor_scope_type_id\\s+int\\s+NOT\\s+NULL", Pattern.CASE_INSENSITIVE)
                .matcher(main)
                .find(),
            "tick_anchor_scope_type_id must remain nullable on main");
        assertFalse(
            Pattern.compile("tick_anchor_scope_type_id\\s+int\\s+NOT\\s+NULL", Pattern.CASE_INSENSITIVE)
                .matcher(log)
                .find(),
            "tick_anchor_scope_type_id must remain nullable on log");

        assertTrue(
            Pattern.compile("tick_anchor_state_key\\s+varchar\\(128\\)").matcher(main).find(),
            "provider_lifecycles.tick_anchor_state_key must be varchar(128)");
        assertTrue(
            Pattern.compile("tick_anchor_state_key\\s+varchar\\(128\\)").matcher(log).find(),
            "provider_lifecycles_log.tick_anchor_state_key must be varchar(128)");
        assertFalse(
            Pattern.compile(
                    "tick_anchor_state_key\\s+varchar\\(128\\)\\s+NOT\\s+NULL", Pattern.CASE_INSENSITIVE)
                .matcher(main)
                .find(),
            "tick_anchor_state_key must remain nullable on main");

        Pattern pairCheck =
            Pattern.compile(
                "\\(tick_anchor_scope_type_id\\s+IS\\s+NULL\\)\\s*=\\s*"
                    + "\\(tick_anchor_state_key\\s+IS\\s+NULL\\)",
                Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
        assertTrue(pairCheck.matcher(main).find(), "main must CHECK tick_anchor pairing");
        assertTrue(pairCheck.matcher(log).find(), "log must CHECK tick_anchor pairing");

        Pattern nonEmpty =
            Pattern.compile(
                "tick_anchor_state_key\\s+IS\\s+NULL\\s+OR\\s+tick_anchor_state_key\\s*<>\\s*''",
                Pattern.CASE_INSENSITIVE);
        assertTrue(nonEmpty.matcher(main).find(), "main must reject empty tick_anchor_state_key");
        assertTrue(nonEmpty.matcher(log).find(), "log must reject empty tick_anchor_state_key");

        assertTrue(
            main.contains("REFERENCES public.reserved_type(type_id)")
                || main.contains("REFERENCES public.reserved_type (type_id)"),
            "tick_anchor_scope_type_id must FK reserved_type on main");
        assertTrue(
            log.contains("REFERENCES public.reserved_type(type_id)")
                || log.contains("REFERENCES public.reserved_type (type_id)"),
            "tick_anchor_scope_type_id must FK reserved_type on log");

        // Column order: after start_delay_ms, before change_revision
        int startDelay = main.indexOf("start_delay_ms");
        int scope = main.indexOf("tick_anchor_scope_type_id");
        int stateKey = main.indexOf("tick_anchor_state_key");
        int changeRev = main.indexOf("change_revision");
        assertTrue(startDelay >= 0 && scope > startDelay && stateKey > scope && changeRev > stateKey,
            "main column order must be start_delay_ms → tick_anchor_* → change_revision");

        int logStart = log.indexOf("start_delay_ms");
        int logScope = log.indexOf("tick_anchor_scope_type_id");
        int logKey = log.indexOf("tick_anchor_state_key");
        assertTrue(logStart >= 0 && logScope > logStart && logKey > logScope,
            "log column order must place tick_anchor after start_delay_ms");
    }

    @Test
    void reservedTypesIncludeStateScopeProviderTarget() {
        assertTrue(reservedSql.contains("'state_scope/provider_target'"));
        assertTrue(reservedSql.contains("(20252,"));
    }

    @Test
    void compatibilityMigrationIsIdempotentAndNonDestructive() {
        String migrationNoComments = stripLineComments(migrationSql);
        assertEquals(
            2,
            countOccurrences(
                migrationNoComments, "ADD COLUMN IF NOT EXISTS tick_anchor_scope_type_id int"),
            "migration must ADD tick_anchor_scope_type_id on both main and log");
        assertEquals(
            2,
            countOccurrences(
                migrationNoComments,
                "ADD COLUMN IF NOT EXISTS tick_anchor_state_key varchar(128)"),
            "migration must ADD tick_anchor_state_key on both main and log");
        assertTrue(migrationNoComments.contains("ck_provider_lifecycles_tick_anchor_pair"));
        assertTrue(migrationNoComments.contains("ck_provider_lifecycles_log_tick_anchor_pair"));
        assertTrue(migrationNoComments.contains("fk_provider_lifecycles_tick_anchor_scope"));
        assertTrue(migrationNoComments.contains("fk_provider_lifecycles_log_tick_anchor_scope"));
        assertTrue(
            Pattern.compile("(?is)IF\\s+NOT\\s+EXISTS").matcher(migrationNoComments).find(),
            "CHECK/FK creation must be guarded with IF NOT EXISTS");
        assertFalse(
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(migrationNoComments).find(),
            "migration must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\s+TABLE\\b").matcher(migrationNoComments).find(),
            "migration must not DROP TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\s+COLUMN\\b").matcher(migrationNoComments).find(),
            "migration must not DROP COLUMN");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(migrationNoComments).find(),
            "migration must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\s+CONSTRAINT\\b").matcher(migrationNoComments).find(),
            "migration must not DROP CONSTRAINT");
        assertFalse(
            Pattern.compile("(?i)\\bversions:publish\\b").matcher(migrationNoComments).find(),
            "migration must not publish");
    }

    @Test
    void lifecycleMapperSelectUpsertAndPublishCopyIncludeTickAnchorPair() {
        assertTrue(lifecycleMapperXml.contains("tick_anchor_scope_type_id AS \"tickAnchorScopeTypeId\""));
        assertTrue(lifecycleMapperXml.contains("tick_anchor_state_key AS \"tickAnchorStateKey\""));
        assertTrue(lifecycleMapperXml.contains("#{tickAnchorScopeTypeId}"));
        assertTrue(lifecycleMapperXml.contains("#{tickAnchorStateKey}"));
        assertTrue(
            lifecycleMapperXml.contains(
                "tick_anchor_scope_type_id = EXCLUDED.tick_anchor_scope_type_id"));
        assertTrue(
            lifecycleMapperXml.contains("tick_anchor_state_key = EXCLUDED.tick_anchor_state_key"));

        assertStatementContains("select", "list", "tick_anchor_scope_type_id AS \"tickAnchorScopeTypeId\"");
        assertStatementContains("select", "list", "tick_anchor_state_key AS \"tickAnchorStateKey\"");
        assertStatementContains(
            "select", "findById", "tick_anchor_scope_type_id AS \"tickAnchorScopeTypeId\"");
        assertStatementContains(
            "select", "findById", "tick_anchor_state_key AS \"tickAnchorStateKey\"");
        assertStatementContains(
            "select", "listChangedSince", "tick_anchor_scope_type_id AS \"tickAnchorScopeTypeId\"");
        assertStatementContains(
            "select", "listChangedSince", "tick_anchor_state_key AS \"tickAnchorStateKey\"");
        assertStatementContains("update", "upsert", "#{tickAnchorScopeTypeId}");
        assertStatementContains("update", "upsert", "#{tickAnchorStateKey}");

        String copySql = statementSql(lifecycleMapperDoc, "insert", "copyChangedToLog");
        assertTrue(copySql.contains("tick_anchor_scope_type_id"), "copy must include scope");
        assertTrue(copySql.contains("tick_anchor_state_key"), "copy must include state_key");
        assertTrue(
            copySql.contains("tick_anchor_scope_type_id = EXCLUDED.tick_anchor_scope_type_id")
                || copySql.contains("tick_anchor_scope_type_id=EXCLUDED.tick_anchor_scope_type_id"),
            "copy conflict update must set tick_anchor_scope_type_id");
        assertTrue(
            copySql.contains("tick_anchor_state_key = EXCLUDED.tick_anchor_state_key")
                || copySql.contains("tick_anchor_state_key=EXCLUDED.tick_anchor_state_key"),
            "copy conflict update must set tick_anchor_state_key");
    }

    private static void assertStatementContains(String tag, String id, String needle) {
        String sql = statementSql(lifecycleMapperDoc, tag, id);
        assertTrue(sql.contains(needle), tag + "#" + id + " must contain: " + needle);
    }

    private static String statementSql(Document doc, String tag, String id) {
        NodeList nodes = doc.getElementsByTagName(tag);
        for (int i = 0; i < nodes.getLength(); i++) {
            Element element = (Element) nodes.item(i);
            if (id.equals(element.getAttribute("id"))) {
                return element.getTextContent();
            }
        }
        fail("mapper statement missing: " + tag + "#" + id);
        return "";
    }

    private static String extractCreateTable(String sql, String tableName) {
        Matcher m =
            Pattern.compile(
                    "(?is)CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+public\\."
                        + Pattern.quote(tableName)
                        + "\\s*\\(")
                .matcher(sql);
        assertTrue(m.find(), "CREATE TABLE public." + tableName + " missing");
        int start = m.start();
        int depth = 0;
        boolean inParens = false;
        for (int i = m.end() - 1; i < sql.length(); i++) {
            char c = sql.charAt(i);
            if (c == '(') {
                depth++;
                inParens = true;
            } else if (c == ')') {
                depth--;
                if (inParens && depth == 0) {
                    int end = i + 1;
                    while (end < sql.length() && sql.charAt(end) != ';') {
                        end++;
                    }
                    return sql.substring(start, Math.min(end + 1, sql.length()));
                }
            }
        }
        fail("unable to extract CREATE TABLE body for " + tableName);
        return "";
    }

    private static Document parseXmlWithoutExternalDtd(byte[] bytes) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        DocumentBuilder builder = factory.newDocumentBuilder();
        return builder.parse(new InputSource(new StringReader(new String(bytes, StandardCharsets.UTF_8))));
    }

    private static String readRelative(String relative) throws IOException {
        Path path = resolveRelative(relative);
        assertTrue(Files.isRegularFile(path), "missing: " + path);
        return Files.readString(path, StandardCharsets.UTF_8);
    }

    private static Path resolveRelative(String relative) {
        Path cwd = Paths.get("").toAbsolutePath();
        Path direct = cwd.resolve(relative);
        if (Files.isRegularFile(direct)) {
            return direct;
        }
        Path fromModule = cwd.resolve("../..").resolve(relative).normalize();
        if (Files.isRegularFile(fromModule)) {
            return fromModule;
        }
        return direct;
    }

    private static String stripLineComments(String sql) {
        StringBuilder out = new StringBuilder(sql.length());
        for (String line : sql.split("\n", -1)) {
            int idx = line.indexOf("--");
            out.append(idx >= 0 ? line.substring(0, idx) : line).append('\n');
        }
        return out.toString();
    }

    private static int countOccurrences(String haystack, String needle) {
        int count = 0;
        int from = 0;
        while (true) {
            int at = haystack.indexOf(needle, from);
            if (at < 0) {
                return count;
            }
            count++;
            from = at + needle.length();
        }
    }
}
