package xyz.game.enginev2demo.compile;

import java.util.HashMap;
import java.util.Map;

import xyz.game.enginev2demo.action.ActionTemplate;
import xyz.game.enginev2demo.api.ActorTemplate;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.ItemTemplate;
import xyz.game.enginev2demo.api.StatusTemplate;
import xyz.game.enginev2demo.formula.FormulaCatalog;
import xyz.game.enginev2demo.pipeline.DamageProfileCatalog;
import xyz.game.enginev2demo.pipeline.DamageProfileTemplate;
import xyz.game.enginev2demo.trigger.EffectDef;
import xyz.game.enginev2demo.trigger.TriggerIndex;
import xyz.game.enginev2demo.trigger.TriggerSubscriptionDef;

/**
 * 配置包编译器。
 */
public final class BundleCompiler {

    public CompiledSnapshot compile(EngineBundle bundle) {
        FormulaCatalog formulaCatalog = FormulaCatalog.fromDefinitions(bundle.formulas());
        Map<String, ActorTemplate> actorTemplates = new HashMap<>(bundle.actorTemplates());
        Map<String, ActionTemplate> actionTemplates = new HashMap<>(bundle.actionTemplates());
        Map<String, ItemTemplate> itemTemplates = new HashMap<>(bundle.itemTemplates());
        Map<String, StatusTemplate> statusTemplates = new HashMap<>(bundle.statusTemplates());
        Map<String, DamageProfileTemplate> damageProfiles = new HashMap<>(bundle.damageProfiles());
        DamageProfileCatalog damageProfileCatalog = DamageProfileCatalog.fromTemplates(damageProfiles);

        for (DamageProfileTemplate damageProfile : damageProfiles.values()) {
            formulaCatalog.require(damageProfile.effectiveResistanceFormulaId());
            formulaCatalog.require(damageProfile.mitigationMultiplierFormulaId());
        }
        for (ActionTemplate actionTemplate : actionTemplates.values()) {
            formulaCatalog.require(actionTemplate.formulaId());
            damageProfileCatalog.require(actionTemplate.damageProfileId());
            formulaCatalog.require(actionTemplate.cooldownFormulaId());
            validateSubscriptions(formulaCatalog, damageProfileCatalog, actionTemplate.triggerSubscriptions());
        }
        for (ActorTemplate actorTemplate : actorTemplates.values()) {
            for (String actionId : actorTemplate.actionIds()) {
                if (!actionTemplates.containsKey(actionId)) {
                    throw new IllegalArgumentException(
                            "actor template '%s' references missing action '%s'".formatted(actorTemplate.templateId(), actionId));
                }
            }
            validateSubscriptions(formulaCatalog, damageProfileCatalog, actorTemplate.triggerSubscriptions());
        }
        for (ItemTemplate itemTemplate : itemTemplates.values()) {
            validateSubscriptions(formulaCatalog, damageProfileCatalog, itemTemplate.triggerSubscriptions());
        }
        for (StatusTemplate statusTemplate : statusTemplates.values()) {
            if (statusTemplate.magnitudeFormulaId() != null) {
                formulaCatalog.require(statusTemplate.magnitudeFormulaId());
            }
            for (var attrModifier : statusTemplate.attrModifiers()) {
                formulaCatalog.require(attrModifier.formulaId());
            }
            if (!statusTemplate.attrModifiers().isEmpty()) {
                if (statusTemplate.statusKind() != xyz.game.enginev2demo.runtime.StatusKind.ATTRIBUTE_MODIFIER) {
                    throw new IllegalArgumentException(
                            "status '%s' with attrModifiers must use ATTRIBUTE_MODIFIER".formatted(statusTemplate.statusId()));
                }
                if (statusTemplate.refreshPolicy() != xyz.game.enginev2demo.runtime.StatusRefreshPolicy.REPLACE) {
                    throw new IllegalArgumentException(
                            "status '%s' with attrModifiers must use REPLACE refreshPolicy".formatted(statusTemplate.statusId()));
                }
            }
            validateSubscriptions(formulaCatalog, damageProfileCatalog, statusTemplate.triggerSubscriptions());
        }
        TriggerIndex triggerIndex = TriggerIndex.compile(actorTemplates, actionTemplates, itemTemplates, statusTemplates);
        return new CompiledSnapshot(
                actorTemplates,
                actionTemplates,
                itemTemplates,
                statusTemplates,
                damageProfileCatalog,
                formulaCatalog,
                triggerIndex);
    }

    private void validateSubscriptions(
            FormulaCatalog formulaCatalog,
            DamageProfileCatalog damageProfileCatalog,
            java.util.List<TriggerSubscriptionDef> subscriptions) {
        for (TriggerSubscriptionDef subscription : subscriptions) {
            if (subscription.conditionFormulaId() != null) {
                formulaCatalog.require(subscription.conditionFormulaId());
            }
            for (EffectDef effect : subscription.effects()) {
                switch (effect) {
                    case EffectDef.DealDamageEffect dealDamageEffect -> {
                        damageProfileCatalog.require(dealDamageEffect.damageProfileId());
                        formulaCatalog.require(dealDamageEffect.formulaId());
                    }
                    case EffectDef.GrantShieldEffect grantShieldEffect -> formulaCatalog.require(grantShieldEffect.formulaId());
                    case EffectDef.ApplyStatusEffect ignored -> {
                    }
                    case EffectDef.ApplyMarkEffect ignored -> {
                    }
                    case EffectDef.ConsumeMarkEffect ignored -> {
                    }
                    case EffectDef.ModifyCounterEffect ignored -> {
                    }
                    case EffectDef.ModifyCadenceEffect modifyCadenceEffect -> {
                        if (modifyCadenceEffect.valueFormulaId() != null) {
                            formulaCatalog.require(modifyCadenceEffect.valueFormulaId());
                        }
                    }
                }
            }
        }
    }
}
