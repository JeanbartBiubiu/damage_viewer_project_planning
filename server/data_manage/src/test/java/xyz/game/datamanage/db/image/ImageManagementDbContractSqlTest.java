package xyz.game.datamanage.db.image;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

class ImageManagementDbContractSqlTest {

    private static final String SCHEMA_RELATIVE = "db/game_manage/schema.sql";
    private static final String TRIGGERS_RELATIVE = "db/game_manage/triggers.sql";
    private static final String MIGRATION_RELATIVE =
        "db/game_manage/migrations/compatibility/image_management_migration.sql";

    private static String schema;
    private static String triggers;
    private static String migration;

    @BeforeAll
    static void loadSql() throws IOException {
        schema = readRelative(SCHEMA_RELATIVE);
        triggers = readRelative(TRIGGERS_RELATIVE);
        migration = readRelative(MIGRATION_RELATIVE);
    }

    @Test
    void freshSchemaDefinesFinalPartitionedImageResource() {
        String table = normalize(extractCreateTable(schema, "images"));
        assertTrue(table.contains("image_key varchar(128) not null"));
        assertTrue(table.contains("name varchar(100) not null"));
        assertTrue(table.contains("description varchar(2000)"));
        assertTrue(table.contains("image_base64 text not null"));
        assertTrue(table.contains("mime_type varchar(32) not null"));
        assertTrue(table.contains("byte_size integer not null"));
        assertTrue(table.contains("width smallint not null"));
        assertTrue(table.contains("height smallint not null"));
        assertTrue(table.contains("enabled boolean not null default true"));
        assertTrue(table.contains("created_at timestamptz not null default now()"));
        assertTrue(table.contains("updated_at timestamptz not null default now()"));
        assertTrue(table.contains("primary key (game_id, image_key)"));
        assertTrue(table.contains("foreign key (game_id) references public.games(game_id)"));
        assertTrue(table.contains("mime_type in ('image/png', 'image/jpeg')"));
        assertTrue(table.contains("byte_size between 1 and 262144"));
        assertTrue(table.contains("width between 1 and 64"));
        assertTrue(table.contains("height between 1 and 64"));
        assertTrue(table.contains("partition by list (game_id)"));
        assertFalse(table.contains(" uri "));

        String normalizedSchema = normalize(schema);
        assertTrue(normalizedSchema.contains(
            "create unique index uq_images_name on public.images (game_id, lower(btrim(name)))"
        ));
    }

    @Test
    void migrationLocksBeforePreflightingContent() {
        String normalized = normalize(migration);
        int preflight = normalized.indexOf("do $image_preflight$");
        int dimensionCheck = normalized.indexOf("dimensions %x% exceed 64x64");
        int ddlLock = normalized.indexOf("lock table public.images in access exclusive mode");

        assertTrue(preflight >= 0);
        assertTrue(dimensionCheck > preflight);
        assertTrue(ddlLock >= 0);
        assertTrue(ddlLock < preflight);
        assertTrue(normalized.lastIndexOf("lock table public.images in access exclusive mode") == ddlLock);
        assertTrue(normalized.contains("set local time zone 'asia/shanghai'"));
        assertTrue(normalized.contains("octet_length(decoded_content) not between 1 and 262144"));
        assertTrue(normalized.contains("image_row.uri !~"));
        assertTrue(normalized.contains("pg_temp.dv_png_has_chunk(decoded_content, 'actl')"));
        assertTrue(normalized.contains("animated png"));
        assertTrue(normalized.contains("image preflight row count mismatch"));
        assertTrue(normalized.contains("public.images changed after preflight"));
        assertTrue(normalized.contains("existing image keys conflict as normalized initial names"));
        assertTrue(normalized.contains("public.images keys changed after preflight"));
    }

    @Test
    void migrationRenamesAndBackfillsWithoutDeletingImageRows() {
        String normalized = normalize(migration);
        assertTrue(normalized.contains("rename column uri to image_key"));
        assertTrue(normalized.contains("set name = image.image_key"));
        assertTrue(normalized.contains("mime_type = backfill.mime_type"));
        assertTrue(normalized.contains("byte_size = backfill.byte_size"));
        assertTrue(normalized.contains("width = backfill.width"));
        assertTrue(normalized.contains("height = backfill.height"));
        assertTrue(normalized.contains("enabled = true"));
        assertTrue(normalized.contains("create unique index uq_images_name"));
        assertTrue(normalized.contains("public.images final constraints or index are incomplete"));
        assertFalse(Pattern.compile("(?is)\\bdelete\\s+from\\b").matcher(migration).find());
        assertFalse(Pattern.compile("(?is)\\bdrop\\s+table\\b").matcher(migration).find());
        assertFalse(Pattern.compile("(?is)\\bcascade\\b").matcher(migration).find());
    }

    @Test
    void partitionFunctionStillOwnsImagesOnly() {
        String normalized = normalize(triggers);
        assertTrue(normalized.contains("v_parents text[] := array[ 'images' ]"));
        assertTrue(normalized.contains("perform public.ensure_game_partitions(new.game_id)"));
    }

    private static String extractCreateTable(String sql, String tableName) {
        Matcher matcher = Pattern.compile(
            "(?is)CREATE\\s+TABLE\\s+public\\."
                + Pattern.quote(tableName)
                + "\\s*\\("
        ).matcher(sql);
        assertTrue(matcher.find(), "CREATE TABLE public." + tableName + " missing");
        int depth = 0;
        for (int index = matcher.end() - 1; index < sql.length(); index++) {
            char current = sql.charAt(index);
            if (current == '(') {
                depth++;
            } else if (current == ')') {
                depth--;
                if (depth == 0) {
                    int end = index + 1;
                    while (end < sql.length() && sql.charAt(end) != ';') {
                        end++;
                    }
                    return sql.substring(matcher.start(), Math.min(end + 1, sql.length()));
                }
            }
        }
        fail("unable to extract CREATE TABLE public." + tableName);
        return "";
    }

    private static String normalize(String value) {
        return value.toLowerCase().replaceAll("\\s+", " ").trim();
    }

    private static String readRelative(String relative) throws IOException {
        Path cwd = Paths.get("").toAbsolutePath().normalize();
        for (Path candidate : List.of(
            cwd.resolve("../../" + relative).normalize(),
            cwd.resolve("../" + relative).normalize(),
            cwd.resolve(relative).normalize()
        )) {
            if (Files.isRegularFile(candidate)) {
                return Files.readString(candidate, StandardCharsets.UTF_8);
            }
        }
        fail("unable to resolve " + relative + " from cwd=" + cwd);
        return "";
    }
}
