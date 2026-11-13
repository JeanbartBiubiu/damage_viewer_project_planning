package xyz.game.datamanage.model.simulation;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import xyz.game.datamanage.model.skillconfiguration.SkillConfigurationSaveRequest;

/** 只投影已有技能的明确修改；不接受客户端提供候选回读或派生目录。 */
public record SimulationPreviewUpdate(String skillKey, SkillConfigurationSaveRequest request) {
    @JsonAnySetter
    public void rejectUnknownField(String fieldName, Object ignored) {
        throw new IllegalArgumentException("候选修改包含未知字段：" + fieldName);
    }
}
