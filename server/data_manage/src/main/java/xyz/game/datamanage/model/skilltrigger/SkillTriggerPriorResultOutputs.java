package xyz.game.datamanage.model.skilltrigger;

import java.util.EnumSet;
import java.util.Set;
import xyz.game.datamanage.model.skilleffect.SkillEffectCooldownChangeDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectCooldownChangeOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleMoment;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultType;
import xyz.game.datamanage.model.skilleffect.SkillEffectSpellShieldBlockScope;
import xyz.game.datamanage.model.skilleffect.SkillEffectStatusOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectStatusOperationDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectVampQualification;

public final class SkillTriggerPriorResultOutputs {

    private static final Set<SkillEffectResultType> BLOCKABLE_RESULT_TYPES = EnumSet.of(
        SkillEffectResultType.DAMAGE,
        SkillEffectResultType.ATTRIBUTE_CHANGE,
        SkillEffectResultType.RESOURCE_CHANGE,
        SkillEffectResultType.COOLDOWN_CHANGE,
        SkillEffectResultType.STATUS_OPERATION,
        SkillEffectResultType.LIFECYCLE_OPERATION,
        SkillEffectResultType.EXECUTE,
        SkillEffectResultType.HIT_LINK_APPLICATION,
        SkillEffectResultType.ATTACK_LINK_APPLICATION
    );

    private SkillTriggerPriorResultOutputs() {
    }

    public record Shape(
        SkillEffectResultType resultType,
        boolean hasValueRule,
        int vampCount,
        SkillEffectSpellShieldBlockScope spellShieldBlockScope,
        SkillEffectStatusOperation statusOperation,
        SkillEffectCooldownChangeOperation cooldownOperation,
        SkillEffectLifecycleMoment resultMoment,
        boolean hasLifecycle
    ) {
        public static Shape from(SkillTriggerEffectShapeRow row) {
            if (row == null) {
                return null;
            }
            return new Shape(
                row.resultType(),
                row.hasValueRule(),
                row.vampCount(),
                row.spellShieldBlockScope(),
                row.statusOperation(),
                row.cooldownOperation(),
                row.resultMoment(),
                row.hasLifecycle()
            );
        }

        public static Shape from(SkillEffectResultRequest result, boolean hasLifecycle) {
            if (result == null) {
                return null;
            }
            int vampCount = 0;
            SkillEffectStatusOperation statusOperation = null;
            SkillEffectCooldownChangeOperation cooldownOperation = null;
            if (result.detail() instanceof SkillEffectDamageDetail damage) {
                // 已核定伤害始终提供实际回复；不匹配或明确禁止时为零。
                vampCount = damage.vampQualification() == SkillEffectVampQualification.RESOLVED ? 1 : 0;
            } else if (result.detail() instanceof SkillEffectStatusOperationDetail status) {
                statusOperation = status.operation();
            } else if (result.detail() instanceof SkillEffectCooldownChangeDetail cooldown) {
                cooldownOperation = cooldown.operation();
            }
            SkillEffectLifecycleMoment moment = result.lifecycleBehavior() == null
                ? null
                : result.lifecycleBehavior().moment();
            return new Shape(
                result.resultType(),
                result.valueRule() != null,
                vampCount,
                result.spellShieldBlockScope(),
                statusOperation,
                cooldownOperation,
                moment,
                hasLifecycle
            );
        }
    }

    public static boolean immediatelyAvailable(Shape shape) {
        if (shape == null) {
            return false;
        }
        return !shape.hasLifecycle() || shape.resultMoment() == SkillEffectLifecycleMoment.APPLICATION;
    }

    public static Set<SkillTriggerPriorResultOutputKind> available(Shape shape) {
        if (shape == null || shape.resultType() == null) {
            return Set.of();
        }
        EnumSet<SkillTriggerPriorResultOutputKind> outputs = EnumSet.noneOf(
            SkillTriggerPriorResultOutputKind.class
        );
        if (shape.hasValueRule() && shape.cooldownOperation() != SkillEffectCooldownChangeOperation.RESET) {
            outputs.add(SkillTriggerPriorResultOutputKind.CONFIGURED_VALUE);
        }
        if (shape.resultType() == SkillEffectResultType.DAMAGE) {
            outputs.add(SkillTriggerPriorResultOutputKind.RAW_DAMAGE);
            outputs.add(SkillTriggerPriorResultOutputKind.POST_DEFENSE_DAMAGE);
            outputs.add(SkillTriggerPriorResultOutputKind.SHIELD_ABSORBED);
            outputs.add(SkillTriggerPriorResultOutputKind.ACTUAL_HP_LOSS);
            outputs.add(SkillTriggerPriorResultOutputKind.IMMUNE);
            outputs.add(SkillTriggerPriorResultOutputKind.KILLED);
            if (shape.vampCount() > 0) {
                outputs.add(SkillTriggerPriorResultOutputKind.ACTUAL_HEALING);
            }
        } else if (shape.resultType() == SkillEffectResultType.DIRECT_HEAL) {
            outputs.add(SkillTriggerPriorResultOutputKind.ACTUAL_HEALING);
        } else if (shape.resultType() == SkillEffectResultType.EXECUTE) {
            outputs.add(SkillTriggerPriorResultOutputKind.KILLED);
        }
        if (shape.resultType() == SkillEffectResultType.STATUS_OPERATION
            && shape.statusOperation() == SkillEffectStatusOperation.APPLY) {
            outputs.add(SkillTriggerPriorResultOutputKind.STATUS_APPLIED);
        }
        if (shape.spellShieldBlockScope() != null
            && BLOCKABLE_RESULT_TYPES.contains(shape.resultType())
            && shape.resultType() != SkillEffectResultType.DIRECT_HEAL
            && shape.resultType() != SkillEffectResultType.NORMAL_SHIELD) {
            outputs.add(SkillTriggerPriorResultOutputKind.BLOCKED);
        }
        return outputs;
    }

    public static boolean available(Shape shape, SkillTriggerPriorResultOutputKind outputKind) {
        return outputKind != null && available(shape).contains(outputKind);
    }

    public static SkillTriggerValueDomain valueDomain(SkillTriggerPriorResultOutputKind outputKind) {
        if (outputKind == null) {
            return null;
        }
        return switch (outputKind) {
            case BLOCKED, IMMUNE, STATUS_APPLIED, KILLED -> SkillTriggerValueDomain.INTEGER;
            case CONFIGURED_VALUE, RAW_DAMAGE, POST_DEFENSE_DAMAGE, SHIELD_ABSORBED,
                ACTUAL_HP_LOSS, ACTUAL_HEALING -> SkillTriggerValueDomain.DECIMAL;
        };
    }

    public static String unavailableField(Shape shape, SkillTriggerPriorResultOutputKind outputKind) {
        if (outputKind == null || immediatelyAvailable(shape) && available(shape, outputKind)) {
            return null;
        }
        if (!immediatelyAvailable(shape)) {
            return "lifecycleBehavior.moment";
        }
        return switch (outputKind) {
            case CONFIGURED_VALUE -> "valueRule";
            case ACTUAL_HEALING -> shape.resultType() == SkillEffectResultType.DAMAGE
                ? "detail.vampQualification"
                : "resultType";
            case BLOCKED -> "spellShieldBlockScope";
            case STATUS_APPLIED -> "detail.operation";
            default -> "resultType";
        };
    }
}
