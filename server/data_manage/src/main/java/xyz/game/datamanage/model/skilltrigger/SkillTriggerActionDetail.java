package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonIgnore;
import java.util.Set;

public interface SkillTriggerActionDetail {
    @JsonIgnore
    Set<String> foreignFields();

    @JsonIgnore
    Set<String> unknownFields();
}
