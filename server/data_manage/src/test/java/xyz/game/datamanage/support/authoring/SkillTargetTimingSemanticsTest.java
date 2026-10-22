package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;
import static xyz.game.datamanage.support.authoring.TargetTimingAuthoringFixture.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateCounterDetail;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateTargetTiming;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

class SkillTargetTimingSemanticsTest {
    @Test void strictDtoRoundTripsBothBranchesAndOmittedDeclaration() {
        ObjectNode config = configuration();
        for (String key : List.of("slot_1", "pending", "count")) {
            var detail = find(config, "internalStates", "stateKey", key).path("detail");
            var decoded = AggregateJson.read(detail.toString(), SkillInternalStateCounterDetail.class);
            assertEquals(AggregateJson.tree(detail.toString()), AggregateJson.tree(AggregateJson.write(decoded)));
        }
        assertInstanceOf(SkillInternalStateTargetTiming.PhasedTick.class,
            AggregateJson.read(find(config, "internalStates", "stateKey", "slot_1").path("detail").toString(), SkillInternalStateCounterDetail.class).targetTiming());
    }

    @ParameterizedTest @ValueSource(strings = {"NULL", "UNKNOWN_KIND", "UNKNOWN_KEY", "MISSING_PROCESS", "BAD_PROCESS", "NO_INTERVAL", "NULL_INTERVAL", "WRONG_PHASE", "EXTRA_PHASE", "KIND_NUMBER"})
    void strictJacksonRejectsMalformedUnionBeforeAnyWrite(String change) {
        ObjectNode detail = (ObjectNode) find(configuration(), "internalStates", "stateKey", "slot_1").path("detail");
        ObjectNode timing = (ObjectNode) detail.path("targetTiming");
        switch (change) {
            case "NULL" -> detail.putNull("targetTiming");
            case "UNKNOWN_KIND" -> timing.put("kind", "AUTO");
            case "UNKNOWN_KEY" -> timing.put("callback", "guess");
            case "MISSING_PROCESS" -> timing.remove("processKey");
            case "BAD_PROCESS" -> timing.put("processKey", "bad key");
            case "NO_INTERVAL" -> timing.remove("intervalValue");
            case "NULL_INTERVAL" -> timing.putNull("intervalValue");
            case "WRONG_PHASE" -> timing.put("phasePolicy", "RESTART");
            case "EXTRA_PHASE" -> timing.put("kind", "EXPIRY_PAYLOAD");
            case "KIND_NUMBER" -> timing.put("kind", 1);
            default -> throw new IllegalArgumentException(change);
        }
        assertThrows(RuntimeException.class, () -> AggregateJson.read(detail.toString(), SkillInternalStateCounterDetail.class));
    }

    @Test void completeThreeAnchorGraphAndExactDependencyPathsAreAccepted() {
        var all = aggregates(configuration());
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(all, List.of()));
        assertDoesNotThrow(() -> SkillNumericSemantics.validateTargetTiming(all, all, List.of()));
        var references = SkillObjectReferences.extract("scenario", all);
        assertEquals(4, references.stream().filter(r -> r.fieldPath().equals("detail.targetTiming.processKey")).count());
        assertEquals(Set.of("pulse", "burst"), references.stream().filter(r -> r.fieldPath().equals("detail.targetTiming.processKey"))
            .map(r -> r.target().key()).collect(java.util.stream.Collectors.toSet()));
    }

    @ParameterizedTest @ValueSource(strings = {"three_phase_detonation", "single_terminal_tick", "preserve_two_phases",
        "kill_mana_zero", "kill_mana_capacity", "expiry_reapply_first_tick"})
    void exactWebMechanismAuthorJsonPassesTheSameBackendGraphAndNumericEntrypoints(String name) throws Exception {
        Path path = Path.of("../../web/tests/mechanisms/cases/target_timing_" + name + ".json");
        if (!Files.exists(path)) path = Path.of("web/tests/mechanisms/cases/target_timing_" + name + ".json");
        var snapshot = AggregateJson.tree(Files.readString(path)).path("snapshot");
        var all = new ArrayList<Aggregate>();
        var parameters = new ArrayList<SkillNumericSemantics.Parameter>();
        ObjectNode timing = null;
        for (var config : snapshot.path("skillConfigurations")) {
            String skill = config.path("skill").path("skillKey").asText();
            all.addAll(aggregates(skill, (ObjectNode) config));
            for (var p : config.path("parameters")) parameters.add(new SkillNumericSemantics.Parameter(skill, p.path("parameterKey").asText(),
                p.path("valueType").asText(), p.path("valueMode").asText(), p.hasNonNull("fixedValue") ? p.path("fixedValue").decimalValue() : null,
                p.hasNonNull("levelValues") ? p.path("levelValues") : null));
            if (SkillTargetTimingSemantics.declared(config)) timing = (ObjectNode) config;
        }
        assertNotNull(timing, "固定作者图必须包含显式目标时序声明");
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(all, parameters));
        assertDoesNotThrow(() -> SkillNumericSemantics.validateTargetTiming(all, all, parameters));
        assertDoesNotThrow(() -> SkillQualifiedReferenceSemantics.validate(all, all));
        assertDoesNotThrow(() -> SkillCastingPhaseSemantics.validate(all, all));
    }

    @ParameterizedTest @ValueSource(strings = {"WRITE_STEP_COMPLETE", "WRITE_PROCESS_WITH_STEP", "TAIL_STEP_COMPLETE", "TAIL_PROCESS_WITH_STEP"})
    void expiryOnlyAcceptsProcessCompleteWithoutAStepAndDoesNotSupportOldStepComplete(String change) {
        ObjectNode config = configuration();
        ObjectNode moment = change.startsWith("WRITE")
            ? (ObjectNode) find(config, "processes", "processKey", "burst").path("stateOperations").get(4).path("moment")
            : (ObjectNode) find(config, "triggerRules", "ruleKey", "alive_tail").path("eventSource").path("detail").path("moment");
        if (change.endsWith("STEP_COMPLETE")) moment.put("momentType", "STEP_COMPLETE");
        moment.put("stepKey", "instant");
        var all = aggregates(config);
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(all, List.of()));
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validateTargetTiming(all, all, List.of()));
    }

    @ParameterizedTest @ValueSource(strings = {"slot_1", "pending"})
    void beforeDamageCannotReadAPhaseOrReservationAnchorThroughAnyPublicGraphEntrypoint(String key) {
        ObjectNode config = configuration();
        ((ObjectNode) find(config, "triggerRules", "ruleKey", "refund").path("conditionGroups").get(0).path("conditions").get(0).path("detail")).put("stateKey", key);
        var all = aggregates(config);
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(all, List.of()));
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validateTargetTiming(all, all, List.of()));
        assertThrows(ApiException.class, () -> SkillQualifiedReferenceSemantics.validate(all, all));
    }

    @Test void ordinaryHitReferencesAreValidatedAlongsideTimingDeclarationsBeforeDormancy() {
        ObjectNode config = configuration();
        ((ObjectNode) find(config, "triggerRules", "ruleKey", "apply_hit").path("actions").get(0).path("detail"))
            .put("processKey", "missing_process");
        var all = aggregates(config);
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validateTargetTiming(all, all, List.of()));
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(all, List.of()));
    }

    @ParameterizedTest @ValueSource(strings = {"slot_1", "pending"})
    void legacyEnsureCannotAlterAPhaseOrReservationThroughWriteOrSnapshotEntrypoints(String key) {
        ObjectNode config = configuration(), hit = find(config, "triggerRules", "ruleKey", "apply_hit");
        ObjectNode action = (ObjectNode) hit.path("actions").get(1).deepCopy();
        ((ObjectNode) action.path("detail")).put("operation", "ENSURE_REMAINING").put("stateKey", key);
        hit.putArray("actions").add(action); hit.putArray("conditionGroups");
        hit.set("eventSource", node("{\"eventType\":\"SKILL_USED\",\"detail\":{\"sourceSkillKey\":\"actual_active\",\"useKind\":\"ACTIVE\",\"castPhase\":\"INITIAL\"}}"));
        var all = aggregates(config);
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(all, List.of()));
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validateTargetTiming(all, all, List.of()));
        assertThrows(ApiException.class, () -> SkillQualifiedReferenceSemantics.validate(all, all));
    }

    @ParameterizedTest @ValueSource(strings = {"SKILL_SCOPE", "BOUND_INITIAL", "INITIAL_ONE", "MAX_TWO", "DURATION_ZERO", "FRACTION_INTERVAL", "UNSAFE_INTERVAL", "FOUR_ANCHORS", "SECOND_EXPIRY", "MISSING_PROCESS", "ACTIVE_PROCESS", "DELAY", "OCCUPIES", "SECOND_DAMAGE", "TICK_STATE_WRITE", "TICK_TAIL", "TICK_RESTORE", "TICK_CRIT", "UNRESOLVED", "WRONG_STATE_OWNER", "EXPIRY_REARMS_SELF", "EXPIRY_FOREIGN_WRITE", "EXPIRY_DYNAMIC_WRITE", "EXPIRY_OVER_CAP", "EXPIRY_EXTRA_RESTORE", "RECURSIVE_CHILD", "WRONG_ALIVE", "DUPLICATE_ORDER"})
    void finalGraphRejectsInvalidFieldBodyOrExpiryClosure(String change) {
        ObjectNode config = configuration();
        ObjectNode state = find(config, "internalStates", "stateKey", "slot_1"), detail = (ObjectNode) state.path("detail"), timing = (ObjectNode) detail.path("targetTiming");
        ObjectNode pulse = find(config, "processes", "processKey", "pulse"), burst = find(config, "processes", "processKey", "burst");
        ObjectNode damage = (ObjectNode) find(config, "effects", "effectKey", "pulse_damage").path("results").get(0);
        switch (change) {
            case "SKILL_SCOPE" -> state.put("scope", "SKILL");
            case "BOUND_INITIAL" -> detail.putNull("initialValueBinding");
            case "INITIAL_ONE" -> detail.set("initialValue", fixed(1));
            case "MAX_TWO" -> detail.set("maxValue", fixed(2));
            case "DURATION_ZERO" -> detail.set("durationValue", fixed(0));
            case "FRACTION_INTERVAL" -> timing.set("intervalValue", fixed(0.5));
            case "UNSAFE_INTERVAL" -> timing.set("intervalValue", fixed(9007199254740992L));
            case "FOUR_ANCHORS" -> config.withArray("internalStates").add(state.deepCopy().put("stateKey", "slot_4"));
            case "SECOND_EXPIRY" -> config.withArray("internalStates").add(find(config, "internalStates", "stateKey", "pending").deepCopy().put("stateKey", "other_pending"));
            case "MISSING_PROCESS" -> timing.put("processKey", "absent");
            case "ACTIVE_PROCESS" -> pulse.put("activationType", "ACTIVE");
            case "DELAY" -> ((ObjectNode) pulse.path("steps").get(0)).put("stepType", "DELAY");
            case "OCCUPIES" -> ((ObjectNode) pulse.path("steps").get(0)).put("occupiesAction", true);
            case "SECOND_DAMAGE" -> pulse.withArray("effectBindings").add(pulse.path("effectBindings").get(0).deepCopy());
            case "TICK_STATE_WRITE" -> pulse.withArray("stateOperations").add(burst.path("stateOperations").get(0).deepCopy());
            case "TICK_TAIL" -> ((ObjectNode) find(config, "triggerRules", "ruleKey", "alive_tail").path("eventSource").path("detail")).put("processKey", "pulse");
            case "TICK_RESTORE" -> damage.put("resultType", "RESOURCE_CHANGE");
            case "TICK_CRIT" -> ((ObjectNode) damage.path("detail").path("critical")).put("mode", "ALLOWED");
            case "UNRESOLVED" -> ((ObjectNode) damage.path("detail")).put("vampQualification", "UNRESOLVED");
            case "WRONG_STATE_OWNER" -> ((ObjectNode) find(config, "processes", "processKey", "apply").path("stateOperations").get(0)).put("stateSkillKey", "another");
            case "EXPIRY_REARMS_SELF" -> { ObjectNode op = (ObjectNode) burst.path("stateOperations").get(0); op.put("stateKey", "pending"); op.set("value", fixed(1)); }
            case "EXPIRY_FOREIGN_WRITE" -> ((ObjectNode) burst.path("stateOperations").get(0)).put("stateSkillKey", "another");
            case "EXPIRY_DYNAMIC_WRITE" -> ((ObjectNode) burst.path("stateOperations").get(0)).set("value", node("{\"kind\":\"PARAMETER\",\"parameterKey\":\"unknown\"}"));
            case "EXPIRY_OVER_CAP" -> ((ObjectNode) burst.path("stateOperations").get(0)).set("value", fixed(2));
            case "EXPIRY_EXTRA_RESTORE" -> burst.withArray("effectBindings").add(node("{\"bindingKey\":\"extra\",\"effectKey\":\"mana\"}"));
            case "RECURSIVE_CHILD" -> ((ObjectNode) find(config, "triggerRules", "ruleKey", "alive_tail").path("actions").get(0).path("detail")).put("processKey", "burst");
            case "WRONG_ALIVE" -> ((ObjectNode) find(config, "triggerRules", "ruleKey", "alive_tail").path("conditionGroups").get(0).path("conditions").get(0).path("detail")).put("attributeKey", "mana");
            case "DUPLICATE_ORDER" -> ((ObjectNode) burst.path("stateOperations").get(1)).put("sortOrder", 1);
            default -> throw new IllegalArgumentException(change);
        }
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(aggregates(config), List.of()));
    }

    @ParameterizedTest @ValueSource(strings = {"MISSING_GUARD", "OR_BYPASS", "WRONG_EVENT", "NULL_SOURCE", "ORDINARY_FIELD", "OLD_ENSURE", "ZERO_AMOUNT", "WRONG_TARGET", "FOREIGN_COUNTER", "READER_WRONG_EVENT", "READER_SCOPE", "READER_FRACTION"})
    void newActionAndDamageReaderCannotBorrowOtherAuthorization(String change) {
        ObjectNode config = configuration(), rule = find(config, "triggerRules", "ruleKey", "apply_hit"), action = (ObjectNode) rule.path("actions").get(1);
        ObjectNode refund = find(config, "triggerRules", "ruleKey", "refund"), before = (ObjectNode) refund.path("conditionGroups").get(0).path("conditions").get(0).path("detail");
        switch (change) {
            case "MISSING_GUARD" -> rule.putArray("conditionGroups");
            case "OR_BYPASS" -> rule.withArray("conditionGroups").add(node("{\"groupKey\":\"bypass\",\"conditions\":[]}"));
            case "WRONG_EVENT" -> ((ObjectNode) rule.path("eventSource")).put("eventType", "BASIC_ATTACK_HIT");
            case "NULL_SOURCE" -> ((ObjectNode) rule.path("eventSource").path("detail")).putNull("sourceSkillKey");
            case "ORDINARY_FIELD" -> ((ObjectNode) action.path("detail")).put("stateKey", "count");
            case "OLD_ENSURE" -> { ((ObjectNode) action.path("detail")).put("operation", "ENSURE_REMAINING"); ((ObjectNode) rule.path("eventSource")).put("eventType", "SKILL_USED"); ((ObjectNode) rule.path("eventSource").path("detail")).put("useKind", "ACTIVE").put("castPhase", "INITIAL"); }
            case "ZERO_AMOUNT" -> ((ObjectNode) action.path("detail")).set("value", fixed(0));
            case "WRONG_TARGET" -> action.put("targetContext", "EVENT_SOURCE");
            case "FOREIGN_COUNTER" -> before.put("stateSkillKey", "another");
            case "READER_WRONG_EVENT" -> ((ObjectNode) refund.path("eventSource")).put("eventType", "DAMAGE_TAKEN");
            case "READER_SCOPE" -> find(config, "internalStates", "stateKey", "count").put("scope", "SKILL");
            case "READER_FRACTION" -> before.set("comparisonValue", fixed(0.5));
            default -> throw new IllegalArgumentException(change);
        }
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(aggregates(config), List.of()));
    }

    @Test void allLevelsAndHiddenRuntimeDependenciesAreProvedForNewInterval() {
        ObjectNode config = configuration();
        ((ObjectNode) find(config, "internalStates", "stateKey", "slot_1").path("detail").path("targetTiming")).set("intervalValue", node("{\"kind\":\"PARAMETER\",\"parameterKey\":\"period\"}"));
        var good = new SkillNumericSemantics.Parameter(OWNER, "period", "INTEGER", "CHARACTER_LEVEL", null, node("{\"1\":250,\"18\":300}"));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(aggregates(config), List.of(good)));
        var bad = new SkillNumericSemantics.Parameter(OWNER, "period", "INTEGER", "CHARACTER_LEVEL", null, node("{\"1\":250,\"18\":0}"));
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(aggregates(config), List.of(bad)));
        var runtime = new SkillNumericSemantics.Parameter(OWNER, "period", "INTEGER", "RUNTIME_INPUT", null, null);
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(aggregates(config), List.of(runtime)));
    }

    @Test void laterSingleProcessEditAndDeletedReferenceAreRecheckedAgainstWholeContext() {
        ObjectNode config = configuration(); var all = aggregates(config);
        Aggregate pulse = all.stream().filter(a -> a.type() == SourceType.PROCESS && a.key().equals("pulse")).findFirst().orElseThrow();
        ((ObjectNode) pulse.data()).withArray("stateOperations").add(find(config, "processes", "processKey", "burst").path("stateOperations").get(0).deepCopy());
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(pulse), all, List.of(), java.util.Map.of(), java.util.Map.of(), java.util.Map.of()));
        var missing = new ArrayList<>(aggregates(configuration())); missing.removeIf(a -> a.type() == SourceType.PROCESS && a.key().equals("pulse"));
        assertThrows(ApiException.class, () -> SkillObjectReferences.extractAndValidate("scenario", missing, Set.of()));
    }

    @ParameterizedTest @ValueSource(strings = {"INTERVAL_ATTRIBUTE", "INTERVAL_RUNTIME", "AMOUNT_ATTRIBUTE", "AMOUNT_RUNTIME"})
    void anUnselectedFormulaBranchCannotHideDynamicTimingValues(String change) {
        ObjectNode config = configuration();
        ObjectNode binding = change.endsWith("ATTRIBUTE") ? node("{\"kind\":\"attribute\",\"object\":\"source\",\"attributeKey\":\"ability_power\",\"valueKind\":\"TOTAL\",\"view\":\"current_frame\"}")
            : node("{\"kind\":\"parameter\",\"skillKey\":\"mark_owner\",\"parameterKey\":\"hidden\"}");
        ObjectNode formula = formula("hidden", binding);
        ((ObjectNode) formula.path("expression").path("stages").get(0)).set("expression", node("{\"op\":\"if\",\"args\":[{\"op\":\"const\",\"value\":\"1\"},{\"op\":\"const\",\"value\":\"250\"},{\"op\":\"read\",\"inputKey\":\"dynamic\"}]}"));
        config.withArray("formulas").add(formula);
        if (change.startsWith("INTERVAL")) ((ObjectNode) find(config, "internalStates", "stateKey", "slot_1").path("detail").path("targetTiming")).set("intervalValue", node("{\"kind\":\"FORMULA\",\"formulaKey\":\"hidden\"}"));
        else ((ObjectNode) find(config, "triggerRules", "ruleKey", "apply_hit").path("actions").get(1).path("detail")).set("value", node("{\"kind\":\"FORMULA\",\"formulaKey\":\"hidden\"}"));
        var parameter = new SkillNumericSemantics.Parameter(OWNER, "hidden", "INTEGER", "RUNTIME_INPUT", null, null);
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(aggregates(config), List.of(parameter)));
    }

    @ParameterizedTest @ValueSource(strings = {"TICK_MAX", "EXPIRY_AP", "TICK_AP", "TICK_TOTAL", "CONTEXT"})
    void damageFormulasReadOnlyThePermittedCurrentFrameAttributes(String change) {
        ObjectNode config = configuration();
        ObjectNode binding = change.equals("CONTEXT") ? node("{\"kind\":\"context\",\"contextKey\":\"effect_elapsed_ms\"}")
            : change.endsWith("AP") ? node("{\"kind\":\"attribute\",\"object\":\"source\",\"attributeKey\":\"ability_power\",\"valueKind\":\"TOTAL\",\"view\":\"current_frame\"}")
            : node("{\"kind\":\"attribute\",\"object\":\"target\",\"attributeKey\":\"hp\",\"valueKind\":\"" + (change.equals("TICK_TOTAL") ? "TOTAL" : "MAX") + "\",\"view\":\"current_frame\"}");
        config.withArray("formulas").add(formula("current", binding));
        ObjectNode valueRule = (ObjectNode) find(config, "effects", "effectKey", change.equals("EXPIRY_AP") ? "burst_damage" : "pulse_damage").path("results").get(0).path("valueRule");
        valueRule.set("value", node("{\"kind\":\"FORMULA\",\"formulaKey\":\"current\"}"));
        if (Set.of("TICK_MAX", "EXPIRY_AP").contains(change)) assertDoesNotThrow(() -> SkillNumericSemantics.validate(aggregates(config), List.of()));
        else assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(aggregates(config), List.of()));
    }

    @Test void expiryPayloadAcceptsTwelveLeavesAndRejectsThirteenWithoutIncreasingTheBudget() {
        ObjectNode config = configuration(), burst = find(config, "processes", "processKey", "burst");
        for (int i = 0; i < 4; i++) burst.withArray("stateOperations").add(((ObjectNode) burst.path("stateOperations").get(0)).deepCopy().put("operationKey", "extra_" + i).put("sortOrder", 20 + i));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(aggregates(config), List.of()));
        burst.withArray("stateOperations").add(((ObjectNode) burst.path("stateOperations").get(0)).deepCopy().put("operationKey", "thirteenth").put("sortOrder", 99));
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(aggregates(config), List.of()));
    }

    @Test void anExternalProcessCannotBecomeAWriterOfTheNewOwnedTimingState() {
        var all = new ArrayList<>(aggregates(configuration()));
        Aggregate own = all.stream().filter(a -> a.type() == SourceType.PROCESS && a.key().equals("apply")).findFirst().orElseThrow();
        Aggregate foreign = new Aggregate(SourceType.PROCESS, "foreign", "apply", own.data().deepCopy()); all.add(foreign);
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(foreign), all, List.of(), java.util.Map.of(), java.util.Map.of(), java.util.Map.of()));
    }

    private static ObjectNode formula(String key, ObjectNode binding) {
        ObjectNode formula = node("{\"expression\":{\"inputs\":[{\"key\":\"dynamic\"}],\"stages\":[{\"key\":\"out\",\"name\":\"数值\",\"expression\":{\"op\":\"read\",\"inputKey\":\"dynamic\"}}],\"outputStageKey\":\"out\"}}");
        formula.put("formulaKey", key); ((ObjectNode) formula.path("expression").path("inputs").get(0)).set("binding", binding); return formula;
    }

    @Test void dormancyQualifiersUseAllLevelStaticProofAndDoNotHideAnIndependentRoot() {
        ObjectNode config = configuration();
        ObjectNode killed = (ObjectNode) find(config, "triggerRules", "ruleKey", "refund").path("conditionGroups").get(0).path("conditions").get(1).path("detail");
        killed.set("comparisonValue", node("{\"kind\":\"PARAMETER\",\"parameterKey\":\"one\"}"));
        var good = new SkillNumericSemantics.Parameter(OWNER, "one", "INTEGER", "CHARACTER_LEVEL", null, node("{\"1\":1,\"18\":1}"));
        assertTrue(SkillNumericSemantics.targetTimingNaturalRootsOnly(OWNER, config, aggregates(config), List.of(good)));
        var zeroLevel = new SkillNumericSemantics.Parameter(OWNER, "one", "INTEGER", "CHARACTER_LEVEL", null, node("{\"1\":1,\"18\":0}"));
        assertFalse(SkillNumericSemantics.targetTimingNaturalRootsOnly(OWNER, config, aggregates(config), List.of(zeroLevel)));
    }

    @ParameterizedTest @ValueSource(strings = {"OWN", "DECLARED_HIT", "BASIC_ATTACK", "OTHER_SKILL", "ANY_DELIVERY", "ANY_ORIGIN"})
    void zeroBeforeKillIsDeferredOnlyForTheOwnersActualDeclaredDirectSkillDamage(String change) {
        ObjectNode config = configuration(), rule = find(config, "triggerRules", "ruleKey", "refund");
        ObjectNode source = (ObjectNode) rule.path("eventSource").path("detail");
        source.put("sourceSkillKey", change.equals("OWN") ? OWNER : DRIVER).put("deliveryKind", "SKILL").put("originKind", "DIRECT");
        ((ObjectNode) rule.path("conditionGroups").get(0).path("conditions").get(0).path("detail")).put("comparator", "EQ");
        switch (change) {
            case "BASIC_ATTACK" -> source.put("sourceSkillKey", "ordinary_attack");
            case "OTHER_SKILL" -> source.put("sourceSkillKey", "unrelated_active");
            case "ANY_DELIVERY" -> source.put("deliveryKind", "ANY");
            case "ANY_ORIGIN" -> source.put("originKind", "ANY");
            default -> { }
        }
        assertEquals(Set.of("OWN", "DECLARED_HIT").contains(change),
            SkillNumericSemantics.targetTimingNaturalRootsOnly(OWNER, config, aggregates(config), List.of()));
    }
}
