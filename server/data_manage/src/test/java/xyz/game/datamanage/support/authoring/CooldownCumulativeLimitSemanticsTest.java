package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.model.skilleffect.SkillEffectCreateRequest;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

class CooldownCumulativeLimitSemanticsTest {
    @Test
    void equalLimitsShareAGroupWhileTargetSkillsAndOwningSkillsRemainIndependent() {
        Aggregate first = effect("first", "target_q", "{\"groupKey\":\"refund\",\"maxRatio\":0.39}");
        Aggregate second = effect("second", "target_q", "{\"groupKey\":\"refund\",\"maxRatio\":0.390}");
        Aggregate otherTarget = effect("other_target", "target_e", "{\"groupKey\":\"refund\",\"maxRatio\":0.2}");
        Aggregate otherOwner = new Aggregate(SourceType.EFFECT, "other_skill", "other_owner", effect("other_owner", "target_q",
            "{\"groupKey\":\"refund\",\"maxRatio\":1}").data());
        List<Aggregate> all = List.of(first, second, otherTarget, otherOwner);
        assertDoesNotThrow(() -> CooldownCumulativeLimitSemantics.validate(all, all));
    }

    @ParameterizedTest
    @ValueSource(strings = {"null", "[]", "{}", "{\"groupKey\":\"refund\",\"maxRatio\":0.39,\"extra\":1}",
        "{\"groupKey\":\"Bad-Key\",\"maxRatio\":0.39}", "{\"groupKey\":\"refund\",\"maxRatio\":\"0.39\"}",
        "{\"groupKey\":\"refund\",\"maxRatio\":0}", "{\"groupKey\":\"refund\",\"maxRatio\":1.01}"})
    void invalidLimitShapeOrValueIsRejectedAtItsActualField(String limit) {
        Aggregate effect = effect("refund", "target_q", limit);
        ApiException exception = assertThrows(ApiException.class,
            () -> CooldownCumulativeLimitSemantics.validate(List.of(effect), List.of(effect)));
        assertTrue(exception.getDetails().toString().contains("results[0].detail.cumulativeLimit"));
    }

    @Test
    void nonfiniteProgrammaticNumberWrongOperationAndNonuniqueScopeAreRejected() {
        for (String mutation : List.of("nonfinite", "operation", "all", "many")) {
            Aggregate effect = effect("refund", "target_q", "{\"groupKey\":\"refund\",\"maxRatio\":0.39}");
            ObjectNode detail = detail(effect);
            switch (mutation) {
                case "nonfinite" -> ((ObjectNode) detail.path("cumulativeLimit")).put("maxRatio", Double.NaN);
                case "operation" -> detail.put("operation", "REDUCE_REMAINING_RATIO");
                case "all" -> ((ObjectNode) detail.path("affectedSkillScope")).put("mode", "ALL");
                case "many" -> ((com.fasterxml.jackson.databind.node.ArrayNode) detail.path("affectedSkillScope").path("skillKeys")).add("target_e");
            }
            assertThrows(ApiException.class, () -> CooldownCumulativeLimitSemantics.validate(List.of(effect), List.of(effect)), mutation);
        }
    }

    @Test
    void unchangedSiblingLimitsParticipateInTheSameCheckAsCandidateProjection() {
        Aggregate prior = effect("first", "target_q", "{\"groupKey\":\"refund\",\"maxRatio\":0.39}");
        Aggregate changed = effect("second", "target_q", "{\"groupKey\":\"refund\",\"maxRatio\":0.4}");
        ApiException finalState = assertThrows(ApiException.class,
            () -> CooldownCumulativeLimitSemantics.validate(List.of(changed), List.of(prior, changed)));
        Map<String, SkillEffectCreateRequest> candidates = Map.of(
            "first", AggregateJson.read(prior.data().toString(), SkillEffectCreateRequest.class),
            "second", AggregateJson.read(changed.data().toString(), SkillEffectCreateRequest.class));
        ApiException projected = assertThrows(ApiException.class,
            () -> CooldownCumulativeLimitSemantics.validateCandidates("refund_skill", candidates));
        assertEquals(finalState.getCode(), projected.getCode());
        assertTrue(finalState.getDetails().toString().contains("CUMULATIVE_LIMIT_CONFLICT"));
        assertTrue(projected.getDetails().toString().contains("CUMULATIVE_LIMIT_CONFLICT"));
    }

    private static ObjectNode detail(Aggregate source) { return (ObjectNode) source.data().path("results").get(0).path("detail"); }

    private static Aggregate effect(String key, String targetSkill, String limit) {
        return new Aggregate(SourceType.EFFECT, "refund_skill", key, AggregateJson.tree("""
            {"effectKey":"%s","name":"累计返还","description":null,"sortOrder":0,"lifecycle":null,
             "results":[{"resultKey":"refund","name":"返还","resultType":"COOLDOWN_CHANGE","target":"SOURCE",
              "description":null,"sortOrder":0,"lifecycleBehavior":null,"spellShieldBlockScope":null,
              "valueRule":{"value":{"kind":"FIXED","value":0.13},"fixedMultiplier":1,"fixedMinValue":null,"fixedMaxValue":null},
              "detail":{"operation":"REDUCE_TOTAL_RATIO","affectedSkillScope":{"mode":"SKILLS","skillKeys":["%s"],"skillCategoryKeys":[]},
                "cumulativeLimit":%s}}]}
            """.formatted(key, targetSkill, limit)));
    }
}
