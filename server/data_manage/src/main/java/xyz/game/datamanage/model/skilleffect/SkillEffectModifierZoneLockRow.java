package xyz.game.datamanage.model.skilleffect;

import xyz.game.datamanage.model.modifierzone.ModifierZoneCalculationMode;
import xyz.game.datamanage.model.modifierzone.ModifierZoneDomain;
import xyz.game.datamanage.model.modifierzone.ModifierZoneStatus;

public record SkillEffectModifierZoneLockRow(
    String modifierZoneKey,
    ModifierZoneDomain domain,
    ModifierZoneCalculationMode calculationMode,
    ModifierZoneStatus status
) {
}
