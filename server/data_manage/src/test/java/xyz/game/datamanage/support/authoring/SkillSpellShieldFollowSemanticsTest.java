package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.TargetType;
import xyz.game.datamanage.support.error.ApiException;

class SkillSpellShieldFollowSemanticsTest {
    private static final Map<String, Set<String>> OWNERS = Map.of("follower_skill", Set.of("hero"), "producer_skill", Set.of("hero"));

    @Test void damageLeafFollowsOnlyItsCompleteOwnedDirectResultAndAddsAProtectedReference() {
        var follower = effect("follower_skill", true);
        var producer = effect("producer_skill", false);
        assertDoesNotThrow(() -> validate(follower, producer));
        var reference = SkillObjectReferences.extract("lol", List.of(follower)).stream()
            .filter(ref -> ref.target().type() == TargetType.RESULT).findFirst().orElseThrow();
        assertEquals("results[0].detail.spellShieldFollowResult.resultKey", reference.fieldPath());
        assertEquals("producer_skill", reference.target().skillKey());
        assertEquals("payload", reference.target().key());
        assertEquals("damage", reference.target().subKey());
        assertThrows(ApiException.class, () -> SkillObjectReferences.validateExistingTargets(List.of(reference), List.of(follower), Set.of()));
        assertDoesNotThrow(() -> SkillObjectReferences.validateExistingTargets(List.of(reference), List.of(follower, producer), Set.of()));
    }

    @ParameterizedTest @ValueSource(strings = {"scope", "source", "persistent", "application", "primary", "replace", "unknown", "null"})
    void theFollowerCannotChangeItsOwnQualificationOrPretendToBeThePrimary(String mutation) {
        var follower = effect("follower_skill", true);
        var producer = effect("producer_skill", false);
        switch (mutation) {
            case "scope" -> result(follower).put("spellShieldBlockScope", "SKILL");
            case "source" -> result(follower).put("target", "SOURCE");
            case "persistent" -> ((ObjectNode) follower.data()).set("lifecycle", AggregateJson.tree("{}"));
            case "application" -> result(follower).set("lifecycleBehavior", AggregateJson.tree("{\"moment\":\"APPLICATION\",\"periodicExecutionMode\":null}"));
            case "primary" -> detail(follower).put("attackDamageRole", "PRIMARY");
            case "replace" -> detail(follower).put("attackDamageRole", "REPLACE_PRIMARY");
            case "unknown" -> ((ObjectNode) detail(follower).path("spellShieldFollowResult")).put("extra", "x");
            case "null" -> detail(follower).putNull("spellShieldFollowResult");
        }
        assertThrows(ApiException.class, () -> validate(follower, producer));
    }

    @ParameterizedTest @ValueSource(strings = {"scope", "type", "target", "periodic", "application", "primary", "replace", "chain", "cycle", "missing", "duplicate"})
    void producerMutationMissingOrAmbiguousResultsAndFollowChainsAreRejected(String mutation) {
        var follower = effect("follower_skill", true);
        var producer = effect("producer_skill", false);
        switch (mutation) {
            case "scope" -> result(producer).putNull("spellShieldBlockScope");
            case "type" -> result(producer).put("resultType", "DIRECT_HEAL");
            case "target" -> result(producer).put("target", "SOURCE");
            case "periodic" -> result(producer).set("lifecycleBehavior", AggregateJson.tree("{\"moment\":\"PERIODIC\"}"));
            case "application" -> result(producer).set("lifecycleBehavior", AggregateJson.tree("{\"moment\":\"APPLICATION\",\"periodicExecutionMode\":null}"));
            case "primary" -> detail(producer).put("attackDamageRole", "PRIMARY");
            case "replace" -> detail(producer).put("attackDamageRole", "REPLACE_PRIMARY");
            case "chain", "cycle" -> detail(producer).set("spellShieldFollowResult", AggregateJson.tree("{\"skillKey\":\"follower_skill\",\"effectKey\":\"payload\",\"resultKey\":\"damage\"}"));
            case "missing" -> result(producer).put("resultKey", "another");
            case "duplicate" -> ((com.fasterxml.jackson.databind.node.ArrayNode) producer.data().path("results")).add(result(producer).deepCopy());
        }
        assertThrows(ApiException.class, () -> validate(follower, producer));
    }

    @Test void selfReferenceAndDifferentCharacterOrUnattachedDefinitionsCannotBeAccepted() {
        var follower = effect("follower_skill", true);
        var producer = effect("producer_skill", false);
        for (var owners : List.of(Map.<String, Set<String>>of(), Map.of("follower_skill", Set.of("one"), "producer_skill", Set.of("two")),
            Map.of("follower_skill", Set.of("one", "two"), "producer_skill", Set.of("one")))) {
            assertThrows(ApiException.class, () -> SkillSpellShieldFollowSemantics.validate(List.of(follower), List.of(follower, producer), owners));
        }
        ((ObjectNode) detail(follower).path("spellShieldFollowResult")).put("skillKey", "follower_skill");
        assertThrows(ApiException.class, () -> validate(follower, producer));
    }

    @Test void subsequentProducerChangesRecheckTheExistingFollowerEvenWhenOnlyTheProducerWasEdited() {
        var follower = effect("follower_skill", true);
        var producer = effect("producer_skill", false);
        var reference = SkillObjectReferences.extract("lol", List.of(follower)).stream()
            .filter(ref -> ref.target().type() == TargetType.RESULT).findFirst().orElseThrow();
        var row = new ConfigurationChangeScope.Row("EFFECT", "producer_skill", "payload");
        var oldData = producer.data().deepCopy();
        result(producer).putNull("spellShieldBlockScope");
        var before = new ConfigurationChangeScope.Snapshot(Map.of(row, oldData), List.of(follower), List.of(reference));
        var after = new ConfigurationChangeScope.Snapshot(Map.of(row, producer.data()), List.of(follower, producer), List.of(reference));
        var changes = ConfigurationChangeScope.compare(before, after);
        assertTrue(changes.affected().contains(new ConfigurationChangeScope.Source(SourceType.EFFECT, "follower_skill", "payload")));
        assertThrows(ApiException.class, () -> validate(follower, producer));
    }

    @Test void characterRelationRemovalSelectsExistingFollowersForRevalidation() {
        var follower = effect("follower_skill", true);
        var producer = effect("producer_skill", false);
        var row = new ConfigurationChangeScope.Row("CHARACTER_SKILLS", "", "hero");
        var before = new ConfigurationChangeScope.Snapshot(Map.of(row, AggregateJson.tree("[\"follower_skill\",\"producer_skill\"]")), List.of(follower, producer), List.of());
        var after = new ConfigurationChangeScope.Snapshot(Map.of(row, AggregateJson.tree("[\"follower_skill\"]")), List.of(follower, producer), List.of());
        var changes = ConfigurationChangeScope.compare(before, after);
        assertEquals(Set.of(new ConfigurationChangeScope.Source(SourceType.EFFECT, "follower_skill", "payload")), changes.affected());
    }

    private static void validate(Aggregate follower, Aggregate producer) {
        SkillSpellShieldFollowSemantics.validate(List.of(follower), List.of(follower, producer), OWNERS);
    }
    private static ObjectNode result(Aggregate effect) { return (ObjectNode) effect.data().path("results").get(0); }
    private static ObjectNode detail(Aggregate effect) { return (ObjectNode) result(effect).path("detail"); }
    static Aggregate effect(String skill, boolean follow) {
        var effect = new Aggregate(SourceType.EFFECT, skill, "payload", AggregateJson.tree("""
            {"lifecycle":null,"results":[{"resultKey":"damage","resultType":"DAMAGE","target":"TARGET",
             "spellShieldBlockScope":null,"lifecycleBehavior":null,
             "valueRule":{"value":{"kind":"FIXED","value":75},"fixedMultiplier":1,"fixedMinValue":0,"fixedMaxValue":null},
             "detail":{"damageTypeKey":"magic","deliveryKind":"SKILL","originKind":"DIRECT",
              "critical":{"mode":"DISALLOWED","multiplierValue":null},"vampQualification":"UNRESOLVED","vampOverrides":[]}}]}
            """));
        if (follow) detail(effect).set("spellShieldFollowResult", AggregateJson.tree("{\"skillKey\":\"producer_skill\",\"effectKey\":\"payload\",\"resultKey\":\"damage\"}"));
        else result(effect).put("spellShieldBlockScope", "SKILL");
        return effect;
    }
}
