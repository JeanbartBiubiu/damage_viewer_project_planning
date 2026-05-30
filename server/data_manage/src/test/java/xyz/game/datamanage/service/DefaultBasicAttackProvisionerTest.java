package xyz.game.datamanage.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import xyz.game.datamanage.mapper.HeroesMapper;
import xyz.game.datamanage.mapper.SkillMountsMapper;

@ExtendWith(MockitoExtension.class)
class DefaultBasicAttackProvisionerTest {

    private static final String GAME_ID = "lol";

    @Mock
    private PostgresWriteStore writeStore;

    @Mock
    private PostgresReadStore readStore;

    @Mock
    private HeroesMapper heroesMapper;

    @Mock
    private SkillMountsMapper skillMountsMapper;

    private DefaultBasicAttackProvisioner provisioner;
    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        provisioner = new DefaultBasicAttackProvisioner(
            writeStore,
            readStore,
            heroesMapper,
            skillMountsMapper,
            objectMapper
        );
    }

    @Test
    void ensureForGameCreatesHeroMountsWhenHeroRowUsesNonCanonicalMapKeys() {
        stubSharedDefaultsAlreadyPresent();
        when(heroesMapper.listHeroes(GAME_ID)).thenReturn(List.of(
            Map.of("heroid", "hero_ahri"),
            Map.of("hero_id", "hero_ashe"),
            Map.of("HEROID", "hero_garen")
        ));
        when(skillMountsMapper.findSkillMountByNaturalKey(anyString(), anyString(), anyString(), anyString()))
            .thenReturn(null);

        provisioner.ensureForGame(GAME_ID);

        ArgumentCaptor<String> heroIdCaptor = ArgumentCaptor.forClass(String.class);
        verify(writeStore, org.mockito.Mockito.times(3))
            .upsertSkillMount(
                eq(GAME_ID),
                eq("hero"),
                heroIdCaptor.capture(),
                eq(DefaultBasicAttackProvisioner.DEFAULT_BASIC_ATTACK_SKILL_ID),
                any(ObjectNode.class)
            );
        org.junit.jupiter.api.Assertions.assertTrue(heroIdCaptor.getAllValues().contains("hero_ahri"));
        org.junit.jupiter.api.Assertions.assertTrue(heroIdCaptor.getAllValues().contains("hero_ashe"));
        org.junit.jupiter.api.Assertions.assertTrue(heroIdCaptor.getAllValues().contains("hero_garen"));
    }

    @Test
    void ensureForGameSkipsHeroRowsWithoutResolvableHeroId() {
        stubSharedDefaultsAlreadyPresent();
        when(heroesMapper.listHeroes(GAME_ID)).thenReturn(List.of(
            Map.of("name", "Ahri"),
            Map.of("heroId", "hero_ahri")
        ));
        when(skillMountsMapper.findSkillMountByNaturalKey(anyString(), anyString(), anyString(), anyString()))
            .thenReturn(null);

        provisioner.ensureForGame(GAME_ID);

        verify(writeStore).upsertSkillMount(
            eq(GAME_ID),
            eq("hero"),
            eq("hero_ahri"),
            eq(DefaultBasicAttackProvisioner.DEFAULT_BASIC_ATTACK_SKILL_ID),
            any(ObjectNode.class)
        );
        verify(writeStore, never()).upsertSkillMount(
            eq(GAME_ID),
            eq("hero"),
            eq("null"),
            eq(DefaultBasicAttackProvisioner.DEFAULT_BASIC_ATTACK_SKILL_ID),
            any(ObjectNode.class)
        );
    }

    @Test
    void ensureForGameRepairsLegacySharedBasicAttackSkill() {
        stubSharedDefaultsExceptSkill(buildLegacySharedBasicAttackSkill());

        provisioner.ensureForGame(GAME_ID);

        ArgumentCaptor<ObjectNode> skillCaptor = ArgumentCaptor.forClass(ObjectNode.class);
        verify(writeStore).upsertSkill(
            eq(GAME_ID),
            eq(DefaultBasicAttackProvisioner.DEFAULT_BASIC_ATTACK_SKILL_ID),
            skillCaptor.capture()
        );
        ObjectNode dealDamage = findDealDamageAction(skillCaptor.getValue());
        org.junit.jupiter.api.Assertions.assertEquals(
            DefaultBasicAttackProvisioner.DAMAGE_BINDING_KEY,
            dealDamage.path("amount").path("bindingKey").asText()
        );
        org.junit.jupiter.api.Assertions.assertEquals(
            "expected",
            dealDamage.path("crit").path("policy").asText()
        );
        org.junit.jupiter.api.Assertions.assertEquals(
            "attacker_crit_chance",
            dealDamage.path("crit").path("chanceSource").asText()
        );
        org.junit.jupiter.api.Assertions.assertEquals(
            "attacker_crit_damage",
            dealDamage.path("crit").path("multiplierSource").asText()
        );
    }

    @Test
    void ensureForGameUpsertsBaseDamageFormulaBindingWhenLegacyExpectedBindingExists() {
        stubSharedDefaultsAlreadyPresent();
        when(readStore.loadFormulaBinding(
            GAME_ID,
            "skill",
            DefaultBasicAttackProvisioner.DEFAULT_BASIC_ATTACK_SKILL_ID,
            "damage.basic_attack.expected"
        )).thenReturn(objectMapper.createObjectNode().put("formulaId", "formula_lol_basic_attack_damage_expected"));
        when(readStore.loadFormulaBinding(
            GAME_ID,
            "skill",
            DefaultBasicAttackProvisioner.DEFAULT_BASIC_ATTACK_SKILL_ID,
            DefaultBasicAttackProvisioner.DAMAGE_BINDING_KEY
        )).thenReturn(null);

        provisioner.ensureForGame(GAME_ID);

        verify(writeStore).upsertFormulaBinding(
            eq(GAME_ID),
            eq("skill"),
            eq(DefaultBasicAttackProvisioner.DEFAULT_BASIC_ATTACK_SKILL_ID),
            eq(DefaultBasicAttackProvisioner.DAMAGE_BINDING_KEY),
            any(ObjectNode.class)
        );
    }

    @Test
    void ensureForGameUpsertsBaseDamageFormulaProfileWhenLegacyFormulaTextPresent() {
        stubSharedDefaultsAlreadyPresent();
        when(readStore.loadFormulaProfile(GAME_ID, DefaultBasicAttackProvisioner.FORMULA_DAMAGE_ID))
            .thenReturn(buildFormulaProfile(
                "self.attack_damage * (1 + self.crit_chance * (self.crit_damage - 1))"
            ));

        provisioner.ensureForGame(GAME_ID);

        verify(writeStore).upsertFormulaProfile(
            eq(GAME_ID),
            eq(DefaultBasicAttackProvisioner.FORMULA_DAMAGE_ID),
            any(ObjectNode.class)
        );
    }

    private void stubSharedDefaultsAlreadyPresent() {
        stubSharedDefaultsExceptSkill(buildCurrentSharedBasicAttackSkill());
    }

    private void stubSharedDefaultsExceptSkill(ObjectNode skill) {
        when(readStore.loadSkill(GAME_ID, DefaultBasicAttackProvisioner.DEFAULT_BASIC_ATTACK_SKILL_ID))
            .thenReturn(skill);
        when(readStore.loadType(GAME_ID, DefaultBasicAttackProvisioner.BASIC_ATTACK_TYPE_ID))
            .thenReturn(objectMapper.createObjectNode());
        when(readStore.loadTypeRelation(
            GAME_ID,
            DefaultBasicAttackProvisioner.BASIC_ATTACK_TYPE_ID,
            "skill",
            DefaultBasicAttackProvisioner.DEFAULT_BASIC_ATTACK_SKILL_ID
        )).thenReturn(objectMapper.createObjectNode());
        when(readStore.loadFormulaProfile(GAME_ID, DefaultBasicAttackProvisioner.FORMULA_COOLDOWN_ID))
            .thenReturn(buildFormulaProfile(DefaultBasicAttackProvisioner.COOLDOWN_FORMULA_TEXT));
        when(readStore.loadFormulaProfile(GAME_ID, DefaultBasicAttackProvisioner.FORMULA_DAMAGE_ID))
            .thenReturn(buildFormulaProfile(DefaultBasicAttackProvisioner.DAMAGE_FORMULA_TEXT));
        when(readStore.loadFormulaBinding(
            GAME_ID,
            "skill",
            DefaultBasicAttackProvisioner.DEFAULT_BASIC_ATTACK_SKILL_ID,
            "cooldown.basic_attack"
        )).thenReturn(objectMapper.createObjectNode());
        when(readStore.loadFormulaBinding(
            GAME_ID,
            "skill",
            DefaultBasicAttackProvisioner.DEFAULT_BASIC_ATTACK_SKILL_ID,
            DefaultBasicAttackProvisioner.DAMAGE_BINDING_KEY
        )).thenReturn(objectMapper.createObjectNode().put(
            "formulaId",
            DefaultBasicAttackProvisioner.FORMULA_DAMAGE_ID
        ));
        when(readStore.loadFormulaBinding(
            GAME_ID,
            "skill",
            DefaultBasicAttackProvisioner.DEFAULT_BASIC_ATTACK_SKILL_ID,
            "damage.basic_attack.expected"
        )).thenReturn(null);
    }

    private ObjectNode buildCurrentSharedBasicAttackSkill() {
        ObjectNode skill = objectMapper.createObjectNode();
        ObjectNode mechanicsConfig = skill.putObject("mechanicsConfig");
        ObjectNode trigger = mechanicsConfig.putArray("triggers").addObject();
        ObjectNode dealDamage = trigger.putArray("actions").addObject();
        dealDamage.put("type", "deal_damage");
        dealDamage.putObject("amount")
            .put("kind", "formula")
            .put("bindingKey", DefaultBasicAttackProvisioner.DAMAGE_BINDING_KEY);
        ObjectNode crit = dealDamage.putObject("crit");
        crit.put("policy", "expected");
        crit.put("chanceSource", "attacker_crit_chance");
        crit.put("multiplierSource", "attacker_crit_damage");
        skill.putObject("params").putArray("vars");
        return skill;
    }

    private ObjectNode buildLegacySharedBasicAttackSkill() {
        ObjectNode skill = objectMapper.createObjectNode();
        ObjectNode mechanicsConfig = skill.putObject("mechanicsConfig");
        ObjectNode trigger = mechanicsConfig.putArray("triggers").addObject();
        ObjectNode dealDamage = trigger.putArray("actions").addObject();
        dealDamage.put("type", "deal_damage");
        dealDamage.putObject("amount")
            .put("kind", "formula")
            .put("bindingKey", "damage.basic_attack.expected");
        ObjectNode params = skill.putObject("params");
        ObjectNode damageVar = params.putArray("vars").addObject();
        damageVar.put("key", "expected_basic_attack_damage");
        return skill;
    }

    private ObjectNode findDealDamageAction(ObjectNode skill) {
        return (ObjectNode) skill.path("mechanicsConfig").path("triggers").get(0).path("actions").get(0);
    }

    private ObjectNode buildFormulaProfile(String formulaText) {
        ObjectNode profile = objectMapper.createObjectNode();
        profile.putObject("params").put("formulaText", formulaText);
        return profile;
    }
}
