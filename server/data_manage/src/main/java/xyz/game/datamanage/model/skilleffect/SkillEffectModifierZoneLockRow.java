package xyz.game.datamanage.model.skilleffect;

import xyz.game.datamanage.model.modifierzone.ModifierZoneCalculationMode;
import xyz.game.datamanage.model.modifierzone.ModifierZoneApplicationStage;
import xyz.game.datamanage.model.modifierzone.ModifierZoneDomain;
import xyz.game.datamanage.model.modifierzone.ModifierZoneStatus;

public record SkillEffectModifierZoneLockRow(
    String modifierZoneKey,
    ModifierZoneDomain domain,
    ModifierZoneCalculationMode calculationMode,
    ModifierZoneApplicationStage applicationStage,
    ModifierZoneStatus status
) {
    public SkillEffectModifierZoneLockRow(String modifierZoneKey, ModifierZoneDomain domain,
        ModifierZoneCalculationMode calculationMode, ModifierZoneStatus status) {
        this(modifierZoneKey, domain, calculationMode, null, status);
    }
}
