package xyz.game.datamanage.model.gamevamp;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageDeliveryKind;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageOriginKind;
import xyz.game.datamanage.model.skilleffect.SkillEffectVampBasisOutputKind;
import xyz.game.datamanage.model.skilleffect.SkillEffectVampType;

public record GameVampRule(
    SkillEffectVampType vampType,
    String sourceAttributeKey,
    SkillEffectVampBasisOutputKind basisOutputKind,
    BigDecimal defaultEfficiency,
    List<SkillEffectDamageDeliveryKind> deliveryKinds,
    List<SkillEffectDamageOriginKind> originKinds,
    List<String> skillCategoryKeys
) {
    public GameVampRule {
        deliveryKinds = immutable(deliveryKinds);
        originKinds = immutable(originKinds);
        skillCategoryKeys = immutable(skillCategoryKeys);
    }

    private static <T> List<T> immutable(List<T> values) {
        return values == null ? null : Collections.unmodifiableList(new ArrayList<>(values));
    }

    @JsonAnySetter
    public void rejectUnknownField(String fieldName, Object ignored) {
        throw new IllegalArgumentException("未知字段：" + fieldName);
    }
}
