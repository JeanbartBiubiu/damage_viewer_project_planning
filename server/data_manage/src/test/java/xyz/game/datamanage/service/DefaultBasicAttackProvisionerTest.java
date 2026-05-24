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

    @BeforeEach
    void setUp() {
        provisioner = new DefaultBasicAttackProvisioner(
            writeStore,
            readStore,
            heroesMapper,
            skillMountsMapper,
            new ObjectMapper()
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

    private void stubSharedDefaultsAlreadyPresent() {
        when(readStore.loadSkill(GAME_ID, DefaultBasicAttackProvisioner.DEFAULT_BASIC_ATTACK_SKILL_ID))
            .thenReturn(new ObjectMapper().createObjectNode());
        when(readStore.loadType(GAME_ID, DefaultBasicAttackProvisioner.BASIC_ATTACK_TYPE_ID))
            .thenReturn(new ObjectMapper().createObjectNode());
        when(readStore.loadTypeRelation(
            GAME_ID,
            DefaultBasicAttackProvisioner.BASIC_ATTACK_TYPE_ID,
            "skill",
            DefaultBasicAttackProvisioner.DEFAULT_BASIC_ATTACK_SKILL_ID
        )).thenReturn(new ObjectMapper().createObjectNode());
        when(readStore.loadFormulaProfile(GAME_ID, DefaultBasicAttackProvisioner.FORMULA_COOLDOWN_ID))
            .thenReturn(buildFormulaProfile(DefaultBasicAttackProvisioner.COOLDOWN_FORMULA_TEXT));
        when(readStore.loadFormulaProfile(GAME_ID, DefaultBasicAttackProvisioner.FORMULA_DAMAGE_ID))
            .thenReturn(buildFormulaProfile(DefaultBasicAttackProvisioner.DAMAGE_FORMULA_TEXT));
        when(readStore.loadFormulaBinding(
            GAME_ID,
            "skill",
            DefaultBasicAttackProvisioner.DEFAULT_BASIC_ATTACK_SKILL_ID,
            "cooldown.basic_attack"
        )).thenReturn(new ObjectMapper().createObjectNode());
        when(readStore.loadFormulaBinding(
            GAME_ID,
            "skill",
            DefaultBasicAttackProvisioner.DEFAULT_BASIC_ATTACK_SKILL_ID,
            "damage.basic_attack.expected"
        )).thenReturn(new ObjectMapper().createObjectNode());
    }

    private ObjectNode buildFormulaProfile(String formulaText) {
        ObjectNode profile = new ObjectMapper().createObjectNode();
        profile.putObject("params").put("formulaText", formulaText);
        return profile;
    }
}
