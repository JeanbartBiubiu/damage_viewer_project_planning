import {describe,expect,it} from 'vitest';
import type {SkillConfiguration} from '../types/skillConfiguration';
import type {SimulationSkillSource} from '../types/simulationSnapshot';
import {triggeredEquipmentSimulationSample,recurveBowConfiguration} from '../../tests/fixtures/simulationTriggeredEquipment';
import {naturalRuleKeys,validateSimulationSkillSourceManifest} from './simulationSkillSourceDescription';
import {assembleNaturalSkillSources} from './simulationNaturalSkillSources';
import {validateSimulationSnapshot} from '../services/simulationSnapshotClient';
import {skillFormulaDefinition} from '../../tests/fixtures/skillFormulaDefinition';

function sample(){
  const snapshot=triggeredEquipmentSimulationSample([],[]),skillKey='unreachable_listener';
  const configuration=JSON.parse(JSON.stringify(recurveBowConfiguration()).replaceAll('item_1043_passive',skillKey)) as SkillConfiguration;
  configuration.triggerRules[0]!.eventSource={eventType:'DAMAGE_DEALT',detail:{sourceSkillKey:skillKey,damageTypeKey:null,deliveryKind:'ANY',originKind:'ANY'}};
  snapshot.skillConfigurations.push(configuration);
  const origin={kind:'CHARACTER' as const,characterKey:snapshot.target.character.characterKey};
  const source:SimulationSkillSource={origin,skillKey,skillName:configuration.skill.name,skillStatus:'ENABLED',enabled:true,skillLevel:1,
    enabledRuleKeys:[],inactiveReason:'NO_REACHABLE_EVENT' as SimulationSkillSource['inactiveReason']};
  snapshot.target.attachedSkills.push({...snapshot.target.attachedSkills[0]!,skillKey,skillName:configuration.skill.name});
  snapshot.target.skillSources.push(source);snapshot.selection.targetSkillSettings.push({origin,skillKey,enabled:true,skillLevel:1});
  return {snapshot,configuration,source};
}

describe('完整但本场无事件的伤害监听来源',()=>{
  it.each(['DAMAGE_PENDING','DAMAGE_TAKEN'] as const)('%s仅无真实生产者时允许保留来源而不挂载',eventType=>{
    const {snapshot,configuration}=sample();configuration.triggerRules[0]!.eventSource={eventType,
      detail:{sourceSkillKey:configuration.skill.skillKey,damageTypeKey:null,deliveryKind:'ANY',originKind:'ANY'}};
    expect(()=>assembleNaturalSkillSources(snapshot)).not.toThrow();
  });
  it('严格DTO、空自然根和装配保留启用来源，不挂载或索取事件输入',()=>{
    const {snapshot,configuration,source}=sample(),before=structuredClone(snapshot);
    expect(validateSimulationSnapshot(snapshot,snapshot.gameId,snapshot.selection)).toBe(snapshot);
    expect(naturalRuleKeys(snapshot,configuration,'target',source)).toEqual([]);
    expect(()=>validateSimulationSkillSourceManifest(snapshot)).not.toThrow();
    const natural=assembleNaturalSkillSources(snapshot);
    expect(natural.providers).toEqual([]);expect(natural.mounts).toEqual([]);expect([...natural.required.target]).toEqual([]);
    expect(natural.origins.find(row=>row.skillKey===source.skillKey)).toMatchObject({enabled:true,inactiveReason:'NO_REACHABLE_EVENT'});
    expect(natural.origins.find(row=>row.skillKey===source.skillKey)?.providerRef).toBeUndefined();expect(snapshot).toEqual(before);
  });
  it('运行时参数声明不索取假默认；实际等级参数必须完整',()=>{
    const {snapshot,configuration}=sample(),parameter=configuration.parameters[0]!;
    parameter.valueMode='RUNTIME_INPUT';parameter.fixedValue=null;parameter.levelValues=null;
    expect(()=>assembleNaturalSkillSources(snapshot)).not.toThrow();
    parameter.valueMode='SKILL_LEVEL';parameter.levelValues={'1':15};
    expect(()=>assembleNaturalSkillSources(snapshot)).not.toThrow();
    parameter.levelValues={};expect(()=>assembleNaturalSkillSources(snapshot)).toThrow();
  });
  it('外部技能仅需实际定义，未驱动或关闭的外部来源不被授执行',()=>{
    const {snapshot,configuration}=sample(),rule=configuration.triggerRules[0]!;
    if(rule.eventSource.eventType!=='DAMAGE_DEALT')throw new Error('需要伤害监听');
    rule.eventSource.detail.sourceSkillKey=snapshot.selection.basicAttackSkillKey;
    expect(()=>assembleNaturalSkillSources(snapshot)).not.toThrow();
    const result={...configuration.effects[0]!.results[0]!,resultType:'COOLDOWN_CHANGE' as const,
      detail:{operation:'REDUCE_TOTAL_RATIO' as const,affectedSkillScope:{mode:'SKILLS' as const,skillKeys:[snapshot.selection.basicAttackSkillKey!],skillCategoryKeys:[]}}};
    configuration.effects[0]!.results[0]=result;
    expect(()=>assembleNaturalSkillSources(snapshot)).not.toThrow();
    result.detail.affectedSkillScope.skillKeys=['missing_external'];expect(()=>assembleNaturalSkillSources(snapshot)).toThrow();
  });
  it('外部定义须全局可用，场景关闭来源仍只作只读定义',()=>{
    const {snapshot,configuration}=sample(),key='disabled_external';
    const external={...structuredClone(configuration),skill:{...configuration.skill,skillKey:key,status:'ENABLED'}};
    external.parameters=[];external.formulas=[];external.effects=[];external.processes=[];external.internalStates=[];external.triggerRules=[];
    snapshot.skillConfigurations.push(external);
    snapshot.target.attachedSkills.push({...snapshot.target.attachedSkills[0]!,skillKey:key,skillName:key,skillStatus:'ENABLED'});
    snapshot.target.skillSources.push({origin:{kind:'CHARACTER',characterKey:snapshot.target.character.characterKey},skillKey:key,skillName:key,
      skillStatus:'ENABLED',enabled:false,skillLevel:1,enabledRuleKeys:[],inactiveReason:'SCENE_DISABLED'});
    snapshot.selection.targetSkillSettings.push({origin:{kind:'CHARACTER',characterKey:snapshot.target.character.characterKey},skillKey:key,enabled:false,skillLevel:1});
    const rule=configuration.triggerRules[0]!;if(rule.eventSource.eventType!=='DAMAGE_DEALT')throw new Error('需要逐伤监听');
    rule.eventSource.detail.sourceSkillKey=key;
    expect(()=>assembleNaturalSkillSources(snapshot)).not.toThrow();
    external.skill.status='DISABLED';snapshot.target.attachedSkills.find(row=>row.skillKey===key)!.skillStatus='DISABLED';
    const source=snapshot.target.skillSources.find(row=>row.skillKey===key)!;source.skillStatus='DISABLED';source.inactiveReason='GLOBAL_DISABLED';
    expect(()=>assembleNaturalSkillSources(snapshot)).toThrow();
  });
  for(const kind of ['keys','empty_rules','empty_actions','wrong_action','empty_results','missing_effect','duplicate_effect','missing_parameter','duplicate_parameter','missing_fixed',
    'missing_formula','duplicate_formula','formula_parameter','formula_syntax','formula_metadata','effect_metadata','missing_external','source_init','received','dealt_reachable','pending_reachable','taken_reachable','character_level_value','skill_level_value',
    'level0','levelnull','levelhigh','disabled','incomplete'] as const){
    it(`拒绝伪不可达原因：${kind}`,()=>{
      const {snapshot,configuration,source}=sample(),rule=configuration.triggerRules[0]!,parameter=configuration.parameters[0]!;
      if(kind==='keys')source.enabledRuleKeys=[rule.ruleKey];
      if(kind==='empty_rules')configuration.triggerRules=[];
      if(kind==='empty_actions')rule.actions=[];
      if(kind==='wrong_action')rule.actions=[{...rule.actions[0]!,actionType:'START_PROCESS',detail:{processKey:'missing'}}];
      if(kind==='empty_results')configuration.effects[0]!.results=[];
      if(kind==='missing_effect')configuration.effects=[];
      if(kind==='duplicate_effect')configuration.effects.push(structuredClone(configuration.effects[0]!));
      if(kind==='missing_parameter')configuration.parameters=[];
      if(kind==='duplicate_parameter')configuration.parameters.push(structuredClone(parameter));
      if(kind==='missing_fixed')parameter.fixedValue=null;
      if(['missing_formula','duplicate_formula','formula_parameter','formula_syntax','formula_metadata'].includes(kind)){
        configuration.effects[0]!.results[0]!.valueRule!.value={kind:'FORMULA',formulaKey:'amount'};
        const formula={gameId:snapshot.gameId,skillKey:source.skillKey,formulaKey:'amount',name:'定义证明',description:null,sortOrder:0,createdAt:'',updatedAt:'',
          expression:skillFormulaDefinition(source.skillKey,{nodeType:'PARAMETER',parameterKey:kind==='formula_parameter'?'missing':'on_hit_damage'})};
        if(kind!=='missing_formula')configuration.formulas=[formula,formula];
        if(kind==='formula_parameter'||kind==='formula_syntax'||kind==='formula_metadata')configuration.formulas=[formula];
        if(kind==='formula_syntax')formula.expression.inputs=[];
        if(kind==='formula_metadata')formula.skillKey='other';
      }
      if(kind==='effect_metadata')configuration.effects[0]!.skillKey='other';
      if(kind==='missing_external'&&rule.eventSource.eventType==='DAMAGE_DEALT')rule.eventSource.detail.sourceSkillKey='missing_external';
      if(kind==='source_init')configuration.triggerRules.push({...structuredClone(rule),ruleKey:'init',eventSource:{eventType:'SOURCE_INITIALIZED',detail:{}}});
      if(kind==='received')rule.eventSource={eventType:'BASIC_ATTACK_RECEIVED',detail:{}};
      if(kind==='dealt_reachable'){
        snapshot.target.skillSources.pop();snapshot.target.attachedSkills.pop();snapshot.selection.targetSkillSettings.pop();
        source.origin={kind:'CHARACTER',characterKey:snapshot.source.character.characterKey};snapshot.source.skillSources.push(source);
        snapshot.source.attachedSkills.push({...snapshot.source.attachedSkills[0]!,skillKey:source.skillKey,skillName:source.skillName});
        snapshot.selection.sourceSkillSettings.push({origin:source.origin,skillKey:source.skillKey,enabled:true,skillLevel:1});
        if(rule.eventSource.eventType==='DAMAGE_DEALT')rule.eventSource.detail.sourceSkillKey=snapshot.selection.basicAttackSkillKey;
      }
      if(kind==='pending_reachable'||kind==='taken_reachable')rule.eventSource={eventType:kind==='pending_reachable'?'DAMAGE_PENDING':'DAMAGE_TAKEN',
        detail:{sourceSkillKey:snapshot.selection.basicAttackSkillKey,damageTypeKey:null,deliveryKind:'ANY',originKind:'ANY'}};
      if(kind==='level0')source.skillLevel=0;
      if(kind==='levelnull')source.skillLevel=null;
      if(kind==='levelhigh')source.skillLevel=2;
      if(kind==='character_level_value'||kind==='skill_level_value'){parameter.valueMode=kind==='skill_level_value'?'SKILL_LEVEL':'CHARACTER_LEVEL';parameter.fixedValue=null;parameter.levelValues={};}
      if(kind==='disabled'){source.enabled=false;snapshot.selection.targetSkillSettings.find(row=>row.skillKey===source.skillKey)!.enabled=false;}
      if(kind==='incomplete')source.inactiveReason='CONFIGURATION_INCOMPLETE';
      expect(()=>assembleNaturalSkillSources(snapshot)).toThrow();
    });
  }
  it('DTO只接启用有效等级且空keys的新原因，所选普攻不能借原因关闭',()=>{
    for(const kind of ['off','zero','null','high','keys','global','selected'] as const){
      const {snapshot,source,configuration}=sample();
      if(kind==='off'){source.enabled=false;snapshot.selection.targetSkillSettings.find(row=>row.skillKey===source.skillKey)!.enabled=false;}
      if(kind==='zero')source.skillLevel=0;
      if(kind==='null')source.skillLevel=null;
      if(kind==='high')source.skillLevel=configuration.skill.maxLevel+1;
      if(kind==='keys')source.enabledRuleKeys=[configuration.triggerRules[0]!.ruleKey];
      if(kind==='global'){source.skillStatus='DISABLED';snapshot.target.attachedSkills.find(row=>row.skillKey===source.skillKey)!.skillStatus='DISABLED';configuration.skill.status='DISABLED';}
      if(kind==='selected'){snapshot.source.skillSources[0]!.inactiveReason='NO_REACHABLE_EVENT';snapshot.source.skillSources[0]!.enabledRuleKeys=[];}
      expect(()=>validateSimulationSnapshot(snapshot,snapshot.gameId,snapshot.selection),kind).toThrow();
    }
  });
});
