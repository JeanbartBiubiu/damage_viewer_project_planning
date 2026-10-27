package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.IntStream;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import xyz.game.datamanage.model.authoring.ConfigurationReferenceAuditResponse;
import xyz.game.datamanage.support.authoring.ConfigurationReferenceAuditor.Input;
import xyz.game.datamanage.support.authoring.ConfigurationReferenceAuditor.ReadCounts;
import xyz.game.datamanage.support.authoring.ConfigurationReferenceAuditor.Source;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Reference;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Target;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.TargetType;

class ConfigurationReferenceAuditorTest {
    @Test
    void comparesFullIdentityAndDoesNotMatchAnotherGamesIndex() {
        Source source = effect("skill_a", "effect", "physical");
        Reference expected = references(source).getFirst();
        var foreign = new Reference("other", expected.sourceSkillKey(), expected.sourceType(), expected.sourceKey(),
            expected.fieldPath(), expected.target());
        var wrongPath = new Reference("lol", expected.sourceSkillKey(), expected.sourceType(), expected.sourceKey(),
            "results[1].detail.damageTypeKey", expected.target());
        var wrongSkill = new Reference("lol", "skill_b", expected.sourceType(), expected.sourceKey(),
            expected.fieldPath(), expected.target());
        var result = audit(List.of(source), List.of(foreign, wrongPath, wrongSkill), Set.of(expected.target()));
        assertTrue(result.complete());
        assertFalse(result.healthy());
        assertEquals(1, count(result, "INDEX_MISSING"));
        assertEquals(3, count(result, "INDEX_EXTRA"));
        assertEquals(0, count(result, "TARGET_MISSING"));
        assertEquals(4, result.totalIssueCount());
    }

    @Test
    void missingTargetIsReportedEvenWhenSavedIndexMatches() {
        Source source = effect("skill_a", "effect", "missing");
        var result = audit(List.of(source), references(source), Set.of());
        assertTrue(result.complete());
        assertEquals(1, result.totalIssueCount());
        var issue = result.issues().getFirst();
        assertEquals("TARGET_MISSING", issue.code());
        assertEquals("results[0].detail.damageTypeKey", issue.fieldPath());
        assertEquals("DAMAGE_TYPE", issue.targetType());
        assertEquals("missing", issue.targetKey());
    }

    @Test
    void invalidSourceDoesNotInventExtraIndexOrMissingChildTarget() {
        Source badEffect = new Source(SourceType.EFFECT, "skill_a", "broken", "{broken");
        Source caller = trigger("caller", "broken", "hit");
        var oldBadIndex = new Reference("lol", "skill_a", SourceType.EFFECT, "broken", "old.path",
            new Target(TargetType.ATTRIBUTE, "", "hp", ""));
        var saved = new ArrayList<>(references(caller));
        saved.add(oldBadIndex);
        var result = audit(List.of(badEffect, caller), saved, Set.of(oldBadIndex.target()));
        assertFalse(result.complete());
        assertFalse(result.healthy());
        assertNull(result.totalIssueCount());
        assertNull(result.counts().extractedReferenceCount());
        assertEquals(1, count(result, "SOURCE_JSON_INVALID"));
        assertEquals(0, count(result, "INDEX_EXTRA"));
        assertEquals(0, count(result, "TARGET_MISSING"));
        assertEquals(1, result.observedIssueCount());
    }

    @Test
    void malformedShapesStayIncompleteButOtherDefiniteProblemsContinue() {
        for (String json : List.of("null", "[]", "{\"results\":{}}", "{\"results\":[{\"resultType\":\"UNKNOWN\"}]}")) {
            Source bad = new Source(SourceType.EFFECT, "skill_a", "bad", json);
            Source good = effect("skill_b", "good", "missing");
            var result = audit(List.of(bad, good), List.of(), Set.of());
            assertFalse(result.complete(), json);
            assertNull(result.totalIssueCount(), json);
            assertEquals(1, count(result, "SOURCE_JSON_INVALID"), json);
            assertEquals(1, count(result, "INDEX_MISSING"), json);
            assertEquals(1, count(result, "TARGET_MISSING"), json);
        }
    }

    @Test
    void targetContextUsesSkillAndExactChildIdentity() {
        Source target = effect("skill_a", "effect", "physical");
        Source otherSkillTarget = effect("skill_b", "effect", "physical");
        Source wrongChild = trigger("wrong_child", "effect", "absent");
        Source rightChild = trigger("right_child", "effect", "damage");
        List<Source> sources = List.of(target, otherSkillTarget, wrongChild, rightChild);
        List<Reference> existing = sources.stream().flatMap(source -> references(source).stream()).toList();
        var result = audit(sources, existing, Set.of(new Target(TargetType.DAMAGE_TYPE, "", "physical", "")));
        assertTrue(result.complete());
        assertEquals(1, result.totalIssueCount());
        assertEquals("absent", result.issues().getFirst().targetSubKey());
        assertEquals("skill_a", result.issues().getFirst().targetSkillKey());
    }

    @Test
    void duplicateTargetChildrenAreNotUniqueTargets() {
        Source target = new Source(SourceType.EFFECT, "skill_a", "effect", """
            {"results":[{"resultKey":"damage","resultType":"DIRECT_HEAL"},
                        {"resultKey":"damage","resultType":"DIRECT_HEAL"}]}
            """);
        Source caller = trigger("caller", "effect", "damage");
        var result = audit(List.of(target, caller), references(caller), Set.of());
        assertTrue(result.complete());
        assertEquals(1, count(result, "TARGET_MISSING"));
    }

    @Test
    void invalidResultIdentityFromTargetInspectionReturnsIncompleteReportInsteadOf500() {
        Source target = new Source(SourceType.EFFECT, "skill_a", "effect",
            "{\"results\":[{\"resultKey\":123,\"resultType\":\"DIRECT_HEAL\"}]}");
        Source caller = trigger("caller", "effect", "damage");
        var result = assertDoesNotThrow(() -> audit(List.of(target, caller), references(caller), Set.of()));
        assertFalse(result.complete());
        assertFalse(result.healthy());
        assertNull(result.totalIssueCount());
        assertNull(result.counts().extractedReferenceCount());
        assertEquals(1, result.observedIssueCount());
        var issue = result.issues().getFirst();
        assertEquals("SOURCE_JSON_INVALID", issue.code());
        assertEquals("EFFECT", issue.sourceType());
        assertEquals("effect", issue.sourceKey());
        assertEquals("resultKey", issue.fieldPath());
        assertEquals(0, count(result, "TARGET_MISSING"));
    }

    @ParameterizedTest
    @MethodSource("invalidChildIdentities")
    void invalidChildIdentityBelongsToItsOwnerAndDoesNotInventOwnerIndexDifferences(
        SourceType sourceType, TargetType childType, String field, String json
    ) {
        Source bad = new Source(sourceType, "skill_a", "broken", json);
        Source helper = new Source(SourceType.EFFECT, "skill_a", "helper", "{\"results\":[]}");
        Source caller = new Source(SourceType.TRIGGER, "skill_a", "caller",
            "{\"eventSource\":{\"eventType\":\"SOURCE_INITIALIZED\",\"detail\":{}},\"conditionGroups\":[],\"actions\":[]}");
        Reference childIndex = new Reference("lol", "skill_a", SourceType.TRIGGER, "caller", "old.child",
            new Target(childType, "skill_a", "broken", "wanted"));
        Reference ownerIndex = new Reference("lol", "skill_a", sourceType, "broken", "old.owner",
            new Target(TargetType.ATTRIBUTE, "", "hp", ""));
        var result = assertDoesNotThrow(() -> audit(List.of(bad, helper, caller), List.of(childIndex, ownerIndex),
            Set.of(ownerIndex.target(), new Target(TargetType.DAMAGE_TYPE, "", "physical", ""))));
        assertFalse(result.complete());
        assertFalse(result.healthy());
        assertNull(result.totalIssueCount());
        assertNull(result.counts().extractedReferenceCount());
        assertEquals(1, count(result, "SOURCE_JSON_INVALID"));
        var sourceIssue = result.issues().stream().filter(issue -> issue.code().equals("SOURCE_JSON_INVALID")).findFirst().orElseThrow();
        assertEquals(sourceType.name(), sourceIssue.sourceType());
        assertEquals("broken", sourceIssue.sourceKey());
        assertEquals(field, sourceIssue.fieldPath());
        assertEquals(0, count(result, "TARGET_MISSING"));
        assertEquals(0, count(result, "INDEX_MISSING"));
        assertTrue(result.issues().stream().noneMatch(issue -> issue.code().equals("INDEX_EXTRA") && issue.sourceKey().equals("broken")));
        assertEquals(1, count(result, "INDEX_EXTRA")); // 调用方的旧索引可确定为多余，与损坏源的索引分开判断。
    }

    static Stream<Arguments> invalidChildIdentities() {
        return Stream.of("123", "true", "{}", "[]", "\"\"").flatMap(invalid -> Stream.of(
            Arguments.of(SourceType.EFFECT, TargetType.RESULT, "resultKey", """
                {"results":[{"resultKey":%s,"resultType":"DAMAGE","detail":{"damageTypeKey":"physical"}}]}
                """.formatted(invalid)),
            Arguments.of(SourceType.PROCESS, TargetType.STEP, "stepKey", """
                {"steps":[{"stepKey":%s,"stepType":"IMMEDIATE"}],"cooldown":null,
                 "effectBindings":[{"effectKey":"helper","moment":{}}],"stateOperations":[]}
                """.formatted(invalid)),
            Arguments.of(SourceType.TRIGGER, TargetType.ACTION, "actionKey", """
                {"eventSource":{"eventType":"SOURCE_INITIALIZED","detail":{}},"conditionGroups":[],
                 "actions":[{"actionKey":%s,"actionType":"EXECUTE_EFFECT","detail":{"effectKey":"helper"},
                  "runtimeInputBindings":[],"resultModifiers":[]}]}
                """.formatted(invalid)),
            Arguments.of(SourceType.STATE, TargetType.OPTION, "optionKey", """
                {"stateType":"MODE","detail":{"options":[{"optionKey":%s}]}}
                """.formatted(invalid))));
    }

    @Test
    void extractionFailureKeepsItsKnownFieldPath() {
        Source bad = new Source(SourceType.TRIGGER, "skill_a", "bad",
            "{\"eventSource\":{\"eventType\":\"UNKNOWN\",\"detail\":{}},\"conditionGroups\":[],\"actions\":[]}");
        var result = audit(List.of(bad), List.of(), Set.of());
        assertEquals(1, result.observedIssueCount());
        assertEquals("SOURCE_JSON_INVALID", result.issues().getFirst().code());
        assertEquals("eventSource", result.issues().getFirst().fieldPath());
    }

    @Test
    void displayTruncationKeepsPreciseTotalAndStableOrder() {
        List<Source> sources = IntStream.range(0, 260).mapToObj(i -> effect("skill_a", "e_%03d".formatted(i), "physical")).toList();
        var result = audit(sources, List.of(), Set.of(new Target(TargetType.DAMAGE_TYPE, "", "physical", "")));
        assertTrue(result.complete());
        assertFalse(result.healthy());
        assertTrue(result.truncated());
        assertEquals(260, result.totalIssueCount());
        assertEquals(260, result.observedIssueCount());
        assertEquals(200, result.returnedIssueCount());
        assertEquals("e_000", result.issues().getFirst().sourceKey());
        var reversed = new ArrayList<>(sources);
        Collections.reverse(reversed);
        assertEquals(result, audit(reversed, List.of(), Set.of(new Target(TargetType.DAMAGE_TYPE, "", "physical", ""))));
    }

    @Test
    void exactlyEachReadLimitIsAllowedAndOneOverIsIncomplete() {
        var equal = new ReadCounts(5000, 50000, 20000, 30L * 1024 * 1024, 2L * 1024 * 1024, 2L * 1024 * 1024);
        assertTrue(ConfigurationReferenceAuditor.readBudgetProblems(equal).isEmpty());
        for (ReadCounts counts : List.of(
            new ReadCounts(5001, 1, 1, 1, 1, 1), new ReadCounts(1, 50001, 1, 1, 1, 1),
            new ReadCounts(1, 1, 20001, 1, 1, 1), new ReadCounts(1, 1, 1, 32L * 1024 * 1024, 1, 1),
            new ReadCounts(1, 1, 1, 1, 1, 2L * 1024 * 1024 + 1))) {
            var result = ConfigurationReferenceAuditor.audit(new Input("lol", counts, List.of(), List.of(), Set.of(), false));
            assertFalse(result.complete());
            assertFalse(result.healthy());
            assertNull(result.totalIssueCount());
            assertNull(result.counts().extractedReferenceCount());
            assertEquals(counts.sourceCount(), result.counts().sourceCount());
            assertEquals(counts.existingReferenceCount(), result.counts().existingReferenceCount());
            assertEquals(counts.catalogTargetCount(), result.counts().catalogTargetCount());
            assertEquals("AUDIT_LIMIT_EXCEEDED", result.issues().getFirst().code());
        }
    }

    @Test
    void extractionLimitAllowsExactly50000AndStopsAtFirstOverBudget() {
        var exact = manyEffectReferences(50000);
        var result = audit(exact, List.of(), Set.of(new Target(TargetType.ATTRIBUTE, "", "hp", "")));
        assertTrue(result.complete());
        assertEquals(50000, result.counts().extractedReferenceCount());
        assertEquals(50000, result.totalIssueCount());
        var over = audit(manyEffectReferences(50001), List.of(), Set.of(new Target(TargetType.ATTRIBUTE, "", "hp", "")));
        assertFalse(over.complete());
        assertFalse(over.healthy());
        assertNull(over.totalIssueCount());
        assertNull(over.counts().extractedReferenceCount());
        assertEquals(1, count(over, "AUDIT_LIMIT_EXCEEDED"));
        assertEquals(0, count(over, "INDEX_EXTRA"));
    }

    @Test
    void emptyCompletedGameIsHealthyButReadInsuranceMismatchIsNot() {
        var empty = audit(List.of(), List.of(), Set.of());
        assertTrue(empty.complete());
        assertTrue(empty.healthy());
        assertEquals(0, empty.totalIssueCount());
        assertEquals(0, empty.counts().extractedReferenceCount());
        var mismatch = ConfigurationReferenceAuditor.audit(new Input("lol", new ReadCounts(1, 0, 0, 1, 0, 1),
            List.of(), List.of(), Set.of(), false));
        assertFalse(mismatch.complete());
        assertNull(mismatch.counts().extractedReferenceCount());
    }

    @Test
    void exactSourceCatalogAndExistingReferenceCountsCanCompleteTogether() {
        List<Source> sources = new ArrayList<>(manyEffectReferences(50000));
        while (sources.size() < 5000)
            sources.add(new Source(SourceType.EFFECT, "skill_a", "empty_" + sources.size(), "{\"results\":[]}"));
        List<Reference> existing = sources.stream().flatMap(source -> references(source).stream()).toList();
        Set<Target> catalog = new HashSet<>();
        catalog.add(new Target(TargetType.ATTRIBUTE, "", "hp", ""));
        while (catalog.size() < 20000)
            catalog.add(new Target(TargetType.ATTRIBUTE, "", "a_" + catalog.size(), ""));
        var result = audit(sources, existing, catalog);
        assertTrue(result.complete());
        assertTrue(result.healthy());
        assertEquals(5000, result.counts().sourceCount());
        assertEquals(50000, result.counts().existingReferenceCount());
        assertEquals(20000, result.counts().catalogTargetCount());
        assertEquals(50000, result.counts().extractedReferenceCount());
    }

    private static List<Source> manyEffectReferences(int count) {
        List<Source> sources = new ArrayList<>();
        for (int offset = 0; offset < count; offset += 1000) {
            var root = AggregateJson.tree("{\"results\":[]}");
            var results = (com.fasterxml.jackson.databind.node.ArrayNode) root.path("results");
            for (int i = 0; i < Math.min(1000, count - offset); i++)
                results.add(AggregateJson.tree("{\"resultKey\":\"r_" + i + "\",\"resultType\":\"RESOURCE_CHANGE\",\"detail\":{\"attributeKey\":\"hp\"}}"));
            sources.add(new Source(SourceType.EFFECT, "skill_a", "effect_" + offset, root.toString()));
        }
        return sources;
    }

    private static Source effect(String skill, String key, String damageType) {
        return new Source(SourceType.EFFECT, skill, key, """
            {"results":[{"resultKey":"damage","resultType":"DAMAGE","detail":{"damageTypeKey":"%s"}}]}
            """.formatted(damageType));
    }

    private static Source trigger(String key, String effect, String result) {
        return new Source(SourceType.TRIGGER, "skill_a", key, """
            {"eventSource":{"eventType":"RESULT_AVAILABLE","detail":{"effectKey":"%s","resultKey":"%s"}},
             "conditionGroups":[],"actions":[]}
            """.formatted(effect, result));
    }

    private static List<Reference> references(Source source) {
        return SkillObjectReferences.extract("lol", List.of(new SkillObjectReferences.Aggregate(source.type(),
            source.skillKey(), source.key(), AggregateJson.tree(source.json()))));
    }

    private static ConfigurationReferenceAuditResponse audit(List<Source> sources, List<Reference> existing, Set<Target> catalog) {
        long bytes = sources.stream().mapToLong(source -> source.json().getBytes(StandardCharsets.UTF_8).length).sum();
        long maxBytes = sources.stream().mapToLong(source -> source.json().getBytes(StandardCharsets.UTF_8).length).max().orElse(0);
        long pathBytes = existing.stream().mapToLong(reference -> reference.fieldPath().getBytes(StandardCharsets.UTF_8).length).sum();
        return ConfigurationReferenceAuditor.audit(new Input("lol", new ReadCounts(sources.size(), existing.size(), catalog.size(),
            bytes, pathBytes, maxBytes), sources, existing, new HashSet<>(catalog), true));
    }

    private static long count(ConfigurationReferenceAuditResponse response, String code) {
        return response.issues().stream().filter(issue -> code.equals(issue.code())).count();
    }
}
