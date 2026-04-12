package xyz.game.enginev2demo;

import java.util.LinkedHashMap;
import java.util.Map;

import xyz.game.enginev2demo.action.ActionGateEvaluator;
import xyz.game.enginev2demo.action.ActionExecutor;
import xyz.game.enginev2demo.action.ActionSelector;
import xyz.game.enginev2demo.command.EngineCommandExecutor;
import xyz.game.enginev2demo.control.ControlSubsystem;
import xyz.game.enginev2demo.counter.CounterSubsystem;
import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.ActorSnapshot;
import xyz.game.enginev2demo.api.CombatantRunInit;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunInput;
import xyz.game.enginev2demo.api.EngineRunResult;
import xyz.game.enginev2demo.compile.BundleCompiler;
import xyz.game.enginev2demo.compile.CompiledSnapshot;
import xyz.game.enginev2demo.event.EventDispatcher;
import xyz.game.enginev2demo.event.InternalEvent;
import xyz.game.enginev2demo.event.ScheduledEvent;
import xyz.game.enginev2demo.formula.FormulaService;
import xyz.game.enginev2demo.history.HistorySubsystem;
import xyz.game.enginev2demo.mark.MarkSubsystem;
import xyz.game.enginev2demo.pipeline.PipelineRunner;
import xyz.game.enginev2demo.runtime.ActorRuntime;
import xyz.game.enginev2demo.runtime.RuntimeState;
import xyz.game.enginev2demo.runtime.StatusInstance;
import xyz.game.enginev2demo.cadence.CadenceSubsystem;
import xyz.game.enginev2demo.shield.ShieldSubsystem;
import xyz.game.enginev2demo.trigger.TriggerDispatcher;

/**
 * Demo 的总入口。
 * 这里只负责把编译快照、子系统和中央执行链装起来，不承载具体游戏语义。
 */
public final class EngineDemoFacade {

    private static final int ACTION_CAST_PRIORITY = 100;

    private final BundleCompiler bundleCompiler = new BundleCompiler();

    public EngineSession init(EngineBundle bundle) {
        // init 阶段只做“静态配置 -> 可执行快照”的装配，不创建本次 run 的可变状态。
        CompiledSnapshot snapshot = bundleCompiler.compile(bundle);
        FormulaService formulaService = new FormulaService();
        HistorySubsystem historySubsystem = new HistorySubsystem();
        MarkSubsystem markSubsystem = new MarkSubsystem();
        CounterSubsystem counterSubsystem = new CounterSubsystem();
        ControlSubsystem controlSubsystem = new ControlSubsystem();
        CadenceSubsystem cadenceSubsystem = new CadenceSubsystem(
                formulaService, snapshot.formulaCatalog(), snapshot.actionTemplates());
        ShieldSubsystem shieldSubsystem = new ShieldSubsystem();
        TriggerDispatcher triggerDispatcher = new TriggerDispatcher(snapshot, formulaService, snapshot.triggerIndex());
        PipelineRunner pipelineRunner = new PipelineRunner(
                snapshot,
                formulaService,
                shieldSubsystem,
                controlSubsystem,
                historySubsystem);
        EngineCommandExecutor engineCommandExecutor = new EngineCommandExecutor(
                snapshot,
                formulaService,
                pipelineRunner,
                shieldSubsystem,
                triggerDispatcher,
                controlSubsystem,
                historySubsystem,
                counterSubsystem,
                markSubsystem,
                cadenceSubsystem);
        ActionSelector actionSelector = new ActionSelector(
                snapshot,
                cadenceSubsystem,
                controlSubsystem,
                new ActionGateEvaluator(markSubsystem));
        ActionExecutor actionExecutor = new ActionExecutor(
                snapshot,
                formulaService,
                actionSelector,
                engineCommandExecutor,
                triggerDispatcher,
                cadenceSubsystem,
                controlSubsystem);
        EventDispatcher eventDispatcher = new EventDispatcher(actionExecutor, engineCommandExecutor);
        return new EngineSession(snapshot, eventDispatcher);
    }

    public EngineRunResult run(EngineSession session, EngineRunInput input) {
        RuntimeState state = buildRuntimeState(session.compiledSnapshot(), input);
        seedInitialActions(state, input);

        String stopReason = "queue_empty";
        long maxEvents = input.stopCondition().maxEvents();
        // 主循环始终由中央队列驱动，Actor/Skill 本身不主动推进时间。
        while (state.processedEvents() < maxEvents) {
            ScheduledEvent scheduledEvent = state.pollNextEvent();
            if (scheduledEvent == null) {
                break;
            }
            state.setNowMs(scheduledEvent.triggerAtMs());
            session.eventDispatcher().dispatch(state, scheduledEvent);
            state.incrementProcessedEvents();
        }
        if (state.processedEvents() >= maxEvents && !state.isQueueEmpty()) {
            stopReason = "max_events";
        }

        Map<String, ActorSnapshot> actors = new LinkedHashMap<>();
        for (Map.Entry<String, ActorRuntime> entry : state.actors().entrySet()) {
            ActorRuntime actor = entry.getValue();
            actors.put(entry.getKey(), new ActorSnapshot(
                    actor.actorId(),
                    actor.currentHp(),
                    actor.shieldAmount(),
                    actor.attributes()));
        }
        return new EngineRunResult(actors, state.logs(), state.nowMs(), state.processedEvents(), stopReason);
    }

    private RuntimeState buildRuntimeState(CompiledSnapshot snapshot, EngineRunInput input) {
        RuntimeState runtimeState = new RuntimeState(input.seed());
        // 1v1 demo 里 pair state 固定同时创建 self->enemy 和 enemy->self 两条边。
        runtimeState.addActor(snapshot.instantiateActor(input.self()));
        runtimeState.addActor(snapshot.instantiateActor(input.enemy()));
        createPairState(runtimeState, input.self(), input.enemy());
        createPairState(runtimeState, input.enemy(), input.self());
        seedInitialStatusExpiries(runtimeState);
        return runtimeState;
    }

    private void createPairState(RuntimeState runtimeState, CombatantRunInit source, CombatantRunInit target) {
        runtimeState.createPairState(source.actorId(), target.actorId());
    }

    private void seedInitialActions(RuntimeState state, EngineRunInput input) {
        for (ActionRequest request : input.initialActions()) {
            state.enqueue(new ScheduledEvent(
                    request.triggerAtMs(),
                    ACTION_CAST_PRIORITY,
                    state.nextSequence(),
                    new InternalEvent.ActionCast(request.sourceActorId(), request.targetActorId(), request.actionId())));
        }
    }

    private void seedInitialStatusExpiries(RuntimeState state) {
        // 初始挂载状态如果自带持续时间，需要在 run 开始前补进过期事件。
        for (ActorRuntime actorRuntime : state.actors().values()) {
            for (StatusInstance statusInstance : actorRuntime.activeStatuses().values()) {
                if (statusInstance.expireAtMs() > 0) {
                    state.enqueue(new ScheduledEvent(
                            statusInstance.expireAtMs(),
                            50,
                            state.nextSequence(),
                            new InternalEvent.StatusExpire(
                                    actorRuntime.actorId(),
                                    statusInstance.statusId(),
                                    statusInstance.appliedAtMs())));
                }
            }
        }
    }
}
