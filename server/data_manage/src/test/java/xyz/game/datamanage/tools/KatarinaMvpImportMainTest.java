package xyz.game.datamanage.tools;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class KatarinaMvpImportMainTest {

    private static final String DEFAULT_SEED_FILE = "\u5361\u7279\u7433\u5a1c-MVP\u79cd\u5b50\u6570\u636e.json";

    @Test
    void parseArgs_shouldApplyOverrides() {
        KatarinaMvpImportMain.ImportOptions options = KatarinaMvpImportMain.parseArgs(
            new String[]{
                "--apiBaseUrl=http://localhost:18080",
                "--seedFile=seed.json",
                "--gameId=lol",
                "--gameName=League of Legends CN",
                "--versionCode=mvp_override_001",
                "--adminToken=token-value",
                "--bootstrapDb",
                "--skipPublish",
                "--dryRun",
                "--dbUrl=jdbc:postgresql://127.0.0.1:5432/test",
                "--dbUsername=postgres",
                "--dbPassword=postgres"
            }
        );

        assertEquals("http://localhost:18080", options.apiBaseUrl());
        assertEquals("seed.json", options.seedFile());
        assertEquals("lol", options.gameId());
        assertEquals("League of Legends CN", options.gameName());
        assertEquals("mvp_override_001", options.versionCode());
        assertEquals("token-value", options.adminToken());
        assertTrue(options.bootstrapDb());
        assertFalse(options.publish());
        assertTrue(options.dryRun());
        assertEquals("jdbc:postgresql://127.0.0.1:5432/test", options.dbUrl());
    }

    @Test
    void parseArgs_shouldAllowMissingAdminToken() {
        KatarinaMvpImportMain.ImportOptions options = KatarinaMvpImportMain.parseArgs(
            new String[]{
                "--dryRun"
            }
        );

        assertEquals(null, options.adminToken());
        assertTrue(options.dryRun());
    }

    @Test
    void resolveSeedFile_shouldFindRepositorySeed() {
        Path seedFile = KatarinaMvpImportMain.resolveSeedFile(null);

        assertTrue(Files.isRegularFile(seedFile));
        assertEquals(DEFAULT_SEED_FILE, seedFile.getFileName().toString());
    }

    @Test
    void loadSeed_shouldReadActualKatarinaMvpCounts() throws Exception {
        Path seedFile = KatarinaMvpImportMain.resolveSeedFile(null);

        KatarinaMvpImportMain.SeedData seedData = KatarinaMvpImportMain.loadSeed(seedFile);

        assertEquals("lol", seedData.gameId());
        assertEquals("mvp_katarina_001", seedData.versionCode());
        assertEquals(2, seedData.ownerCategories().size());
        assertEquals(10, seedData.attributeDefinitions().size());
        assertEquals(2, seedData.heroes().size());
        assertEquals(2, seedData.skills().size());
        assertEquals(2, seedData.items().size());
        assertEquals(0, seedData.types().size());
        assertEquals(0, seedData.typeRelations().size());
        assertEquals(2, seedData.scenarios().size());
    }

    @Test
    void loadSeed_shouldReadV2BatchATargetDummies() throws Exception {
        Path seedFile = Path.of("..", "..", "\u6700\u5c0f\u9a8c\u8bc1", "V2-Batch-A-target-dummies.seed.json")
            .toAbsolutePath()
            .normalize();

        KatarinaMvpImportMain.SeedData seedData = KatarinaMvpImportMain.loadSeed(seedFile);

        assertEquals("lol", seedData.gameId());
        assertEquals("v2_batch_a_target_dummies_001", seedData.versionCode());
        assertEquals(1, seedData.types().size());
        assertEquals(3, seedData.heroes().size());
        assertEquals(3, seedData.typeRelations().size());
        assertEquals("target_dummy_fighter", seedData.heroes().get(1).path("heroId").asText());
        assertEquals(3000, seedData.heroes().get(1).path("baseStats").path("hp").asInt());
        assertEquals(100, seedData.heroes().get(1).path("baseStats").path("armor").asInt());
        assertEquals(80, seedData.heroes().get(1).path("baseStats").path("magic_resist").asInt());
    }
}
