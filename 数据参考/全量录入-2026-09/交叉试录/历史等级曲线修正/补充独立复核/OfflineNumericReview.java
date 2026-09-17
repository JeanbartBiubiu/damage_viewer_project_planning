import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.nio.file.*;import java.util.*;import java.math.*;
import xyz.game.datamanage.support.authoring.SkillNumericSemantics;
import xyz.game.datamanage.support.authoring.SkillObjectReferences;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.*;
import xyz.game.datamanage.support.error.ApiException;

public class OfflineNumericReview {
 static final ObjectMapper M=new ObjectMapper();static final List<Map<String,Object>> checks=new ArrayList<>();
 static final Map<String,JsonNode> current=new LinkedHashMap<>();static final List<JsonNode> updates=new ArrayList<>();
 static final Set<String> diana=Set.of("/skills/diana_p/effects/passive_attack_speed","/skills/diana_p/effects/cast_attack_speed");
 static final String garen="/skills/garen_p/effects/perseverance_regen";
 static void assertTrue(boolean v,String why){if(!v)throw new AssertionError(why);}
 static List<Aggregate> aggregates(Set<String> removed){List<Aggregate> a=new ArrayList<>();for(var e:current.entrySet()){if(removed.contains(e.getKey()))continue;String[] p=e.getKey().split("/");SourceType type=switch(p[3]){case "formulas"->SourceType.FORMULA;case "effects"->SourceType.EFFECT;case "internal-states"->SourceType.STATE;case "processes"->SourceType.PROCESS;case "trigger-rules"->SourceType.TRIGGER;default->null;};if(type!=null)a.add(new Aggregate(type,p[2],p[4],e.getValue()));}return a;}
 static List<SkillNumericSemantics.Parameter> parameters(Set<String> changed){List<SkillNumericSemantics.Parameter> p=new ArrayList<>();for(var e:current.entrySet()){if(!e.getKey().contains("/parameters/"))continue;JsonNode n=e.getValue();if(changed.contains(e.getKey())){JsonNode u=updates.stream().filter(x->x.path("route").asText().equals(e.getKey())).findFirst().orElseThrow();n=u.path("after");}p.add(new SkillNumericSemantics.Parameter(n.path("skillKey").asText(),n.path("parameterKey").asText(),n.path("valueType").asText(),n.path("valueMode").asText(),n.path("fixedValue").isNull()?null:n.path("fixedValue").decimalValue(),n.get("levelValues")));}return p;}
 static void test(String name,Set<String> removed,Set<String> changed,boolean expectedPass,String expectedSkill){try{SkillNumericSemantics.validate(aggregates(removed),parameters(changed));assertTrue(expectedPass,name+" 应拒绝却通过");checks.add(Map.of("name",name,"passed",true,"outcome","ACCEPTED"));}catch(ApiException e){assertTrue(!expectedPass,name+" 意外拒绝 "+e.getCode()+e.getDetails());assertTrue(e.getDetails().toString().contains("RUNTIME_INPUT_FORBIDDEN"),name+" 错误不是动态输入拒绝");assertTrue(e.getDetails().toString().contains(expectedSkill),name+" 拒绝来源错误");checks.add(Map.of("name",name,"passed",true,"outcome","REJECTED_AS_EXPECTED","code",e.getCode(),"details",e.getDetails()));}}
 public static void main(String[] args)throws Exception{
  Path dir=Path.of(args[0]);JsonNode snapshot=M.readTree(dir.resolve("独立实时148GET.json").toFile()),plan=M.readTree(Path.of(args[1]).toFile());
  for(JsonNode r:snapshot.path("reads"))if(r.path("status").asInt()==200&&r.path("route").asText().matches("/skills/[^/]+/(parameters|formulas|effects|processes|internal-states|trigger-rules)/[^/]+"))current.put(r.path("route").asText(),r.path("data"));
  for(JsonNode r:plan.path("requests"))if(r.path("method").asText().equals("PUT"))updates.add(r);assertTrue(updates.size()==4,"4剩余参数");assertTrue(current.size()==70,"6规则已删后70组成");
  Set<String> all=new LinkedHashSet<>();for(JsonNode u:updates)all.add(u.path("route").asText());Set<String> three=new LinkedHashSet<>(diana);three.add(garen);
  test("当前实值70组成通过现行校验",Set.of(),Set.of(),true,"");
  test("原补充6请求反例：Garen间接动态输入仍被拒绝",diana,all,false,"garen_p");
  test("最小再撤Garen动态效果后的67组成通过",three,all,true,"");
  for(JsonNode u:updates){String route=u.path("route").asText();boolean g=route.contains("garen_p");Set<String> removals=route.contains("diana_p")?diana:Set.of();test("逐参数独立检查 "+route,removals,Set.of(route),!g,g?"garen_p":"");}
  String dp="/skills/diana_p/parameters/passive_attack_speed_ratio";
  test("反例：只删Diana直接效果，保留间接公式效果仍拒绝",Set.of("/skills/diana_p/effects/passive_attack_speed"),Set.of(dp),false,"diana_p");
  test("反例：只删Diana公式效果，保留直接效果仍拒绝",Set.of("/skills/diana_p/effects/cast_attack_speed"),Set.of(dp),false,"diana_p");
  List<Aggregate> remaining=aggregates(three);for(Aggregate a:remaining)assertTrue(!Set.of("TRIGGER","PROCESS").contains(a.type().name()),"当前8技能仍有自动消费需要审查");
  checks.add(Map.of("name","最终8技能无过程与触发规则","passed",true));
  Set<Target> targets=new HashSet<>();for(var p:parameters(all))targets.add(new Target(TargetType.PARAMETER,p.skillKey(),p.key(),""));
  JsonNode catalog=M.readTree(dir.resolve("字典与效果图片7GET.json").toFile());
  for(JsonNode row:catalog.path("reads")){String route=row.path("route").asText();TargetType type=switch(route){case "/attributes"->TargetType.ATTRIBUTE;case "/modifier-zones"->TargetType.MODIFIER_ZONE;case "/damage-types"->TargetType.DAMAGE_TYPE;case "/statuses"->TargetType.STATUS;default->null;};if(type==null)continue;String key=switch(type){case ATTRIBUTE->"attributeKey";case MODIFIER_ZONE->"modifierZoneKey";case DAMAGE_TYPE->"damageTypeKey";case STATUS->"statusKey";default->throw new AssertionError();};JsonNode rows=row.path("data").has("items")?row.path("data").path("items"):row.path("data");for(JsonNode item:rows)targets.add(new Target(type,"",item.path(key).asText(),""));}
  List<Reference> refs=SkillObjectReferences.extractAndValidate("lol",remaining,targets);
  checks.add(Map.of("name","实际引用校验：三效果移除后其余67组成无悬空引用","passed",true,"references",refs.size()));
  List<Reference> originalRefs=SkillObjectReferences.extractAndValidate("lol",aggregates(Set.of()),targets);
  for(String target:three){String[] key=target.split("/");List<Reference> incoming=originalRefs.stream().filter(r->r.target().skillKey().equals(key[2])&&r.target().key().equals(key[4])&&Set.of(TargetType.EFFECT,TargetType.RESULT,TargetType.LIFECYCLE).contains(r.target().type())&&!(r.sourceType()==SourceType.EFFECT&&r.sourceSkillKey().equals(key[2])&&r.sourceKey().equals(key[4]))).toList();assertTrue(incoming.isEmpty(),"仍有外部对象引用 "+target);checks.add(Map.of("name","当前效果无外部组成引用 "+target,"passed",true));}
  // 将原已删的初始化规则仅在内存恢复，确认真实引用校验会拒绝移除其目标。
  JsonNode originalPlan=M.readTree(Path.of(args[1]).getParent().resolve("可审查最终请求.json").toFile());JsonNode restored=null;for(JsonNode r:originalPlan.path("requests"))if(r.path("route").asText().equals("/skills/diana_p/trigger-rules/initialize_passive_attack_speed"))restored=r.path("before");assertTrue(restored!=null,"原规则证据存在");List<Aggregate> counter=new ArrayList<>(remaining);counter.add(new Aggregate(SourceType.TRIGGER,"diana_p","initialize_passive_attack_speed",restored));boolean rejected=false;try{SkillObjectReferences.extractAndValidate("lol",counter,targets);}catch(ApiException e){assertTrue(e.getDetails().toString().contains("passive_attack_speed"),"引用反例目标正确");rejected=true;checks.add(Map.of("name","反例：原初始化规则仍在时删除目标被真实引用校验拒绝","passed",true,"code",e.getCode(),"details",e.getDetails()));}assertTrue(rejected,"恢复规则应拒绝悬空");
  // 数学不改：传入已核实际参数后，保留公式读到原有属性；不采用猜测等级表。
  assertTrue(new BigDecimal("0.2").multiply(new BigDecimal("2")).compareTo(new BigDecimal("0.4"))==0,"Diana额外攻速数学");
  assertTrue(new BigDecimal("0.03").multiply(new BigDecimal("2000")).compareTo(new BigDecimal("60"))==0,"Trundle目标最大生命口径");
  Map<String,Object> report=new LinkedHashMap<>();report.put("status","REVISE");report.put("checks",checks);report.put("validator","实际当前 SkillNumericSemantics.java 重新编译，离线直接调用静态validate；不访问数据库，不执行业务写入");report.put("currentComponents",current.size());report.put("proposedSixFinalComponents",68);report.put("correctedSevenFinalComponents",67);report.put("otherUnchanged",57);report.put("blocker",garen+" -> regen_per_5s -> regen_ratio_per_5s，持续当前时点求值禁止运行输入");
  M.writerWithDefaultPrettyPrinter().writeValue(dir.resolve("实际后端校验反例.json").toFile(),report);System.out.println(M.writeValueAsString(Map.of("status","REVISE","checks",checks.size(),"allAssertionsPassed",true,"correctedFinal",67)));
 }
}
