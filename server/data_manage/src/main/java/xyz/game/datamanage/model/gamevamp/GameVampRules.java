package xyz.game.datamanage.model.gamevamp;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.Valid;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public record GameVampRules(@Valid List<GameVampRule> rules) {
    public GameVampRules {
        rules = rules == null ? null : Collections.unmodifiableList(new ArrayList<>(rules));
    }

    @JsonAnySetter
    public void rejectUnknownField(String fieldName, Object ignored) {
        throw new IllegalArgumentException("未知字段：" + fieldName);
    }
}
