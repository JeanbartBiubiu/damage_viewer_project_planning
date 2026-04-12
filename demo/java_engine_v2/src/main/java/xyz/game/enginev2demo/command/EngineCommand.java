package xyz.game.enginev2demo.command;

import java.util.List;
import java.util.Map;
import java.util.Objects;

import xyz.game.enginev2demo.cadence.CadenceOp;
import xyz.game.enginev2demo.runtime.CounterResetMode;
import xyz.game.enginev2demo.runtime.CounterScope;

/**
 * 引擎命令。
 */
public sealed interface EngineCommand permits EngineCommand.DealDamageCommand, EngineCommand.GrantShieldCommand,
        EngineCommand.ApplyStatusCommand, EngineCommand.RemoveStatusCommand, EngineCommand.ApplyMarkCommand,
        EngineCommand.ConsumeMarkCommand, EngineCommand.ModifyCounterCommand, EngineCommand.SpendResourceCommand,
        EngineCommand.SetCooldownCommand, EngineCommand.ScheduleEventCommand, EngineCommand.ModifyCadenceCommand {

    record DealDamageCommand(
            String sourceActorId,
            String targetActorId,
            String actionId,
            String label,
            String damageProfileId,
            String formulaId,
            Map<String, Double> inputValues) implements EngineCommand {

        public DealDamageCommand {
            Objects.requireNonNull(sourceActorId, "sourceActorId");
            Objects.requireNonNull(targetActorId, "targetActorId");
            Objects.requireNonNull(actionId, "actionId");
            Objects.requireNonNull(label, "label");
            Objects.requireNonNull(damageProfileId, "damageProfileId");
            Objects.requireNonNull(formulaId, "formulaId");
            Objects.requireNonNull(inputValues, "inputValues");
            inputValues = Map.copyOf(inputValues);
        }
    }

    record GrantShieldCommand(
            String sourceActorId,
            String targetActorId,
            String label,
            String formulaId,
            Map<String, Double> inputValues) implements EngineCommand {

        public GrantShieldCommand {
            Objects.requireNonNull(sourceActorId, "sourceActorId");
            Objects.requireNonNull(targetActorId, "targetActorId");
            Objects.requireNonNull(label, "label");
            Objects.requireNonNull(formulaId, "formulaId");
            Objects.requireNonNull(inputValues, "inputValues");
            inputValues = Map.copyOf(inputValues);
        }
    }

    record ApplyStatusCommand(
            String sourceActorId,
            String targetActorId,
            String statusId,
            Map<String, Double> inputValues) implements EngineCommand {

        public ApplyStatusCommand {
            Objects.requireNonNull(sourceActorId, "sourceActorId");
            Objects.requireNonNull(targetActorId, "targetActorId");
            Objects.requireNonNull(statusId, "statusId");
            Objects.requireNonNull(inputValues, "inputValues");
            inputValues = Map.copyOf(inputValues);
        }
    }

    record RemoveStatusCommand(
            String targetActorId,
            String statusId,
            long appliedAtMs) implements EngineCommand {

        public RemoveStatusCommand {
            Objects.requireNonNull(targetActorId, "targetActorId");
            Objects.requireNonNull(statusId, "statusId");
        }
    }

    record ApplyMarkCommand(
            String sourceActorId,
            String targetActorId,
            String markId,
            long expireAtMs,
            boolean consumable,
            Map<String, Double> inputValues) implements EngineCommand {

        public ApplyMarkCommand {
            Objects.requireNonNull(sourceActorId, "sourceActorId");
            Objects.requireNonNull(targetActorId, "targetActorId");
            Objects.requireNonNull(markId, "markId");
            Objects.requireNonNull(inputValues, "inputValues");
            inputValues = Map.copyOf(inputValues);
        }
    }

    record ConsumeMarkCommand(
            String sourceActorId,
            String targetActorId,
            String markId) implements EngineCommand {

        public ConsumeMarkCommand {
            Objects.requireNonNull(sourceActorId, "sourceActorId");
            Objects.requireNonNull(targetActorId, "targetActorId");
            Objects.requireNonNull(markId, "markId");
        }
    }

    record ModifyCounterCommand(
            String sourceActorId,
            String targetActorId,
            String counterId,
            CounterScope counterScope,
            int delta,
            int threshold,
            CounterResetMode resetMode,
            Map<String, Double> inputValues) implements EngineCommand {

        public ModifyCounterCommand {
            Objects.requireNonNull(sourceActorId, "sourceActorId");
            Objects.requireNonNull(targetActorId, "targetActorId");
            Objects.requireNonNull(counterId, "counterId");
            Objects.requireNonNull(counterScope, "counterScope");
            Objects.requireNonNull(resetMode, "resetMode");
            Objects.requireNonNull(inputValues, "inputValues");
            inputValues = Map.copyOf(inputValues);
        }
    }

    record SpendResourceCommand(
            String actorId,
            String resourceId,
            double amount) implements EngineCommand {

        public SpendResourceCommand {
            Objects.requireNonNull(actorId, "actorId");
            Objects.requireNonNull(resourceId, "resourceId");
        }
    }

    record SetCooldownCommand(
            String actorId,
            String actionId,
            long readyAtMs) implements EngineCommand {

        public SetCooldownCommand {
            Objects.requireNonNull(actorId, "actorId");
            Objects.requireNonNull(actionId, "actionId");
        }
    }

    record ScheduleEventCommand(
            long triggerAtMs,
            int priority,
            xyz.game.enginev2demo.event.InternalEvent payload) implements EngineCommand {

        public ScheduleEventCommand {
            Objects.requireNonNull(payload, "payload");
        }
    }

    /**
     * 节奏修改命令——作用到指定 actor 下匹配 tag 的动作。
     */
    record ModifyCadenceCommand(
            String affectedActorId,
            List<String> targetActionTags,
            CadenceOp op,
            double value) implements EngineCommand {

        public ModifyCadenceCommand {
            Objects.requireNonNull(affectedActorId, "affectedActorId");
            Objects.requireNonNull(targetActionTags, "targetActionTags");
            Objects.requireNonNull(op, "op");
            targetActionTags = List.copyOf(targetActionTags);
        }
    }
}
