package xyz.game.enginev2demo.trigger;

import java.util.List;
import java.util.Objects;

import xyz.game.enginev2demo.cadence.CadenceOp;
import xyz.game.enginev2demo.runtime.CounterResetMode;
import xyz.game.enginev2demo.runtime.CounterScope;

/**
 * 触发效果定义。
 */
public sealed interface EffectDef permits EffectDef.DealDamageEffect, EffectDef.GrantShieldEffect,
        EffectDef.ApplyStatusEffect, EffectDef.ApplyMarkEffect, EffectDef.ConsumeMarkEffect,
        EffectDef.ModifyCounterEffect, EffectDef.ModifyCadenceEffect {

    record DealDamageEffect(
            String actionId,
            String label,
            String damageProfileId,
            String formulaId,
            EventActorRole sourceActorRole,
            EventActorRole targetActorRole) implements EffectDef {

        public DealDamageEffect {
            Objects.requireNonNull(actionId, "actionId");
            Objects.requireNonNull(label, "label");
            Objects.requireNonNull(damageProfileId, "damageProfileId");
            Objects.requireNonNull(formulaId, "formulaId");
            Objects.requireNonNull(sourceActorRole, "sourceActorRole");
            Objects.requireNonNull(targetActorRole, "targetActorRole");
        }
    }

    record GrantShieldEffect(
            String label,
            String formulaId,
            EventActorRole sourceActorRole,
            EventActorRole targetActorRole) implements EffectDef {

        public GrantShieldEffect {
            Objects.requireNonNull(label, "label");
            Objects.requireNonNull(formulaId, "formulaId");
            Objects.requireNonNull(sourceActorRole, "sourceActorRole");
            Objects.requireNonNull(targetActorRole, "targetActorRole");
        }
    }

    record ApplyStatusEffect(
            String statusId,
            EventActorRole sourceActorRole,
            EventActorRole targetActorRole) implements EffectDef {

        public ApplyStatusEffect {
            Objects.requireNonNull(statusId, "statusId");
            Objects.requireNonNull(sourceActorRole, "sourceActorRole");
            Objects.requireNonNull(targetActorRole, "targetActorRole");
        }
    }

    record ApplyMarkEffect(
            String markId,
            long durationMs,
            boolean consumable,
            EventActorRole sourceActorRole,
            EventActorRole targetActorRole) implements EffectDef {

        public ApplyMarkEffect {
            Objects.requireNonNull(markId, "markId");
            Objects.requireNonNull(sourceActorRole, "sourceActorRole");
            Objects.requireNonNull(targetActorRole, "targetActorRole");
        }
    }

    record ConsumeMarkEffect(
            String markId,
            EventActorRole sourceActorRole,
            EventActorRole targetActorRole) implements EffectDef {

        public ConsumeMarkEffect {
            Objects.requireNonNull(markId, "markId");
            Objects.requireNonNull(sourceActorRole, "sourceActorRole");
            Objects.requireNonNull(targetActorRole, "targetActorRole");
        }
    }

    record ModifyCounterEffect(
            String counterId,
            CounterScope counterScope,
            int delta,
            int threshold,
            CounterResetMode resetMode,
            EventActorRole sourceActorRole,
            EventActorRole targetActorRole) implements EffectDef {

        public ModifyCounterEffect {
            Objects.requireNonNull(counterId, "counterId");
            Objects.requireNonNull(counterScope, "counterScope");
            Objects.requireNonNull(resetMode, "resetMode");
            Objects.requireNonNull(sourceActorRole, "sourceActorRole");
            Objects.requireNonNull(targetActorRole, "targetActorRole");
        }
    }

    /**
     * 通用节奏修改效果——命中/受击后按动作标签修改 CD 或充能。
     *
     * @param affectedActorRole  受影响的 actor（SOURCE 或 TARGET）
     * @param targetActionTags   目标动作标签列表（与动作 tags 取交集命中）
     * @param op                 节奏修改操作类型
     * @param valueFormulaId     值公式 ID（RESET_CD 可为 null）
     */
    record ModifyCadenceEffect(
            EventActorRole affectedActorRole,
            List<String> targetActionTags,
            CadenceOp op,
            String valueFormulaId) implements EffectDef {

        public ModifyCadenceEffect {
            Objects.requireNonNull(affectedActorRole, "affectedActorRole");
            Objects.requireNonNull(targetActionTags, "targetActionTags");
            Objects.requireNonNull(op, "op");
            targetActionTags = List.copyOf(targetActionTags);
            if (op != CadenceOp.RESET_CD && op != CadenceOp.GRANT_CHARGE && valueFormulaId == null) {
                throw new IllegalArgumentException("valueFormulaId required for op " + op);
            }
        }
    }
}
