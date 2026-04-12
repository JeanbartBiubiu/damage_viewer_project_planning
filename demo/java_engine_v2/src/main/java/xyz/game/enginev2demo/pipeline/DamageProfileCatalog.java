package xyz.game.enginev2demo.pipeline;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * damageProfileId -> profile 模板目录。
 */
public record DamageProfileCatalog(Map<String, DamageProfileTemplate> profiles) {

    public DamageProfileCatalog {
        profiles = Map.copyOf(profiles);
    }

    public static DamageProfileCatalog fromTemplates(Map<String, DamageProfileTemplate> templates) {
        return new DamageProfileCatalog(new LinkedHashMap<>(templates));
    }

    public DamageProfileTemplate require(String damageProfileId) {
        DamageProfileTemplate profile = profiles.get(damageProfileId);
        if (profile == null) {
            throw new IllegalArgumentException("missing damage profile: " + damageProfileId);
        }
        return profile;
    }
}
