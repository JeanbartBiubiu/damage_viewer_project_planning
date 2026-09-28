package xyz.game.datamanage.service.skilleffect;

import xyz.game.datamanage.model.value.SkillNumericValue;

import java.util.Comparator;
import java.util.List;
import xyz.game.datamanage.model.skilleffect.*;
import xyz.game.datamanage.support.authoring.AggregateJson;

/** 保存既有接口形状；结果按显式排序，范围列表保留存储顺序。 */
final class SkillEffectAggregate {
    private SkillEffectAggregate() {}

    static List<SkillEffectResultRequest> readResults(String json) {
        if (json == null) throw new IllegalStateException("效果结果不能为空");
        return AggregateJson.readList(json, SkillEffectResultRequest.class).stream()
            .sorted(Comparator.comparing(SkillEffectResultRequest::sortOrder)
                .thenComparing(SkillEffectResultRequest::resultKey)).toList();
    }

    static String writeResults(List<SkillEffectResultRequest> results) {
        return AggregateJson.write(results.stream()
            .sorted(Comparator.comparing(SkillEffectResultRequest::sortOrder)
                .thenComparing(SkillEffectResultRequest::resultKey))
            .map(SkillEffectAggregate::resultResponse).toList());
    }

    static SkillEffectResultResponse resultResponse(SkillEffectResultRequest result) {
        SkillEffectValueRuleRequest value = result.valueRule();
        SkillEffectResultLifecycleBehaviorRequest behavior = result.lifecycleBehavior();
        SkillEffectResultDetail detail = result.detail();
        if (detail instanceof SkillEffectDamageDetail damage) {
            detail = new SkillEffectDamageDetail(damage.damageTypeKey(), damage.deliveryKind(), damage.originKind(),
                damage.critical(), damage.vampQualification(), damage.vampOverrides().stream()
                    .sorted(Comparator.comparing(SkillEffectVampOverride::vampType)).toList());
        }
        return new SkillEffectResultResponse(
            result.resultKey(), result.name(), result.resultType(), result.target(), result.description(), result.sortOrder(),
            value == null ? null : new SkillEffectValueRuleResponse(value.value(), value.fixedMultiplier(),
                value.fixedMinValue(), value.fixedMaxValue()), detail,
            behavior == null ? null : new SkillEffectResultLifecycleBehaviorResponse(behavior.moment(),
                behavior.valueReadMode(), behavior.stackValueMode(), behavior.reapplicationValueMode(), behavior.periodicExecutionMode()),
            result.spellShieldBlockScope()
        );
    }

    static SkillEffectLifecycleResponse lifecycleResponse(SkillEffectLifecycleRequest lifecycle) {
        return lifecycle == null ? null : new SkillEffectLifecycleResponse(lifecycle.durationValue(),
            lifecycle.maxStacksValue(), lifecycle.applicationStacksValue(), lifecycle.instanceScope(),
            lifecycle.reapplicationStackMode(), lifecycle.reapplicationDurationMode(), lifecycle.expiryMode(),
            lifecycle.periodicIntervalValue(), lifecycle.firstPeriodicExecution(),
            lifecycle.endWhenShieldEndsResultKey());
    }

    static SkillEffectLifecycleRow lifecycleRow(SkillEffectRow effect) {
        if (effect.lifecycle() == null) return null;
        SkillEffectLifecycleRequest lifecycle = AggregateJson.read(effect.lifecycle(), SkillEffectLifecycleRequest.class);
        return new SkillEffectLifecycleRow(effect.gameId(), effect.skillKey(), effect.effectKey(), lifecycle.durationValue(),
            lifecycle.maxStacksValue(), lifecycle.applicationStacksValue(), lifecycle.instanceScope(),
            lifecycle.reapplicationStackMode(), lifecycle.reapplicationDurationMode(), lifecycle.expiryMode(),
            lifecycle.periodicIntervalValue(), lifecycle.firstPeriodicExecution());
    }
}
