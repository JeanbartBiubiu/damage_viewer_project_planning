package xyz.game.datamanage.service.skillformula;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static xyz.game.datamanage.support.formula.SkillFormulaFixtures.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skillformula.SkillFormulaMapper;
import xyz.game.datamanage.model.skill.*;
import xyz.game.datamanage.model.skillformula.*;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class SkillFormulaServiceTest {
    static final String GAME="lol", SKILL="varus_w", KEY="damage";
    static final OffsetDateTime TIME=OffsetDateTime.parse("2026-08-26T08:00:00Z");
    @Mock GamesMapper games;
    @Mock SkillMapper skills;
    @Mock SkillFormulaMapper formulas;
    @Mock GameConfigurationWriteGuard guard;
    SkillFormulaService service;
    @BeforeEach void setup(){service=new SkillFormulaService(
            games,
            skills,
            formulas,
            org.mockito.Mockito.mock(xyz.game.datamanage.service.skilltrigger.reference.SkillTriggerReferenceGuard.class),
            guard
        );lenient().when(games.countGames(GAME)).thenReturn(1L);}
    static SkillRow skill(){return new SkillRow(GAME,SKILL,"技能",null,5,SkillStatus.ENABLED,1,TIME,TIME);}
    static SkillFormulaRow row(JsonNode definition){return new SkillFormulaRow(GAME,SKILL,KEY,"伤害",null,1,definition.toString(),TIME,TIME);}
    static SkillFormulaCreateRequest create(JsonNode definition){return new SkillFormulaCreateRequest(KEY,"伤害",null,1,definition);}
    static void issue(Runnable action,String code,String path){ApiException error=assertThrows(ApiException.class,action::run);assertTrue(error.getDetails().toString().contains(code),error.getDetails().toString());assertTrue(error.getDetails().toString().contains(path),error.getDetails().toString());}

    @Test void listAndMissingParents(){when(skills.findById(GAME,SKILL)).thenReturn(skill());when(formulas.listSummaries(GAME,SKILL)).thenReturn(List.of(row(constant("1"))));assertEquals(KEY,service.list(GAME,SKILL).getFirst().formulaKey());assertEquals("404.SKILL_NOT_FOUND",assertThrows(ApiException.class,()->service.list(GAME,"missing")).getCode());}
    @Test void createPersistsCompleteDefinitionAndDecimalText(){when(skills.findByIdForUpdate(GAME,SKILL)).thenReturn(skill());ObjectNode definition=constant("123456789.0000000000000000001");AtomicReference<String> saved=new AtomicReference<>();when(formulas.insert(eq(GAME),eq(SKILL),eq(KEY),eq("伤害"),isNull(),eq(1),anyString())).thenAnswer(call->{saved.set(call.getArgument(6));return 1;});when(formulas.findById(GAME,SKILL,KEY)).thenAnswer(call->new SkillFormulaRow(GAME,SKILL,KEY,"伤害",null,1,saved.get(),TIME,TIME));assertEquals(definition,service.create(GAME,SKILL,create(definition)).expression());assertEquals("123456789.0000000000000000001",AggregateJson.tree(saved.get()).path("stages").get(0).path("expression").path("value").asText());verify(guard).begin(GAME);}
    @Test void candidateIncludesSameWriteNewParameterAndExcludesDeleted(){service.validateConfigurationCreate(GAME,SKILL,create(parameter(SKILL,"new")),Set.of("new"));issue(()->service.validateConfigurationCreate(GAME,SKILL,create(parameter(SKILL,"gone")),Set.of("new")),"UNKNOWN_SKILL_PARAMETER","/expression/inputs/0/binding/parameterKey");verify(formulas,never()).findExistingParameterKeys(any(),any(),any());}
    @Test void finalReferencesProtectUnusedDeclarations(){ObjectNode definition=constant("1");definition.withArray("inputs").addObject().put("key","unused").putObject("binding").put("kind","parameter").put("skillKey",SKILL).put("parameterKey","gone");issue(()->service.validateFinalParameterReferences(GAME,SKILL,Map.of(KEY,definition),Set.of()),"UNKNOWN_SKILL_PARAMETER","inputs/0");}
    @Test void sameWriteRewriteAndDeletionUsesFinalSet(){service.validateFinalParameterReferences(GAME,SKILL,Map.of(KEY,parameter(SKILL,"new")),Set.of("new"));service.validateFinalParameterReferences(GAME,SKILL,Map.of(),Set.of());}
    @Test void foreignSameNameAndContextAndViewsAreNotAuthorized(){issue(()->service.validateConfigurationCreate(GAME,SKILL,create(parameter("foreign","p")),Set.of("p")),"FORMULA_UNKNOWN_BINDING","/expression/inputs/0/binding");ObjectNode owner=attribute("owner","hp","MAX");issue(()->service.validateConfigurationCreate(GAME,SKILL,create(owner),Set.of()),"FORMULA_UNKNOWN_BINDING","/expression/inputs/0/binding");ObjectNode definition=attribute("source","hp","MAX");((ObjectNode)definition.path("inputs").get(0).path("binding")).put("view","event_snapshot");ObjectNode frozen=definition;issue(()->service.validateConfigurationCreate(GAME,SKILL,create(frozen),Set.of()),"FORMULA_UNKNOWN_BINDING","/expression/inputs/0/binding");ObjectNode context=input(AggregateJson.tree("{\"kind\":\"context\",\"contextKey\":\"p\"}"));issue(()->service.validateConfigurationCreate(GAME,SKILL,create(context),Set.of()),"FORMULA_UNKNOWN_BINDING","/expression/inputs/0/binding");}
    @Test void eightAttributeKindsAndBothObjectsUseRealEnabledCatalog(){when(formulas.findAttributesByKeys(eq(GAME),anyCollection())).thenReturn(List.of(new SkillFormulaAttributeStatusRow("hp","ENABLED")));for(String object:List.of("source","target"))for(String kind:List.of("BASE","BONUS","TOTAL","CURRENT","MAX","MISSING","CURRENT_RATIO","MISSING_RATIO"))service.validateConfigurationCreate(GAME,SKILL,create(attribute(object,"hp",kind)),Set.of());}
    @Test void oldTreeAndUnknownFieldsAreRejected(){issue(()->service.validateConfigurationCreate(GAME,SKILL,create(AggregateJson.tree("{\"nodeType\":\"PARAMETER\",\"parameterKey\":\"p\"}")),Set.of("p")),"FORMULA_INVALID_STRUCTURE","/expression");ObjectNode definition=constant("1");definition.put("default",0);issue(()->service.validateConfigurationCreate(GAME,SKILL,create(definition),Set.of()),"FORMULA_INVALID_STRUCTURE","/expression/default");}
    @Test void sixtyFourDeclarationsPassAndSixtyFiveFail(){ObjectNode definition=constant("1");Set<String> keys=new LinkedHashSet<>();for(int i=0;i<64;i++){String key="p"+i;keys.add(key);definition.withArray("inputs").addObject().put("key",key).putObject("binding").put("kind","parameter").put("skillKey",SKILL).put("parameterKey",key);}service.validateConfigurationCreate(GAME,SKILL,create(definition),keys);definition.withArray("inputs").add(definition.path("inputs").get(0).deepCopy());issue(()->service.validateConfigurationCreate(GAME,SKILL,create(definition),keys),"FORMULA_INVALID_STRUCTURE","/expression/inputs");}
    @Test void readRetainsDisabledDependencyButAnyNewSaveRequiresEnabled(){ObjectNode definition=attribute("source","hp","TOTAL");when(skills.findById(GAME,SKILL)).thenReturn(skill());when(formulas.findById(GAME,SKILL,KEY)).thenReturn(row(definition));assertEquals(definition,service.get(GAME,SKILL,KEY).expression());when(formulas.findAttributesByKeys(eq(GAME),anyCollection())).thenReturn(List.of(new SkillFormulaAttributeStatusRow("hp","DISABLED")));assertEquals("409.FORMULA_ATTRIBUTE_DISABLED",assertThrows(ApiException.class,()->service.validateConfigurationUpdate(GAME,SKILL,KEY,new SkillFormulaUpdateRequest(null,"伤害",null,1,definition),Set.of())).getCode());}
    @Test void missingActualParameterOrAttributeRejectsBeforeInsert(){when(skills.findByIdForUpdate(GAME,SKILL)).thenReturn(skill());issue(()->service.create(GAME,SKILL,create(parameter(SKILL,"missing"))),"UNKNOWN_SKILL_PARAMETER","parameterKey");issue(()->service.create(GAME,SKILL,create(attribute("source","absent","TOTAL"))),"UNKNOWN_ATTRIBUTE","attributeKey");verify(formulas,never()).insert(any(),any(),any(),any(),any(),any(),any());}
    @Test void brokenStoredDefinitionReturnsCorruptionError(){when(skills.findById(GAME,SKILL)).thenReturn(skill());when(formulas.findById(GAME,SKILL,KEY)).thenReturn(row(parameter("foreign","same")));assertEquals("500.INTERNAL_ERROR",assertThrows(ApiException.class,()->service.get(GAME,SKILL,KEY)).getCode());}
    @Test void primaryKeyAndImmutableAndDeleteGuardStay(){when(skills.findByIdForUpdate(GAME,SKILL)).thenReturn(skill());when(formulas.insert(any(),any(),any(),any(),any(),any(),any())).thenThrow(new DataIntegrityViolationException("pk_skill_formulas"));assertEquals("409.SKILL_FORMULA_KEY_EXISTS",assertThrows(ApiException.class,()->service.create(GAME,SKILL,create(constant("1")))).getCode());issue(()->service.validateConfigurationUpdate(GAME,SKILL,KEY,new SkillFormulaUpdateRequest(KEY,"伤害",null,1,constant("1")),Set.of()),"IMMUTABLE","formulaKey");when(formulas.findByIdForUpdate(GAME,SKILL,KEY)).thenReturn(row(constant("1")));when(formulas.delete(GAME,SKILL,KEY)).thenReturn(1);service.delete(GAME,SKILL,KEY);verify(guard).assertNotReferenced(GAME,"FORMULA",SKILL,KEY,"409.SKILL_FORMULA_IN_USE","技能公式已被引用，不能删除");}
    @Test void supplyIgnoresUnusedAndIncludesBothIfBranches(){ObjectNode definition=constant("1");for(String key:List.of("unused","left","right"))definition.withArray("inputs").addObject().put("key",key).putObject("binding").put("kind","parameter").put("skillKey",SKILL).put("parameterKey",key);((ObjectNode)definition.path("stages").get(0)).set("expression",AggregateJson.tree("{\"op\":\"if\",\"args\":[{\"op\":\"const\",\"value\":\"1\"},{\"op\":\"read\",\"inputKey\":\"left\"},{\"op\":\"read\",\"inputKey\":\"right\"}]}"));assertFalse(service.referencesAnyParameter(definition,Set.of("unused")));assertTrue(service.referencesAnyParameter(definition,Set.of("left")));assertTrue(service.referencesAnyParameter(definition,Set.of("right")));}
}