package xyz.game.datamanage.service.simulation;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.Combatant;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.InactiveReason;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.Origin;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.PlannedSkill;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.SkillSetting;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.SkillSource;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skillconfiguration.SkillConfigurationResponse;

final class SnapshotSources {
    private SnapshotSources() { }

    static List<Source> collect(Combatant combatant, String side, int characterLevel, String attackKey, Integer attackLevel) {
        List<Source> result = new ArrayList<>();
        for (int index = 0; index < combatant.attachedSkills().size(); index++) {
            var relation = combatant.attachedSkills().get(index);
            Integer level = side.equals("source") && relation.skillKey().equals(attackKey) ? attackLevel : null;
            result.add(new Source(side, Origin.character(combatant.character().characterKey()), relation.skillKey(),
                relation.skillStatus(), level, characterLevel, side + ".attachedSkills[" + index + "].skillKey"));
        }
        for (int equipmentIndex = 0; equipmentIndex < combatant.selectedEquipment().size(); equipmentIndex++) {
            var item = combatant.selectedEquipment().get(equipmentIndex);
            for (int relationIndex = 0; relationIndex < item.attachedSkills().size(); relationIndex++) {
                var relation = item.attachedSkills().get(relationIndex);
                result.add(new Source(side, Origin.equipment(item.equipment().equipmentKey()), relation.skillKey(),
                    relation.skillStatus(), 1, characterLevel, side + ".selectedEquipment[" + equipmentIndex
                    + "].attachedSkills[" + relationIndex + "].skillKey"));
            }
        }
        for (int buildIndex = 0; buildIndex < combatant.selectedBuilds().size(); buildIndex++) {
            var build = combatant.selectedBuilds().get(buildIndex);
            for (int optionIndex = 0; optionIndex < build.configuration().selections().size(); optionIndex++) {
                var selection = build.configuration().selections().get(optionIndex);
                for (var grant : build.definition().skillRelations()) {
                    if (!selection.optionKey().equals(grant.optionKey()) || selection.rank() < grant.activationRank()) continue;
                    int level = "FIXED".equals(grant.skillLevelMode()) ? grant.fixedSkillLevel() : selection.rank();
                    result.add(new Source(side, Origin.build(build.configuration().systemKey(), selection), grant.skillKey(),
                        grant.skillStatus(), level, characterLevel, side + ".selectedBuilds[" + buildIndex
                        + "].configuration.selections[" + optionIndex + "]"));
                }
            }
        }
        return result;
    }

    static void apply(List<Source> sources, List<SkillSetting> settings, String side, String attackKey) {
        for (int index = 0; index < settings.size(); index++) {
            SkillSetting setting = settings.get(index);
            String path = "selection." + side + "SkillSettings[" + index + "]";
            Source source = sources.stream().filter(candidate -> candidate.side.equals(side)
                && candidate.origin.equals(setting.origin()) && candidate.skillKey.equals(setting.skillKey())).findFirst().orElse(null);
            if (source == null) throw SnapshotIssues.invalid(path + ".origin", "SOURCE_NOT_SELECTED", "此侧没有该完整身份的实际来源技能");
            if (setting.enabled() && source.status != SkillStatus.ENABLED) {
                throw SnapshotIssues.invalid(path + ".enabled", "SKILL_DISABLED", "本场开关不能重新启用全局禁用技能");
            }
            if (setting.skillLevel() != null) {
                if (!"CHARACTER".equals(source.origin.kind())) {
                    throw SnapshotIssues.invalid(path + ".skillLevel", "LEVEL_OVERRIDE_FORBIDDEN", "装备与构筑授予等级不能由覆盖项修改");
                }
                if (source.side.equals("source") && source.skillKey.equals(attackKey) && !setting.skillLevel().equals(source.level)) {
                    throw SnapshotIssues.invalid(path + ".skillLevel", "LEVEL_OVERRIDE_FORBIDDEN", "所选普攻等级只能来自basicAttackLevel");
                }
                source.level = setting.skillLevel();
                source.levelPath = path + ".skillLevel";
            }
            source.enabled = setting.enabled();
        }
        for (Source source : sources) {
            if (!source.side.equals(side)) continue;
            Integer maximum = source.configuration.skill().maxLevel();
            if (source.level != null && (maximum == null || source.level < 0 || source.level > maximum)) {
                throw SnapshotIssues.invalid(source.levelPath, "LEVEL_OUT_OF_RANGE", "来源技能等级超出真实最高等级");
            }
            if ("EQUIPMENT".equals(source.origin.kind()) && !Integer.valueOf(1).equals(maximum)) {
                throw SnapshotIssues.invalid(source.path, "PASSIVE_LEVEL_UNSUPPORTED", "装备技能的真实最高等级必须为1");
            }
            if (source.status != SkillStatus.ENABLED) source.inactive = InactiveReason.GLOBAL_DISABLED;
            else if (!source.enabled) source.inactive = InactiveReason.SCENE_DISABLED;
            else if (Integer.valueOf(0).equals(source.level)) source.inactive = InactiveReason.UNLEARNED;
        }
    }

    static void plan(List<Source> sources, List<PlannedSkill> plannedSkills) {
        for (int index = 0; index < plannedSkills.size(); index++) {
            PlannedSkill planned = plannedSkills.get(index);
            String path = "selection.plannedSkills[" + index + "]";
            Source source = sources.stream().filter(candidate -> candidate.side.equals("source")
                && candidate.origin.equals(planned.origin()) && candidate.skillKey.equals(planned.skillKey())).findFirst().orElse(null);
            if (source == null) throw SnapshotIssues.invalid(path + ".origin", "SOURCE_NOT_SELECTED", "计划不能授予技能，必须使用A的真实角色绑定");
            if (source.status != SkillStatus.ENABLED) throw SnapshotIssues.invalid(path + ".skillKey", "SKILL_DISABLED", "计划技能全局未启用");
            if (!source.enabled) throw SnapshotIssues.invalid(path + ".skillKey", "SOURCE_DEPENDENCY_INACTIVE", "计划技能本场已关闭");
            if (Integer.valueOf(0).equals(source.level) || planned.skillLevel() == 0) {
                throw SnapshotIssues.invalid(path + ".skillLevel", "UNLEARNED", "计划技能必须已学");
            }
            if (source.level == null) throw SnapshotIssues.invalid(path + ".skillLevel", "LEVEL_REQUIRED", "须先通过来源设置明确技能等级");
            if (!source.level.equals(planned.skillLevel())) {
                throw SnapshotIssues.invalid(path + ".skillLevel", "LEVEL_MISMATCH", "计划等级必须与来源最终等级一致，不能覆盖来源设置");
            }
            source.planned = planned;
            source.plannedPath = path;
        }
    }

    static final class Source {
        final String side;
        final Origin origin;
        final String skillKey;
        final int characterLevel;
        final String path;
        SkillStatus status;
        Integer level;
        String levelPath;
        boolean enabled = true;
        InactiveReason inactive;
        SkillConfigurationResponse configuration;
        PlannedSkill planned;
        String plannedPath;
        final List<String> ruleKeys = new ArrayList<>();

        Source(String side, Origin origin, String skillKey, SkillStatus status, Integer level, int characterLevel, String path) {
            this.side = side;
            this.origin = origin;
            this.skillKey = skillKey;
            this.status = status;
            this.level = level;
            this.characterLevel = characterLevel;
            this.path = path;
            this.levelPath = "CHARACTER".equals(origin.kind()) && level != null ? "selection.basicAttackLevel" : path;
        }

        SkillSource response() {
            return new SkillSource(origin, skillKey, configuration.skill().name(), status, enabled, level,
                ruleKeys.stream().distinct().sorted().toList(), inactive);
        }
    }

    static final Comparator<Source> ORDER = Comparator.comparing((Source source) -> source.side)
        .thenComparing(source -> source.origin.toString()).thenComparing(source -> source.skillKey);
}
