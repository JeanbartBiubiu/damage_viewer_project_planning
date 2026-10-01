package xyz.game.datamanage.model.simulation;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.OffsetDateTime;
import java.util.List;
import xyz.game.datamanage.model.attribute.AttributeResponse;
import xyz.game.datamanage.model.character.CharacterAttributesResponse;
import xyz.game.datamanage.model.character.CharacterResponse;
import xyz.game.datamanage.model.character.LevelConfigResponse;
import xyz.game.datamanage.model.damagetype.DamageTypeFormulaResponse;
import xyz.game.datamanage.model.damagetype.DamageTypeResponse;
import xyz.game.datamanage.model.gamevamp.GameVampRules;
import xyz.game.datamanage.model.modifierzone.ModifierZoneResponse;
import xyz.game.datamanage.model.skillcategory.SkillCategoryResponse;
import xyz.game.datamanage.model.skillconfiguration.SkillConfigurationResponse;
import xyz.game.datamanage.model.skillrelation.CharacterSkillRelationResponse;
import xyz.game.datamanage.model.status.StatusResponse;

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
                            int targetLevel, String basicAttackSkillKey, int basicAttackLevel) { }

    public record Combatant(CharacterResponse character, CharacterAttributesResponse attributes,
                            JsonNode selectedLevelValues, List<CharacterSkillRelationResponse> attachedSkills) { }

    public record Catalogs(LevelConfigResponse levelConfig, List<AttributeResponse> attributes,
                           List<SkillCategoryResponse> skillCategories,
                           List<DamageTypeEntry> damageTypes,
                           List<ModifierZoneResponse> modifierZones, List<StatusResponse> statuses,
                           GameVampRules vampRules) { }

    public record DamageTypeEntry(DamageTypeResponse type, DamageTypeFormulaResponse formula) { }

    public record Reference(String sourceSkillKey, String sourceType, String sourceKey, String fieldPath,
                            String targetType, String targetSkillKey, String targetKey, String targetSubKey) { }
}
