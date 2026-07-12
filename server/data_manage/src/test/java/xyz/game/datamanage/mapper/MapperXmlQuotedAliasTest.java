package xyz.game.datamanage.mapper;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.IOException;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/**
 * PostgreSQL folds unquoted identifiers to lowercase. With JDBC + MyBatis {@code resultType=map},
 * an alias like {@code AS gameId} becomes map key {@code gameid}, so Java {@code row.get("gameId")}
 * is null. Mixed-case aliases must be double-quoted: {@code AS "gameId"}.
 */
class MapperXmlQuotedAliasTest {

    /** Unquoted AS alias identifier (skips already-quoted {@code AS "..." }). */
    private static final Pattern UNQUOTED_AS_ALIAS =
        Pattern.compile("\\bAS\\s+(?!\")([A-Za-z_][A-Za-z0-9_]*)\\b");

    @Test
    void detectorRejectsUnquotedCamelCaseAlias() {
        assertTrue(containsUnquotedMixedCaseAlias("SELECT game_id AS gameId FROM t"), "AS gameId must be flagged");
        assertTrue(
            containsUnquotedMixedCaseAlias("SELECT current_revision AS currentRevision FROM t"),
            "AS currentRevision must be flagged");
        assertFalse(
            containsUnquotedMixedCaseAlias("SELECT game_id AS \"gameId\" FROM t"),
            "quoted AS \"gameId\" must pass");
        assertFalse(
            containsUnquotedMixedCaseAlias("SELECT game_id AS game_id FROM t"),
            "snake_case alias needs no quotes");
        assertFalse(
            containsUnquotedMixedCaseAlias("RETURNING version_id"),
            "lowercase RETURNING column is fine");
        assertFalse(
            containsUnquotedMixedCaseAlias("WITH ensured AS (SELECT 1) SELECT 1"),
            "lowercase CTE name is fine");
    }

    @Test
    void allMapperXmlsQuoteMixedCaseAliases() throws Exception {
        Path mapperRoot = resolveMapperRoot();
        assertTrue(Files.isDirectory(mapperRoot), "mapper root missing: " + mapperRoot);

        List<String> violations = new ArrayList<>();
        try (Stream<Path> files = Files.walk(mapperRoot)) {
            files.filter(p -> p.getFileName().toString().endsWith(".xml"))
                .sorted()
                .forEach(path -> {
                    String sql;
                    try {
                        sql = Files.readString(path, StandardCharsets.UTF_8);
                    } catch (IOException e) {
                        throw new RuntimeException(e);
                    }
                    Matcher m = UNQUOTED_AS_ALIAS.matcher(sql);
                    while (m.find()) {
                        String alias = m.group(1);
                        if (isMixedCase(alias)) {
                            violations.add(mapperRoot.relativize(path) + ": unquoted AS " + alias);
                        }
                    }
                });
        }

        if (!violations.isEmpty()) {
            fail(
                "PostgreSQL JDBC requires quoted mixed-case aliases (e.g. AS \"gameId\"). Found:\n  "
                    + String.join("\n  ", violations));
        }
    }

    static boolean containsUnquotedMixedCaseAlias(String sql) {
        Matcher m = UNQUOTED_AS_ALIAS.matcher(sql);
        while (m.find()) {
            if (isMixedCase(m.group(1))) {
                return true;
            }
        }
        return false;
    }

    static boolean isMixedCase(String name) {
        boolean hasUpper = false;
        boolean hasLower = false;
        for (int i = 0; i < name.length(); i++) {
            char c = name.charAt(i);
            if (Character.isUpperCase(c)) {
                hasUpper = true;
            } else if (Character.isLowerCase(c)) {
                hasLower = true;
            }
            if (hasUpper && hasLower) {
                return true;
            }
        }
        return false;
    }

    private static Path resolveMapperRoot() throws URISyntaxException {
        URL sample = MapperXmlQuotedAliasTest.class.getResource("/mapper/games/GamesMapper.xml");
        if (sample == null) {
            fail("GamesMapper.xml not on test classpath under /mapper/games/");
        }
        Path gamesMapper = Paths.get(sample.toURI());
        return gamesMapper.getParent().getParent();
    }
}
