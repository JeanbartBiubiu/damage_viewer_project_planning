package xyz.game.datamanage.tools;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

class GamePartitionCleanupMainTest {

    @Test
    void cleanupMain_shouldRequireExplicitConfirm() {
        IllegalArgumentException ex = assertThrows(
            IllegalArgumentException.class,
            () -> GamePartitionCleanupMain.parseArgs(new String[]{"--gameId=it_20260226_1234"})
        );
        assertTrue(ex.getMessage().contains("--confirm"));
    }

    @Test
    void cleanupMain_dryRun_shouldPrintPlannedStatements() throws Exception {
        GamePartitionCleanupMain.CleanupOptions options = GamePartitionCleanupMain.parseArgs(
            new String[]{
                "--gameId=it_20260226_1234",
                "--confirm=DROP_it_20260226_1234",
                "--dryRun"
            }
        );
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (PrintStream printStream = new PrintStream(output, true, StandardCharsets.UTF_8)) {
            GamePartitionCleanupMain.run(options, printStream);
        }

        String text = output.toString(StandardCharsets.UTF_8);
        assertTrue(text.contains("DRY-RUN mode enabled"));
        assertTrue(text.contains("DROP TABLE IF EXISTS public.heroes_it_20260226_1234 CASCADE;"));
        assertTrue(text.contains("DELETE FROM public.games WHERE game_id = 'it_20260226_1234';"));
    }
}
