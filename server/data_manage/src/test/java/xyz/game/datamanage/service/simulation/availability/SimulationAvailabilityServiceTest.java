package xyz.game.datamanage.service.simulation.availability;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.core.io.DefaultResourceLoader;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.simulation.SimulationAvailabilityMapper;
import xyz.game.datamanage.mapper.simulation.SimulationAvailabilityMapper.Row;
import xyz.game.datamanage.model.simulation.SimulationAvailabilityResponse;
import xyz.game.datamanage.model.simulation.SimulationAvailabilityResponse.Entry;
import xyz.game.datamanage.model.simulation.SimulationAvailabilityResponse.ExcludedSkillSource;
import xyz.game.datamanage.model.simulation.SimulationAvailabilityResponse.Status;
import xyz.game.datamanage.service.simulation.availability.SimulationAvailabilityResources.Document;
import xyz.game.datamanage.support.error.ApiException;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class SimulationAvailabilityServiceTest {
    private static final String WASM = "a".repeat(64);
    private static final String ADAPTER = "unit-test-adapter";
    private final ObjectMapper json = new ObjectMapper();
    private final GamesMapper games = mock(GamesMapper.class);
    private final SimulationAvailabilityMapper mapper = mock(SimulationAvailabilityMapper.class);
    private final SimulationAvailabilityResources resources = mock(SimulationAvailabilityResources.class);
    private final List<Row> rows = new ArrayList<>();
    private ObjectNode scope;
    private SimulationAvailabilityService service;

    @BeforeEach
    void setup() throws Exception {
        when(games.countGames("arena")).thenReturn(1L);
        when(mapper.readGameRows("arena")).thenAnswer(ignored -> List.copyOf(rows));
        scope = json.createObjectNode();
        ObjectNode character = scope.putArray("characters").addObject().put("key", "hero").put("name", "完整英雄");
        ArrayNode expected = character.putArray("expectedSkills");
        String[] slots = {"P", "Q", "W", "E", "R"};
        for (String slot : slots) {
            String key = "hero_" + slot.toLowerCase();
            expected.addObject().put("key", key).put("slot", slot).put("name", "英雄" + slot).put("excluded", false);
            skill(key, "英雄" + slot, 2);
            add("CHARACTER_BINDING", "hero", key, Map.of("character_key", "hero", "skill_key", key, "sort_order", expected.size()));
        }
        scope.putArray("equipment").addObject().put("key", "item").put("name", "装备").put("requiresSkillBindings", false);
        when(resources.scope("arena")).thenAnswer(ignored -> new Document(scope, null));
        when(resources.verification("arena")).thenReturn(new Document(null, "VERIFICATION_NOT_FOUND"));
        add("LEVEL_CONFIG", "", "", Map.of("min_level", 1, "max_level", 2));
        add("ATTRIBUTE", "", "hp", Map.of("attribute_key", "hp", "status", "ENABLED", "value_type", "DECIMAL"));
        add("CATEGORY", "", "basic", Map.of("skill_category_key", "basic", "status", "ENABLED"));
        add("CALCULATION_RULES", "", "", Map.of("configuration", Map.of("basicAttackCategoryKey", "basic")));
        add("CHARACTER", "", "hero", Map.of("character_key", "hero", "name", "完整英雄"));
        add("CHARACTER_ATTRIBUTES", "hero", "", Map.of("level_values", Map.of("1", Map.of("hp", 100), "2", Map.of("hp", 110))));
        skill("attack", "普通攻击", 1);
        add("SKILL_CATEGORY", "attack", "basic", Map.of("skill_key", "attack", "skill_category_key", "basic"));
        add("CHARACTER_BINDING", "hero", "attack", Map.of("character_key", "hero", "skill_key", "attack"));
        add("EQUIPMENT", "", "item", Map.of("equipment_key", "item", "name", "装备"));
        add("EQUIPMENT_ATTRIBUTES", "item", "", Map.of("attribute_values", Map.of("hp", 20)));
        service = new SimulationAvailabilityService(games, mapper, resources, json);
    }

    @Test
    void noEvidenceNeverMeansReadyAndReadsOnlyOneBatchInRepeatableReadTransaction() throws Exception {
        SimulationAvailabilityResponse result = get();
        assertEquals(Status.UNVERIFIED, hero(result).status());
        assertEquals(Status.UNVERIFIED, item(result).status());
        assertFalse(hero(result).verification().matched());
        assertTrue(hero(result).excludedSkillSources().isEmpty());
        assertTrue(item(result).excludedSkillSources().isEmpty());
        assertEquals("VERIFICATION_NOT_FOUND", hero(result).issues().getFirst().code());
        verify(mapper).readGameRows("arena");
        Transactional annotation = SimulationAvailabilityService.class.getMethod("get", String.class, String.class, String.class).getAnnotation(Transactional.class);
        assertTrue(annotation.readOnly());
        assertEquals(Isolation.REPEATABLE_READ, annotation.isolation());
        assertEquals("representative-cases", hero(result).verification().requiredCoverage().path("levelValidation").asText());
        assertFalse(hero(result).verification().requiredCoverage().has("allSkillLevelCombinations"));
    }

    @Test
    void onlyMatchingFullIdentityAndBothSideLevelCoverageCanBeReady() {
        ObjectNode proof = installProof();
        assertEquals(Status.READY, hero(get()).status());
        assertEquals(Status.READY, item(get()).status());
        assertEquals("each-declared-level", proof.path("entries").get(0).path("coverage").path("levelValidation").asText());
        assertTrue(hero(get()).verification().matched());
        ((ObjectNode) proof.path("entries").get(0).path("coverage")).putArray("sides").add("source");
        assertEquals(Status.UNVERIFIED, hero(get()).status());
        assertEquals("VERIFICATION_COVERAGE_INCOMPLETE", hero(get()).issues().getFirst().code());
    }

    @Test
    void representativeCasesCanAdmitTheWholeLegalRangeWithoutClaimingPerLevelExecution() {
        ObjectNode proof = installProof();
        ObjectNode entry = (ObjectNode) proof.path("entries").get(0);
        addRepresentativeCases(entry);
        assertEquals(Status.READY, hero(get()).status());
        assertEquals(List.of(1, 2), json.convertValue(hero(get()).verification().requiredCoverage().path("characterLevels"), List.class));
        assertEquals("representative-cases", hero(get()).verification().requiredCoverage().path("levelValidation").asText());
    }

    @Test
    void missingPositiveCasesCannotAdmitButDoNotHideAnExplicitUnsupportedResult() {
        ObjectNode proof = installProof();
        ObjectNode entry = (ObjectNode) proof.path("entries").get(0);
        ((ObjectNode) entry.path("coverage")).put("levelValidation", "representative-cases");
        assertEquals(Status.UNVERIFIED, hero(get()).status());
        assertEquals("VERIFICATION_COVERAGE_INCOMPLETE", hero(get()).issues().getFirst().code());
        entry.put("outcome", "ENGINE_UNSUPPORTED").putArray("issues").addObject().put("code", "UNIT_TEST_UNSUPPORTED")
            .put("message", "已执行的明确不支持事实").putNull("skillKey").putNull("fieldPath");
        assertEquals(Status.ENGINE_UNSUPPORTED, hero(get()).status());
        assertTrue(hero(get()).verification().matched());
        assertEquals("UNIT_TEST_UNSUPPORTED", hero(get()).issues().getFirst().code());
        ((ObjectNode) entry.path("coverage")).put("levelValidation", "unknown");
        assertEquals(Status.UNVERIFIED, hero(get()).status());
    }

    @Test
    void representativeEvidenceNeverBypassesCurrentWasmAdapterOrConfigurationIdentity() throws Exception {
        ObjectNode proof = installProof();
        addRepresentativeCases((ObjectNode) proof.path("entries").get(0));
        assertEquals(Status.READY, hero(get()).status());
        assertEquals(Status.UNVERIFIED, hero(service.get("arena", "b".repeat(64), ADAPTER)).status());
        assertEquals(Status.UNVERIFIED, hero(service.get("arena", WASM, "new-adapter")).status());
        add("PARAMETER", "hero_q", "new", Map.of("skill_key", "hero_q", "parameter_key", "new", "value", 1));
        assertEquals(Status.UNVERIFIED, hero(get()).status());
        assertEquals("VERIFICATION_STALE", hero(get()).issues().getFirst().code());
    }

    @Test
    void proofCannotNarrowTheLegalCharacterOrSkillLevelRange() {
        ObjectNode proof = installProof();
        ((ObjectNode) proof.path("entries").get(0).path("coverage")).putArray("characterLevels").add(2);
        assertEquals(Status.UNVERIFIED, hero(get()).status());
        ObjectNode second = installProof();
        ((ObjectNode) second.path("entries").get(0).path("coverage").path("skills").get(1)).putArray("levels").add(2);
        assertEquals(Status.UNVERIFIED, hero(get()).status());
    }

    @Test
    void wasmAndAdapterChangesInvalidatePassedAndFailedEvidence() {
        installProof();
        assertEquals(Status.UNVERIFIED, hero(service.get("arena", "b".repeat(64), ADAPTER)).status());
        assertEquals(Status.UNVERIFIED, hero(service.get("arena", WASM, "new-adapter")).status());
        assertEquals(Status.READY, hero(service.get("arena", WASM.toUpperCase(), ADAPTER)).status());
    }

    @Test
    void childSkillDefinitionsInvalidateExternalDigestAndProof() throws Exception {
        add("SKILL", "", "child", Map.of("skill_key", "child", "name", "供值子技能", "status", "ENABLED", "max_level", 1));
        add("FORMULA", "child", "formula", Map.of("skill_key", "child", "formula_key", "formula", "expression", List.of(1, 2)));
        add("REFERENCE", "hero_q", "reference", Map.of("source_skill_key", "hero_q", "target_type", "FORMULA", "target_skill_key", "child", "target_key", "formula", "field_path", "/formulas/main"));
        ObjectNode proof = installProof();
        assertEquals(Status.READY, hero(get()).status(), "外部纯供值定义无需虚构运行根");
        String external = hero(get()).verification().externalDigest();
        replace("FORMULA", "child", "formula", Map.of("skill_key", "child", "formula_key", "formula", "expression", List.of(2, 1)));
        assertNotEquals(external, hero(get()).verification().externalDigest());
        assertEquals(Status.UNVERIFIED, hero(get()).status());
        assertNotNull(proof);
    }

    @Test
    void sharedRulesAndBindingChangesInvalidateOldProof() throws Exception {
        installProof();
        String before = get().sharedDigest();
        replace("ATTRIBUTE", "", "hp", Map.of("attribute_key", "hp", "status", "ENABLED", "value_type", "DECIMAL", "max_value", 9999));
        assertNotEquals(before, get().sharedDigest());
        assertEquals(Status.UNVERIFIED, hero(get()).status());
        installProof();
        replace("CHARACTER_BINDING", "hero", "hero_q", Map.of("character_key", "hero", "skill_key", "hero_q", "sort_order", 95));
        assertEquals(Status.UNVERIFIED, hero(get()).status());
    }

    @Test
    void missingWholeSlotAndEmptyProgramIdentifyTheActualSkill() {
        installProof();
        rows.removeIf(row -> row.kind().equals("CHARACTER_BINDING") && row.objectKey().equals("hero_q"));
        Entry missing = hero(get());
        assertEquals(Status.CONFIGURATION_INCOMPLETE, missing.status());
        assertTrue(missing.issues().stream().anyMatch(issue -> issue.code().equals("EXPECTED_SKILL_BINDING_MISSING") && "hero_q".equals(issue.skillKey())));
        rows.removeIf(row -> row.kind().equals("TRIGGER") && row.ownerKey().equals("hero_w"));
        assertTrue(hero(get()).issues().stream().anyMatch(issue -> issue.code().equals("SKILL_PROGRAM_MISSING")
            && issue.fieldPath().equals("skills.hero_w.triggerRules") && issue.message().contains("英雄W")));
    }

    @Test
    void equipmentWithoutSourceConfirmedAttributeOnlyScopeCannotUseMissingBindingsAsSuccess() {
        installProof();
        ((ObjectNode) scope.path("equipment").get(0)).put("requiresSkillBindings", true);
        assertEquals(Status.CONFIGURATION_INCOMPLETE, item(get()).status());
        assertTrue(item(get()).issues().stream().anyMatch(issue -> issue.code().equals("EQUIPMENT_SKILL_BINDING_MISSING")));
    }

    @Test
    void oldEngineFailureDoesNotPermanentlyDisableChangedData() throws Exception {
        ObjectNode proof = installProof();
        ObjectNode entry = (ObjectNode) proof.path("entries").get(0);
        entry.put("outcome", "ENGINE_UNSUPPORTED").putArray("issues").addObject().put("code", "UNSUPPORTED_UNIT_TEST")
            .put("message", "仅单元测试的失败证据").putNull("skillKey").putNull("fieldPath");
        assertEquals(Status.ENGINE_UNSUPPORTED, hero(get()).status());
        add("PARAMETER", "hero_q", "new", Map.of("skill_key", "hero_q", "parameter_key", "new", "value", 1));
        assertEquals(Status.UNVERIFIED, hero(get()).status());
        assertEquals("VERIFICATION_STALE", hero(get()).issues().getFirst().code());
    }

    @Test
    void scopeChangesInvalidateProofAndOutOfScopeNamesDoNotBecomeSelectable() throws Exception {
        installProof();
        scope.put("boundary", "新范围");
        assertEquals(Status.UNVERIFIED, hero(get()).status());
        add("CHARACTER", "", "outside", Map.of("character_key", "outside", "name", "完整英雄"));
        Entry outside = get().characters().stream().filter(entry -> entry.key().equals("outside")).findFirst().orElseThrow();
        assertEquals(Status.OUT_OF_SCOPE, outside.status());
        assertNull(outside.verification().requiredCoverage());
        assertTrue(outside.excludedSkillSources().isEmpty());
        when(resources.scope("arena")).thenReturn(new Document(null, "SCOPE_INVALID"));
        assertTrue(get().characters().stream().allMatch(entry -> entry.status() == Status.UNVERIFIED));
        assertTrue(get().characters().stream().allMatch(entry -> entry.excludedSkillSources().isEmpty()));
    }

    @Test
    void explicitExclusionsAreTransportedInEveryStatusRatherThanInferredFromCoverage() {
        ObjectNode expected = (ObjectNode) scope.path("characters").get(0).path("expectedSkills").get(0);
        expected.put("excluded", true).putObject("exclusion").put("reason", "原范围明确排除的原因");
        List<ExcludedSkillSource> exclusions = List.of(new ExcludedSkillSource("hero_p", "原范围明确排除的原因"));
        assertEquals(exclusions, hero(get()).excludedSkillSources());
        assertEquals(Status.UNVERIFIED, hero(get()).status());
        ObjectNode proof = installProof();
        assertEquals(Status.READY, hero(get()).status());
        assertEquals(exclusions, hero(get()).excludedSkillSources());
        ObjectNode entry = (ObjectNode) proof.path("entries").get(0);
        entry.put("outcome", "ENGINE_UNSUPPORTED").putArray("issues").addObject().put("code", "UNIT_TEST_ONLY")
            .put("message", "测试失败").putNull("skillKey").putNull("fieldPath");
        assertEquals(Status.ENGINE_UNSUPPORTED, hero(get()).status());
        assertEquals(exclusions, hero(get()).excludedSkillSources());
        rows.removeIf(row -> row.kind().equals("TRIGGER") && row.ownerKey().equals("hero_q"));
        assertEquals(Status.CONFIGURATION_INCOMPLETE, hero(get()).status());
        assertEquals(exclusions, hero(get()).excludedSkillSources());
        assertTrue(item(get()).excludedSkillSources().isEmpty());
    }

    @Test
    void currentScopeTransportsAllBoundRealExclusionsWithUnchangedReasonsAndNoOtherSkills() throws Exception {
        JsonNode originalScope = new SimulationAvailabilityResources(json, new DefaultResourceLoader()).scope("lol").value();
        assertNotNull(originalScope);
        List<Row> boundExclusions = new ArrayList<>();
        for (JsonNode character : originalScope.path("characters")) {
            for (JsonNode skill : character.path("expectedSkills")) {
                if (!skill.path("excluded").asBoolean(false)) continue;
                String key = skill.path("key").asText();
                ObjectNode binding = json.createObjectNode().put("game_id", "lol").put("character_key", character.path("key").asText()).put("skill_key", key);
                boundExclusions.add(new Row("CHARACTER_BINDING", character.path("key").asText(), key, json.writeValueAsString(binding)));
            }
        }
        when(games.countGames("lol")).thenReturn(1L);
        when(mapper.readGameRows("lol")).thenReturn(boundExclusions);
        when(resources.scope("lol")).thenReturn(new Document(originalScope, null));
        when(resources.verification("lol")).thenReturn(new Document(null, "VERIFICATION_NOT_FOUND"));
        SimulationAvailabilityResponse result = service.get("lol", WASM, ADAPTER);
        int excludedCount = 0;
        for (JsonNode character : originalScope.path("characters")) {
            Entry actual = result.characters().stream().filter(item -> item.key().equals(character.path("key").asText())).findFirst().orElseThrow();
            List<ExcludedSkillSource> expected = new ArrayList<>();
            for (JsonNode skill : character.path("expectedSkills")) {
                if (skill.path("excluded").asBoolean(false)) expected.add(new ExcludedSkillSource(skill.path("key").asText(), skill.path("exclusion").path("reason").asText()));
            }
            excludedCount += expected.size();
            assertEquals(expected, actual.excludedSkillSources());
            assertTrue(json.valueToTree(actual).path("excludedSkillSources").isArray());
        }
        // 当前范围已按用户确认加入布兰德R排除；仍逐项核对原技能及原因。
        assertEquals(25, excludedCount);
        Entry garen = result.characters().stream().filter(item -> item.key().equals("champion_garen")).findFirst().orElseThrow();
        assertEquals(List.of("garen_p"), garen.excludedSkillSources().stream().map(ExcludedSkillSource::skillKey).toList());
        Entry nasus = result.characters().stream().filter(item -> item.key().equals("champion_nasus")).findFirst().orElseThrow();
        assertEquals(List.of("nasus_w"), nasus.excludedSkillSources().stream().map(ExcludedSkillSource::skillKey).toList());
        assertTrue(result.equipment().stream().allMatch(item -> item.excludedSkillSources().isEmpty()));
    }

    @Test
    void unboundExcludedSlotNeedsNoSettingAndDoesNotBlockReadinessOrChangeScopeEvidence() {
        ObjectNode expected = (ObjectNode) scope.path("characters").get(0).path("expectedSkills").get(0);
        expected.put("excluded", true).putObject("exclusion").put("reason", "原明确排除，允许没有挂载");
        String scopeDigest = get().scopeDigest();
        assertEquals(1, hero(get()).excludedSkillSources().size());
        rows.removeIf(row -> row.kind().equals("CHARACTER_BINDING") && row.objectKey().equals("hero_p"));
        Entry beforeProof = hero(get());
        assertTrue(beforeProof.excludedSkillSources().isEmpty());
        assertEquals(Status.UNVERIFIED, beforeProof.status());
        assertEquals(scopeDigest, get().scopeDigest(), "完整排除依据仍由范围摘要绑定");
        assertTrue(beforeProof.issues().stream().noneMatch(issue -> issue.code().equals("EXPECTED_SKILL_BINDING_MISSING")));
        installProof();
        assertEquals(Status.READY, hero(get()).status());
        assertTrue(hero(get()).excludedSkillSources().isEmpty());
        rows.removeIf(row -> row.kind().equals("CHARACTER_BINDING") && row.objectKey().equals("hero_q"));
        Entry incomplete = hero(get());
        assertEquals(Status.CONFIGURATION_INCOMPLETE, incomplete.status());
        assertTrue(incomplete.excludedSkillSources().isEmpty());
        assertTrue(incomplete.issues().stream().anyMatch(issue -> issue.code().equals("EXPECTED_SKILL_BINDING_MISSING") && "hero_q".equals(issue.skillKey())));
    }

    @Test
    void missingLevelAttributesAndAmbiguousBasicAttackAreConfigurationIssues() throws Exception {
        replace("CHARACTER_ATTRIBUTES", "hero", "", Map.of("level_values", Map.of("2", Map.of("hp", 110))));
        skill("attack_two", "另一个普攻", 1);
        add("CHARACTER_BINDING", "hero", "attack_two", Map.of("character_key", "hero", "skill_key", "attack_two"));
        add("SKILL_CATEGORY", "attack_two", "basic", Map.of("skill_key", "attack_two", "skill_category_key", "basic"));
        assertTrue(hero(get()).issues().stream().anyMatch(issue -> issue.code().equals("LEVEL_ATTRIBUTES_MISSING") && issue.fieldPath().endsWith(".1")));
        assertTrue(hero(get()).issues().stream().anyMatch(issue -> issue.code().equals("BASIC_ATTACK_BINDING_NOT_UNIQUE")));
    }

    @Test
    void timestampsAndObjectKeyOrderAreNotBusinessChangesButArrayOrderIs() throws Exception {
        String original = hero(get()).contentDigest();
        Row first = rows.stream().filter(row -> row.kind().equals("SKILL") && row.objectKey().equals("hero_q")).findFirst().orElseThrow();
        ObjectNode data = (ObjectNode) json.readTree(first.data());
        data.put("created_at", "unit-test-timestamp").put("updated_at", "changed");
        rows.set(rows.indexOf(first), new Row(first.kind(), first.ownerKey(), first.objectKey(), json.writeValueAsString(data)));
        assertEquals(original, hero(get()).contentDigest());
        assertEquals(AvailabilityDigest.digest(json, json.readTree("{\"b\":2,\"a\":1}")), AvailabilityDigest.digest(json, json.readTree("{\"a\":1.0,\"b\":2.0}")));
        assertNotEquals(AvailabilityDigest.digest(json, json.readTree("[1,2]")), AvailabilityDigest.digest(json, json.readTree("[2,1]")));
    }

    @Test
    void crossGameRowsAndMalformedIdentityNeverReuseProof() {
        rows.add(new Row("CHARACTER", "", "intruder", "{\"game_id\":\"other\",\"character_key\":\"intruder\"}"));
        assertEquals("409.SIMULATION_AVAILABILITY_INVALID", assertThrows(ApiException.class, this::get).getCode());
        assertEquals("400.VALIDATION_FAILED", assertThrows(ApiException.class, () -> service.get("../arena", WASM, ADAPTER)).getCode());
        assertEquals("400.VALIDATION_FAILED", assertThrows(ApiException.class, () -> service.get("arena", "bad", ADAPTER)).getCode());
    }

    private SimulationAvailabilityResponse get() { return service.get("arena", WASM, ADAPTER); }

    @Test
    void splitLogicalSlotRequiresEveryCurrentBindingButNeverItsArchivedKey() throws Exception {
        splitCurrentSlot();
        Entry before = hero(get());
        assertEquals(Status.UNVERIFIED, before.status());
        assertTrue(before.issues().stream().noneMatch(issue -> issue.code().equals("EXPECTED_SKILL_BINDING_MISSING")));
        List<String> coverage = new ArrayList<>();
        before.verification().requiredCoverage().path("skills").forEach(value -> coverage.add(value.path("skillKey").asText()));
        assertTrue(coverage.containsAll(List.of("choice_blue", "choice_red", "choice_gold")));
        assertFalse(coverage.contains("hero_w"));
        installProof();
        assertEquals(Status.READY, hero(get()).status());
        rows.removeIf(row -> row.kind().equals("CHARACTER_BINDING") && row.objectKey().equals("choice_red"));
        Entry missing = hero(get());
        assertEquals(Status.CONFIGURATION_INCOMPLETE, missing.status());
        assertTrue(missing.issues().stream().anyMatch(issue -> issue.code().equals("EXPECTED_SKILL_BINDING_MISSING") && "choice_red".equals(issue.skillKey())));
        assertTrue(missing.issues().stream().noneMatch(issue -> "hero_w".equals(issue.skillKey())));
    }

    @Test
    void splitExclusionExpandsOnlyToBoundCurrentSourcesAndOmitsThemFromCoverage() throws Exception {
        ObjectNode slot = splitCurrentSlot();
        slot.put("excluded", true).putObject("exclusion").put("reason", "本次范围明确排除的拆分技能");
        rows.removeIf(row -> row.kind().equals("CHARACTER_BINDING") && row.objectKey().equals("choice_red"));
        rows.removeIf(row -> row.kind().equals("TRIGGER") && row.ownerKey().startsWith("choice_"));
        Entry entry = hero(get());
        assertEquals(Status.UNVERIFIED, entry.status());
        assertEquals(List.of("choice_blue", "choice_gold"), entry.excludedSkillSources().stream().map(ExcludedSkillSource::skillKey).toList());
        assertTrue(entry.excludedSkillSources().stream().allMatch(value -> value.reason().equals("本次范围明确排除的拆分技能")));
        assertFalse(entry.verification().requiredCoverage().path("skills").toString().contains("choice_"));
        assertTrue(entry.issues().stream().noneMatch(issue -> issue.code().equals("EXPECTED_SKILL_BINDING_MISSING") || issue.code().equals("SKILL_PROGRAM_MISSING")));
        installProof();
        assertEquals(Status.READY, hero(get()).status());
    }

    private ObjectNode splitCurrentSlot() throws Exception {
        ObjectNode slot = (ObjectNode) scope.path("characters").get(0).path("expectedSkills").get(2);
        slot.putArray("currentSkillKeys").add("choice_blue").add("choice_red").add("choice_gold");
        rows.removeIf(row -> row.kind().equals("CHARACTER_BINDING") && row.objectKey().equals("hero_w"));
        for (String key : List.of("choice_blue", "choice_red", "choice_gold")) {
            skill(key, "拆分后的普通技能", 2);
            add("CHARACTER_BINDING", "hero", key, Map.of("character_key", "hero", "skill_key", key));
        }
        return slot;
    }
    private Entry hero(SimulationAvailabilityResponse response) { return response.characters().stream().filter(entry -> entry.key().equals("hero")).findFirst().orElseThrow(); }
    private Entry item(SimulationAvailabilityResponse response) { return response.equipment().getFirst(); }

    private ObjectNode installProof() {
        SimulationAvailabilityResponse current = get();
        ObjectNode proof = json.createObjectNode().put("schemaVersion", "simulation-verification-v1").put("gameId", "arena")
            .put("profile", current.profile()).put("digestVersion", current.digestVersion()).put("scopeDigest", current.scopeDigest())
            .put("sharedDigest", current.sharedDigest()).put("wasmSha256", WASM).put("adapterVersion", ADAPTER);
        ArrayNode entries = proof.putArray("entries");
        proofEntry(entries, "CHARACTER", hero(current));
        proofEntry(entries, "EQUIPMENT", item(current));
        when(resources.verification("arena")).thenReturn(new Document(proof, null));
        return proof;
    }

    private void proofEntry(ArrayNode entries, String kind, Entry entry) {
        ObjectNode proof = entries.addObject().put("kind", kind).put("key", entry.key()).put("contentDigest", entry.contentDigest())
            .put("externalDigest", entry.verification().externalDigest()).put("outcome", "PASSED");
        ObjectNode coverage = entry.verification().requiredCoverage().deepCopy();
        proof.set("coverage", coverage.put("levelValidation", "each-declared-level"));
        proof.putArray("evidenceRefs").add("unit-test-fixture-only");
        proof.putArray("issues");
    }

    private void addRepresentativeCases(ObjectNode entry) {
        ((ObjectNode) entry.path("coverage")).put("levelValidation", "representative-cases");
        ArrayNode cases = entry.putArray("validationCases");
        for (String side : List.of("source", "target")) {
            ObjectNode sample = cases.addObject().put("caseKey", "representative_" + side)
                .put("evidenceRef", "unit-test-fixture-only").put("objectSide", side)
                .put("sourceLevel", 1).put("targetLevel", 1).put("complete", true).put("released", true);
            ArrayNode levels = sample.putArray("skillLevels");
            entry.path("coverage").path("skills").forEach(skill -> levels.addObject()
                .put("skillKey", skill.path("skillKey").asText()).put("level", 1));
        }
    }

    private void skill(String key, String name, int max) throws Exception {
        add("SKILL", "", key, Map.of("skill_key", key, "name", name, "status", "ENABLED", "max_level", max));
        add("TRIGGER", key, "entry", Map.of("skill_key", key, "rule_key", "entry", "actions", List.of(Map.of("type", "UNIT_TEST_ONLY"))));
    }

    private void add(String kind, String owner, String key, Map<String, Object> values) throws Exception {
        ObjectNode data = json.valueToTree(values);
        data.put("game_id", "arena");
        rows.add(new Row(kind, owner, key, json.writeValueAsString(data)));
    }

    private void replace(String kind, String owner, String key, Map<String, Object> values) throws Exception {
        rows.removeIf(row -> row.kind().equals(kind) && row.ownerKey().equals(owner) && row.objectKey().equals(key));
        add(kind, owner, key, values);
    }
}
