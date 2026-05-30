package xyz.game.datamanage.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.stereotype.Component;
import xyz.game.datamanage.mapper.HeroesMapper;
import xyz.game.datamanage.mapper.SkillMountsMapper;

@Component
public class DefaultBasicAttackProvisioner {

    public static final String DEFAULT_BASIC_ATTACK_SKILL_ID = "skill_lol_basic_attack_default";
    public static final int BASIC_ATTACK_TYPE_ID = 50101;
    public static final String FORMULA_COOLDOWN_ID = "formula_lol_basic_attack_cooldown";
    public static final String FORMULA_DAMAGE_ID = "formula_lol_basic_attack_damage_base";
    public static final String DAMAGE_BINDING_KEY = "damage.basic_attack.base";
    public static final String COOLDOWN_FORMULA_TEXT =
        "1000 / min(max(self.attack_speed, 0.01), 3.0)";
    public static final String DAMAGE_FORMULA_TEXT = "self.attack_damage";

    private static final String LEGACY_DAMAGE_BINDING_KEY = "damage.basic_attack.expected";
    private static final String LEGACY_EXPECTED_DAMAGE_VAR_KEY = "expected_basic_attack_damage";

    private final PostgresWriteStore writeStore;
    private final PostgresReadStore readStore;
    private final HeroesMapper heroesMapper;
    private final SkillMountsMapper skillMountsMapper;
    private final ObjectMapper objectMapper;

    public DefaultBasicAttackProvisioner(
        PostgresWriteStore writeStore,
        PostgresReadStore readStore,
        HeroesMapper heroesMapper,
        SkillMountsMapper skillMountsMapper,
        ObjectMapper objectMapper
    ) {
        this.writeStore = writeStore;
        this.readStore = readStore;
        this.heroesMapper = heroesMapper;
        this.skillMountsMapper = skillMountsMapper;
        this.objectMapper = objectMapper;
    }

    public void ensureForGame(String gameId) {
        ensureSharedBasicAttackSkill(gameId);
        ensureBasicAttackType(gameId);
        ensureBasicAttackTypeRelation(gameId);
        ensureFormulaProfiles(gameId);
        ensureFormulaBindings(gameId);
        ensureHeroMounts(gameId);
    }

    public void ensureHeroMount(String gameId, String heroId) {
        ensureForGame(gameId);
        upsertHeroMountIfMissing(gameId, heroId);
    }

    private void ensureSharedBasicAttackSkill(String gameId) {
        ObjectNode existing = readStore.loadSkill(gameId, DEFAULT_BASIC_ATTACK_SKILL_ID);
        if (existing == null || needsSharedBasicAttackRepair(existing)) {
            writeStore.upsertSkill(gameId, DEFAULT_BASIC_ATTACK_SKILL_ID, buildDefaultBasicAttackSkillBody());
        }
    }

    private boolean needsSharedBasicAttackRepair(ObjectNode existing) {
        if (usesLegacyDamageBinding(existing)) {
            return true;
        }
        if (hasLegacyExpectedDamageVar(existing)) {
            return true;
        }
        return !hasEffectLevelExpectedCrit(existing);
    }

    private boolean usesLegacyDamageBinding(ObjectNode skill) {
        JsonNode dealDamage = findBasicAttackDealDamageAction(skill);
        if (dealDamage == null || !dealDamage.isObject()) {
            return true;
        }
        return LEGACY_DAMAGE_BINDING_KEY.equals(dealDamage.path("amount").path("bindingKey").asText(""));
    }

    private boolean hasLegacyExpectedDamageVar(ObjectNode skill) {
        JsonNode vars = skill.path("params").path("vars");
        if (!vars.isArray()) {
            return false;
        }
        for (JsonNode var : vars) {
            if (LEGACY_EXPECTED_DAMAGE_VAR_KEY.equals(var.path("key").asText())) {
                return true;
            }
        }
        return false;
    }

    private boolean hasEffectLevelExpectedCrit(ObjectNode skill) {
        JsonNode dealDamage = findBasicAttackDealDamageAction(skill);
        if (dealDamage == null || !dealDamage.isObject()) {
            return false;
        }
        JsonNode crit = dealDamage.path("crit");
        return "expected".equals(crit.path("policy").asText())
            && "attacker_crit_chance".equals(crit.path("chanceSource").asText())
            && "attacker_crit_damage".equals(crit.path("multiplierSource").asText());
    }

    private JsonNode findBasicAttackDealDamageAction(ObjectNode skill) {
        JsonNode triggers = skill.path("mechanicsConfig").path("triggers");
        if (!triggers.isArray() || triggers.isEmpty()) {
            return null;
        }
        JsonNode actions = triggers.get(0).path("actions");
        if (!actions.isArray()) {
            return null;
        }
        for (JsonNode action : actions) {
            if ("deal_damage".equals(action.path("type").asText())) {
                return action;
            }
        }
        return null;
    }

    private void ensureBasicAttackType(String gameId) {
        if (readStore.loadType(gameId, BASIC_ATTACK_TYPE_ID) != null) {
            return;
        }
        ObjectNode type = objectMapper.createObjectNode();
        type.put("typeId", BASIC_ATTACK_TYPE_ID);
        type.put("name", "basic_attack");
        type.put("description", "action/basic_attack");
        writeStore.upsertType(gameId, BASIC_ATTACK_TYPE_ID, type);
    }

    private void ensureBasicAttackTypeRelation(String gameId) {
        if (readStore.loadTypeRelation(gameId, BASIC_ATTACK_TYPE_ID, "skill", DEFAULT_BASIC_ATTACK_SKILL_ID) != null) {
            return;
        }
        ObjectNode body = objectMapper.createObjectNode();
        body.put("typeId", BASIC_ATTACK_TYPE_ID);
        body.put("targetCategory", "skill");
        body.put("targetId", DEFAULT_BASIC_ATTACK_SKILL_ID);
        body.set("extend", objectMapper.createObjectNode());
        writeStore.upsertTypeRelation(gameId, BASIC_ATTACK_TYPE_ID, "skill", DEFAULT_BASIC_ATTACK_SKILL_ID, body);
    }

    private void ensureFormulaProfiles(String gameId) {
        upsertDefaultFormulaProfileIfNeeded(
            gameId,
            FORMULA_COOLDOWN_ID,
            buildDefaultCooldownFormulaProfile()
        );
        upsertDefaultDamageFormulaProfileIfNeeded(gameId);
    }

    private void upsertDefaultDamageFormulaProfileIfNeeded(String gameId) {
        ObjectNode desired = buildDefaultDamageFormulaProfile();
        ObjectNode existing = readStore.loadFormulaProfile(gameId, FORMULA_DAMAGE_ID);
        if (existing == null || needsDamageFormulaProfileRepair(existing)) {
            writeStore.upsertFormulaProfile(gameId, FORMULA_DAMAGE_ID, desired);
        }
    }

    private boolean needsDamageFormulaProfileRepair(ObjectNode existing) {
        if (!hasCompilableFormulaText(existing.path("params"))) {
            return true;
        }
        String formulaText = existing.path("params").path("formulaText").asText("");
        return !DAMAGE_FORMULA_TEXT.equals(formulaText.trim());
    }

    private void upsertDefaultFormulaProfileIfNeeded(String gameId, String formulaId, ObjectNode desired) {
        ObjectNode existing = readStore.loadFormulaProfile(gameId, formulaId);
        if (existing == null || !hasCompilableFormulaText(existing.path("params"))) {
            writeStore.upsertFormulaProfile(gameId, formulaId, desired);
        }
    }

    private boolean hasCompilableFormulaText(JsonNode params) {
        if (params == null || !params.isObject()) {
            return false;
        }
        String formulaText = params.path("formulaText").asText("");
        return !formulaText.isBlank();
    }

    private ObjectNode buildDefaultCooldownFormulaProfile() {
        ObjectNode cooldown = objectMapper.createObjectNode();
        cooldown.put("formulaType", "cooldown");
        cooldown.put("formulaKind", "vars_expr");
        cooldown.put("description", "默认普攻冷却：1000 / min(max(attack_speed, 0.01), 3.0)");
        cooldown.putObject("params").put("formulaText", COOLDOWN_FORMULA_TEXT);
        return cooldown;
    }

    private ObjectNode buildDefaultDamageFormulaProfile() {
        ObjectNode damage = objectMapper.createObjectNode();
        damage.put("formulaType", "damage");
        damage.put("formulaKind", "vars_expr");
        damage.put("description", "默认普攻基础伤害");
        damage.putObject("params").put("formulaText", DAMAGE_FORMULA_TEXT);
        return damage;
    }

    private void ensureFormulaBindings(String gameId) {
        if (readStore.loadFormulaBinding(gameId, "skill", DEFAULT_BASIC_ATTACK_SKILL_ID, "cooldown.basic_attack") == null) {
            ObjectNode binding = objectMapper.createObjectNode();
            binding.put("formulaId", FORMULA_COOLDOWN_ID);
            writeStore.upsertFormulaBinding(
                gameId,
                "skill",
                DEFAULT_BASIC_ATTACK_SKILL_ID,
                "cooldown.basic_attack",
                binding
            );
        }
        ensureDefaultDamageFormulaBinding(gameId);
    }

    private void ensureDefaultDamageFormulaBinding(String gameId) {
        ObjectNode legacyBinding = readStore.loadFormulaBinding(
            gameId,
            "skill",
            DEFAULT_BASIC_ATTACK_SKILL_ID,
            LEGACY_DAMAGE_BINDING_KEY
        );
        ObjectNode baseBinding = readStore.loadFormulaBinding(
            gameId,
            "skill",
            DEFAULT_BASIC_ATTACK_SKILL_ID,
            DAMAGE_BINDING_KEY
        );
        boolean needsUpsert = legacyBinding != null
            || baseBinding == null
            || !FORMULA_DAMAGE_ID.equals(baseBinding.path("formulaId").asText(""));
        if (!needsUpsert) {
            return;
        }
        ObjectNode binding = objectMapper.createObjectNode();
        binding.put("formulaId", FORMULA_DAMAGE_ID);
        writeStore.upsertFormulaBinding(
            gameId,
            "skill",
            DEFAULT_BASIC_ATTACK_SKILL_ID,
            DAMAGE_BINDING_KEY,
            binding
        );
    }

    private void ensureHeroMounts(String gameId) {
        for (Map<String, Object> row : heroesMapper.listHeroes(gameId)) {
            String heroId = resolveRowText(row, "heroId");
            if (heroId == null || heroId.isBlank()) {
                continue;
            }
            upsertHeroMountIfMissing(gameId, heroId);
        }
    }

    private String resolveRowText(Map<String, Object> row, String key) {
        Object value = resolveRowValue(row, key);
        return value == null ? null : value.toString();
    }

    private Object resolveRowValue(Map<String, Object> row, String key) {
        if (row.containsKey(key)) {
            return row.get(key);
        }
        String lowerKey = key.toLowerCase(Locale.ROOT);
        if (row.containsKey(lowerKey)) {
            return row.get(lowerKey);
        }
        String snakeKey = camelToSnake(key);
        if (row.containsKey(snakeKey)) {
            return row.get(snakeKey);
        }
        for (Map.Entry<String, Object> entry : row.entrySet()) {
            if (entry.getKey().equalsIgnoreCase(key)) {
                return entry.getValue();
            }
        }
        return null;
    }

    private String camelToSnake(String key) {
        StringBuilder builder = new StringBuilder(key.length() + 4);
        for (int i = 0; i < key.length(); i++) {
            char ch = key.charAt(i);
            if (Character.isUpperCase(ch)) {
                if (i > 0) {
                    builder.append('_');
                }
                builder.append(Character.toLowerCase(ch));
            } else {
                builder.append(ch);
            }
        }
        return builder.toString();
    }

    private void upsertHeroMountIfMissing(String gameId, String heroId) {
        if (skillMountsMapper.findSkillMountByNaturalKey(
            gameId,
            "hero",
            heroId,
            DEFAULT_BASIC_ATTACK_SKILL_ID
        ) != null) {
            return;
        }
        ObjectNode mount = objectMapper.createObjectNode();
        mount.put("targetCategory", "hero");
        mount.put("targetId", heroId);
        mount.put("skillId", DEFAULT_BASIC_ATTACK_SKILL_ID);
        mount.put("enabled", true);
        mount.set("extend", objectMapper.createObjectNode());
        writeStore.upsertSkillMount(gameId, "hero", heroId, DEFAULT_BASIC_ATTACK_SKILL_ID, mount);
    }

    private ObjectNode buildDefaultBasicAttackSkillBody() {
        ObjectNode skill = objectMapper.createObjectNode();
        skill.putNull("ownerType");
        skill.putNull("ownerId");
        skill.put("skillKey", "AA");
        skill.put("name", "默认普通攻击");
        skill.put("description", "共享默认普攻模板；特殊英雄可额外挂载专属 basic attack skill。");

        ArrayNode cooldowns = objectMapper.createArrayNode();
        ObjectNode cooldown = objectMapper.createObjectNode();
        cooldown.put("kind", "formula");
        cooldown.put("bindingKey", "cooldown.basic_attack");
        cooldowns.add(cooldown);
        skill.set("cooldowns", cooldowns);

        ObjectNode params = objectMapper.createObjectNode();
        params.put("version", 1);
        params.set("vars", objectMapper.createArrayNode());
        skill.set("params", params);

        ObjectNode mechanicsConfig = objectMapper.createObjectNode();
        mechanicsConfig.put("version", 1);
        ArrayNode triggers = objectMapper.createArrayNode();
        ObjectNode trigger = objectMapper.createObjectNode();
        trigger.put("id", "basic_attack_cast");
        trigger.set("event", objectMapper.createObjectNode().put("type", "on_spell_cast"));
        ArrayNode actions = objectMapper.createArrayNode();
        ObjectNode dealDamage = objectMapper.createObjectNode();
        dealDamage.put("type", "deal_damage");
        dealDamage.put("damageSource", "self");
        dealDamage.put("damageTarget", "enemy");
        dealDamage.put("damageType", "physical");
        ObjectNode amount = objectMapper.createObjectNode();
        amount.put("kind", "formula");
        amount.put("bindingKey", DAMAGE_BINDING_KEY);
        dealDamage.set("amount", amount);
        ObjectNode crit = objectMapper.createObjectNode();
        crit.put("policy", "expected");
        crit.put("chanceSource", "attacker_crit_chance");
        crit.put("multiplierSource", "attacker_crit_damage");
        dealDamage.set("crit", crit);
        actions.add(dealDamage);
        trigger.set("actions", actions);
        triggers.add(trigger);
        mechanicsConfig.set("triggers", triggers);
        skill.set("mechanicsConfig", mechanicsConfig);
        return skill;
    }
}
