package xyz.game.datamanage.service.skilleffect;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageModifierDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRequest;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.authoring.SkillObjectReferences;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.*;
import xyz.game.datamanage.support.error.ApiException;

class SkillEffectCappedDamageModifierStorageTest {
    private static final String ROW = """
        {"resultKey":"flat","name":"防御前平减","resultType":"DAMAGE_MODIFIER","target":"SOURCE","description":null,"sortOrder":0,
         "valueRule":{"value":{"kind":"FIXED","value":13},"fixedMultiplier":1,"fixedMinValue":0,"fixedMaxValue":null},
         "detail":{"modifierZoneKey":"flat_pre","direction":"TAKEN","operation":"DECREASE","damageTypeKey":"actual_type",
          "deliveryKind":"ANY","originKind":"ANY","criticalFilter":"ANY","condition":null%s},
         "lifecycleBehavior":null,"spellShieldBlockScope":null}
        """;

    @Test void aggregateWritesAndIndependentReadsPreserveTheCapAndOldRowsOmitTheField() {
        for (String declaration : List.of("", ",\"maximumReductionRatioValue\":{\"kind\":\"FIXED\",\"value\":0.5}",
            ",\"maximumReductionRatioValue\":{\"kind\":\"PARAMETER\",\"parameterKey\":\"cap\"}")) {
            String row = ROW.formatted(declaration);
            var request = AggregateJson.read(row, SkillEffectResultRequest.class);
            String stored = SkillEffectAggregate.writeResults(List.of(request));
            assertEquals(AggregateJson.tree("[" + row + "]"), AggregateJson.tree(stored));
            var reread = SkillEffectAggregate.resultResponse(SkillEffectAggregate.readResults(stored).getFirst());
            assertEquals(AggregateJson.tree(row), AggregateJson.tree(AggregateJson.write(reread)));
            assertEquals(((SkillEffectDamageModifierDetail) request.detail()).maximumReductionRatioValue(),
                ((SkillEffectDamageModifierDetail) reread.detail()).maximumReductionRatioValue());
        }
    }

    @Test void theCapParameterIsInTheExistingReferenceIndexAndCannotDisappearFromTheFinalCatalog() {
        var result = AggregateJson.tree(ROW.formatted(",\"maximumReductionRatioValue\":{\"kind\":\"PARAMETER\",\"parameterKey\":\"cap\"}"));
        var data = com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode();
        data.putArray("results").add(result);
        var aggregate = new Aggregate(SourceType.EFFECT, "skill", "defense", data);
        var refs = SkillObjectReferences.extract("game", List.of(aggregate));
        assertEquals(1, refs.stream().filter(row -> row.fieldPath().equals("results[0].detail.maximumReductionRatioValue.parameterKey")
            && row.target().equals(new Target(TargetType.PARAMETER, "skill", "cap", ""))).count());
        Set<Target> catalog = Set.of(new Target(TargetType.MODIFIER_ZONE, "", "flat_pre", ""),
            new Target(TargetType.DAMAGE_TYPE, "", "actual_type", ""));
        assertThrows(ApiException.class, () -> SkillObjectReferences.extractAndValidate("game", List.of(aggregate), List.of(aggregate), catalog));
        var withParameter = new java.util.HashSet<>(catalog); withParameter.add(new Target(TargetType.PARAMETER, "skill", "cap", ""));
        assertDoesNotThrow(() -> SkillObjectReferences.extractAndValidate("game", List.of(aggregate), List.of(aggregate), withParameter));
    }
}
