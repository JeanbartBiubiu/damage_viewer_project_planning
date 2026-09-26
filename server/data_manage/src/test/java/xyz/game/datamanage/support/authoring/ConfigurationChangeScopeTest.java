package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.support.authoring.ConfigurationChangeScope.Changes;
import xyz.game.datamanage.support.authoring.ConfigurationChangeScope.Row;
import xyz.game.datamanage.support.authoring.ConfigurationChangeScope.Snapshot;
import xyz.game.datamanage.support.authoring.ConfigurationChangeScope.Source;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Reference;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Target;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.TargetType;

class ConfigurationChangeScopeTest {

    @Test
    void parameterChangeExpandsThroughFormulaEffectAndTriggerOnly() {
        Aggregate formula = aggregate(SourceType.FORMULA, "s", "f", "{}");
        Aggregate effect = aggregate(SourceType.EFFECT, "s", "e", "{}");
        Aggregate trigger = aggregate(SourceType.TRIGGER, "s", "t", "{}");
        Aggregate unrelated = aggregate(SourceType.EFFECT, "s", "other", "{}");
        List<Aggregate> aggregates = List.of(formula, effect, trigger, unrelated);
        List<Reference> refs = List.of(
            ref(SourceType.FORMULA, "f", TargetType.PARAMETER, "p", ""),
            ref(SourceType.EFFECT, "e", TargetType.FORMULA, "f", ""),
            ref(SourceType.TRIGGER, "t", TargetType.RESULT, "e", "damage")
        );
        Map<Row, JsonNode> beforeRows = Map.of(row("PARAMETER", "s", "p"), json("{" + "\"value\":1}"));
        Map<Row, JsonNode> afterRows = Map.of(row("PARAMETER", "s", "p"), json("{" + "\"value\":2}"));

        Changes changes = ConfigurationChangeScope.compare(
            snapshot(beforeRows, aggregates, refs), snapshot(afterRows, aggregates, refs));
        assertEquals(Set.of(), changes.changed());
        assertEquals(Set.of(source(SourceType.FORMULA, "f"), source(SourceType.EFFECT, "e"),
            source(SourceType.TRIGGER, "t")), changes.affected());
        assertEquals(List.of(refs.getFirst()), changes.existingToCheck());
        assertFalse(changes.affected().contains(source(SourceType.EFFECT, "other")));
    }

    @Test
    void changedEffectRechecksLifecycleAndResultUsers() {
        Aggregate effectBefore = aggregate(SourceType.EFFECT, "s", "e", "{" + "\"results\":[]}");
        Aggregate effectAfter = aggregate(SourceType.EFFECT, "s", "e", "{" + "\"results\":[{" + "\"resultKey\":\"damage\"}]}");
        Aggregate lifecycleRule = aggregate(SourceType.TRIGGER, "s", "lifecycle_rule", "{}");
        Aggregate resultRule = aggregate(SourceType.TRIGGER, "s", "result_rule", "{}");
        Aggregate otherRule = aggregate(SourceType.TRIGGER, "s", "other_rule", "{}");
        List<Reference> refs = List.of(
            ref(SourceType.TRIGGER, "lifecycle_rule", TargetType.LIFECYCLE, "e", ""),
            ref(SourceType.TRIGGER, "result_rule", TargetType.RESULT, "e", "damage")
        );
        Changes changes = ConfigurationChangeScope.compare(
            snapshot(Map.of(row("EFFECT", "s", "e"), effectBefore.data()),
                List.of(effectBefore, lifecycleRule, resultRule, otherRule), refs),
            snapshot(Map.of(row("EFFECT", "s", "e"), effectAfter.data()),
                List.of(effectAfter, lifecycleRule, resultRule, otherRule), refs));
        assertEquals(Set.of(source(SourceType.EFFECT, "e")), changes.changed());
        assertTrue(changes.affected().containsAll(Set.of(
            source(SourceType.TRIGGER, "lifecycle_rule"), source(SourceType.TRIGGER, "result_rule"))));
        assertEquals(refs, changes.existingToCheck());
        assertFalse(changes.affected().contains(source(SourceType.TRIGGER, "other_rule")));
    }

    @Test
    void deletingTargetAndRewritingItsOldSourceDoesNotTreatOldEdgeAsRemaining() {
        Aggregate formula = aggregate(SourceType.FORMULA, "s", "old_formula", "{}");
        Aggregate effectBefore = aggregate(SourceType.EFFECT, "s", "damage", "{" + "\"formulaKey\":\"old_formula\"}");
        Aggregate effectAfter = aggregate(SourceType.EFFECT, "s", "damage", "{" + "\"formulaKey\":\"new_formula\"}");
        Reference oldEdge = ref(SourceType.EFFECT, "damage", TargetType.FORMULA, "old_formula", "");
        Map<Row, JsonNode> beforeRows = Map.of(
            row("FORMULA", "s", "old_formula"), formula.data(),
            row("EFFECT", "s", "damage"), effectBefore.data());
        Map<Row, JsonNode> afterRows = Map.of(row("EFFECT", "s", "damage"), effectAfter.data());
        Changes changes = ConfigurationChangeScope.compare(
            snapshot(beforeRows, List.of(formula, effectBefore), List.of(oldEdge)),
            snapshot(afterRows, List.of(effectAfter), List.of()));
        assertEquals(Set.of(source(SourceType.FORMULA, "old_formula"),
            source(SourceType.EFFECT, "damage")), changes.changed());
        assertEquals(List.of(), changes.existingToCheck());

        Changes stillUsed = ConfigurationChangeScope.compare(
            snapshot(beforeRows, List.of(formula, effectBefore), List.of(oldEdge)),
            snapshot(Map.of(row("EFFECT", "s", "damage"), effectBefore.data()),
                List.of(effectBefore), List.of(oldEdge)));
        assertEquals(List.of(oldEdge), stillUsed.existingToCheck());
    }

    @Test
    void oncePerUseChangeSelectsOnlyOldAndNewGroupsWithinSameSkill() {
        Aggregate movingBefore = rule("s", "moving", "old");
        Aggregate movingAfter = rule("s", "moving", "new");
        Aggregate oldPeer = rule("s", "old_peer", "old");
        Aggregate newPeer = rule("s", "new_peer", "new");
        Aggregate unrelated = rule("s", "unrelated", "third");
        Aggregate otherSkill = rule("other_skill", "same_name", "old");
        Changes changes = ConfigurationChangeScope.compare(
            snapshot(Map.of(row("TRIGGER", "s", "moving"), movingBefore.data()),
                List.of(movingBefore, oldPeer, newPeer, unrelated, otherSkill), List.of()),
            snapshot(Map.of(row("TRIGGER", "s", "moving"), movingAfter.data()),
                List.of(movingAfter, oldPeer, newPeer, unrelated, otherSkill), List.of()));
        assertEquals(Set.of(source(SourceType.TRIGGER, "moving")), changes.changed());
        assertEquals(Set.of(source(SourceType.TRIGGER, "moving"), source(SourceType.TRIGGER, "old_peer"),
            source(SourceType.TRIGGER, "new_peer")), changes.affected());
    }

    @Test
    void vampExpansionRequiresRelevantRuleAttributeOrCategoryAndOnlyDamageEffects() {
        Aggregate damageS = aggregate(SourceType.EFFECT, "s", "damage_s",
            "{" + "\"results\":[{" + "\"resultType\":\"DAMAGE\"}]}");
        Aggregate damageOther = aggregate(SourceType.EFFECT, "other", "damage_other",
            "{" + "\"results\":[{" + "\"resultType\":\"DAMAGE\"}]}");
        Aggregate heal = aggregate(SourceType.EFFECT, "s", "heal",
            "{" + "\"results\":[{" + "\"resultType\":\"DIRECT_HEAL\"}]}");
        List<Aggregate> aggregates = List.of(damageS, damageOther, heal);
        Row vamp = row("VAMP_RULE", "", "rule");
        Row attack = row("ATTRIBUTE", "", "attack");
        Row unused = row("ATTRIBUTE", "", "unused");
        Row spell = row("CATEGORY", "", "spell");
        JsonNode rule = json("{" + "\"source_attribute_key\":\"attack\",\"skill_category_keys\":[\"spell\"]}");
        Map<Row, JsonNode> baseline = Map.of(vamp, rule, attack, json("{" + "\"v\":1}"),
            unused, json("{" + "\"v\":1}"), spell, json("{" + "\"v\":1}"));

        Changes irrelevant = ConfigurationChangeScope.compare(snapshot(baseline, aggregates, List.of()),
            snapshot(replace(baseline, unused, json("{" + "\"v\":2}")), aggregates, List.of()));
        assertFalse(irrelevant.vampRulesChanged());
        assertTrue(irrelevant.affected().isEmpty());

        for (Row dependency : List.of(vamp, attack, spell)) {
            Changes relevant = ConfigurationChangeScope.compare(snapshot(baseline, aggregates, List.of()),
                snapshot(replace(baseline, dependency, json("{" + "\"v\":2}")), aggregates, List.of()));
            assertTrue(relevant.vampRulesChanged(), dependency.toString());
            assertEquals(Set.of(source(SourceType.EFFECT, "s", "damage_s"),
                source(SourceType.EFFECT, "other", "damage_other")), relevant.affected());
        }

        Row skillCategories = row("SKILL_CATEGORIES", "s", "");
        Changes reclassified = ConfigurationChangeScope.compare(
            snapshot(Map.of(skillCategories, json("[\"spell\"]")), aggregates, List.of()),
            snapshot(Map.of(skillCategories, json("[]")), aggregates, List.of()));
        assertFalse(reclassified.vampRulesChanged());
        assertEquals(Set.of(source(SourceType.EFFECT, "s", "damage_s")), reclassified.affected());
    }

    private static Snapshot snapshot(Map<Row, JsonNode> rows, List<Aggregate> aggregates, List<Reference> refs) {
        return new Snapshot(rows, aggregates, refs);
    }

    private static Map<Row, JsonNode> replace(Map<Row, JsonNode> source, Row row, JsonNode value) {
        Map<Row, JsonNode> result = new LinkedHashMap<>(source);
        result.put(row, value);
        return result;
    }

    private static Row row(String type, String skill, String key) {
        return new Row(type, skill, key);
    }

    private static Source source(SourceType type, String key) {
        return source(type, "s", key);
    }

    private static Source source(SourceType type, String skill, String key) {
        return new Source(type, skill, key);
    }

    private static Aggregate aggregate(SourceType type, String skill, String key, String data) {
        return new Aggregate(type, skill, key, json(data));
    }

    private static Aggregate rule(String skill, String key, String group) {
        return aggregate(SourceType.TRIGGER, skill, key,
            "{\"limits\":{\"oncePerUse\":{\"groupKey\":\"" + group + "\"}}}");
    }

    private static Reference ref(SourceType sourceType, String sourceKey,
                                 TargetType targetType, String targetKey, String subKey) {
        return new Reference("lol", "s", sourceType, sourceKey, "field",
            new Target(targetType, "s", targetKey, subKey));
    }

    private static JsonNode json(String value) {
        return AggregateJson.tree(value);
    }
}
