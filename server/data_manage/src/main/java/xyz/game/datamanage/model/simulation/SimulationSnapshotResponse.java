package xyz.game.datamanage.model.simulation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.OffsetDateTime;
import java.util.List;
import xyz.game.datamanage.model.attribute.AttributeResponse;
import xyz.game.datamanage.model.build.BuildConfiguration;
import xyz.game.datamanage.model.build.BuildDefinitionResponse;
import xyz.game.datamanage.model.character.CharacterAttributesResponse;
import xyz.game.datamanage.model.character.CharacterResponse;
import xyz.game.datamanage.model.character.LevelConfigResponse;
import xyz.game.datamanage.model.damagetype.DamageTypeFormulaResponse;
import xyz.game.datamanage.model.damagetype.DamageTypeResponse;
import xyz.game.datamanage.model.equipment.EquipmentAttributesResponse;
import xyz.game.datamanage.model.equipment.EquipmentResponse;
import xyz.game.datamanage.model.gamevamp.GameVampRules;
import xyz.game.datamanage.model.calculation.GameCalculationRulesResponse;
import xyz.game.datamanage.model.modifierzone.ModifierZoneResponse;
import xyz.game.datamanage.model.skillcategory.SkillCategoryResponse;
import xyz.game.datamanage.model.skillconfiguration.SkillConfigurationResponse;
import xyz.game.datamanage.model.skillrelation.CharacterSkillRelationResponse;
import xyz.game.datamanage.model.skillrelation.EquipmentSkillRelationResponse;
import xyz.game.datamanage.model.status.StatusResponse;
import xyz.game.datamanage.model.skill.SkillStatus;

/** 所选场景的一次一致读取；所有作者对象保持原管理响应结构。 */
public record SimulationSnapshotResponse(
    String gameId,
    Selection selection,
    Combatant source,
    Combatant target,
    List<SkillConfigurationResponse> skillConfigurations,
    Catalogs catalogs,
    List<Reference> references,
    String snapshotDigest,
    OffsetDateTime readAt
) {
    public record Selection(String sourceCharacterKey, int sourceLevel, String targetCharacterKey,
                            int targetLevel, String basicAttackSkillKey, Integer basicAttackLevel,
                            List<String> sourceEquipmentKeys, List<String> targetEquipmentKeys,
                            List<BuildConfiguration> sourceBuildConfigurations,
                            List<BuildConfiguration> targetBuildConfigurations,
                            List<SkillSetting> sourceSkillSettings, List<SkillSetting> targetSkillSettings,
                            List<PlannedSkill> plannedSkills) { }

    public record PlannedSkill(Origin origin, String skillKey, int skillLevel, List<String> phaseKinds) { }

    public record Combatant(CharacterResponse character, CharacterAttributesResponse attributes,
                            JsonNode selectedLevelValues, List<CharacterSkillRelationResponse> attachedSkills,
                            List<SelectedEquipment> selectedEquipment, List<SelectedBuild> selectedBuilds,
                            List<SkillSource> skillSources) { }

    public record SelectedBuild(BuildDefinitionResponse definition, BuildConfiguration configuration) { }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Origin(String kind, String characterKey, String equipmentKey, String systemKey,
                         String roleKey, String groupKey, String slotKey, String optionKey) {
        public static Origin character(String key) {
            return new Origin("CHARACTER", key, null, null, null, null, null, null);
        }

        public static Origin equipment(String key) {
            return new Origin("EQUIPMENT", null, key, null, null, null, null, null);
        }

        public static Origin build(String systemKey, BuildConfiguration.OptionSelection selection) {
            return new Origin("BUILD_OPTION", null, null, systemKey, selection.roleKey(), selection.groupKey(),
                selection.slotKey(), selection.optionKey());
        }
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SkillSetting(Origin origin, String skillKey, boolean enabled, Integer skillLevel) { }

    public enum InactiveReason {
        GLOBAL_DISABLED, SCENE_DISABLED, UNLEARNED, NO_AUTONOMOUS_ATTACK, ACTIVE_DEFERRED,
        CONFIGURATION_INCOMPLETE, LEVEL_REQUIRED
    }

    public record SkillSource(Origin origin, String skillKey, String skillName, SkillStatus skillStatus,
                              boolean enabled, Integer skillLevel, List<String> enabledRuleKeys,
                              InactiveReason inactiveReason) { }

    public record SelectedEquipment(EquipmentResponse equipment, EquipmentAttributesResponse attributes,
                                    List<EquipmentSkillRelationResponse> attachedSkills) { }

    public record Catalogs(LevelConfigResponse levelConfig, List<AttributeResponse> attributes,
                           List<SkillCategoryResponse> skillCategories,
                           List<DamageTypeEntry> damageTypes,
                           List<ModifierZoneResponse> modifierZones, List<StatusResponse> statuses,
                           GameVampRules vampRules, GameCalculationRulesResponse calculationRules) { }

    public record DamageTypeEntry(DamageTypeResponse type, DamageTypeFormulaResponse formula) { }

    public record Reference(String sourceSkillKey, String sourceType, String sourceKey, String fieldPath,
                            String targetType, String targetSkillKey, String targetKey, String targetSubKey) { }
}
