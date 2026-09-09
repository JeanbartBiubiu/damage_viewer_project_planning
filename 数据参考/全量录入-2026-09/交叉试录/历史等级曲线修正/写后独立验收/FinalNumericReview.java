import com.fasterxml.jackson.databind.*;import java.nio.file.*;import java.util.*;
import xyz.game.datamanage.support.authoring.SkillNumericSemantics;
import xyz.game.datamanage.support.authoring.SkillObjectReferences;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.*;
public class FinalNumericReview {
 public static void main(String[] args)throws Exception{
  Path dir=Path.of(args[0]);ObjectMapper m=new ObjectMapper();JsonNode source=m.readTree(dir.resolve("实际修正后独立回读.json").toFile());OfflineNumericReview.current.clear();
  for(JsonNode r:source.path("reads"))if(r.path("status").asInt()==200&&r.path("route").asText().matches("/skills/[^/]+/(parameters|formulas|effects|processes|internal-states|trigger-rules)/[^/]+"))OfflineNumericReview.current.put(r.path("route").asText(),r.path("data"));
  if(OfflineNumericReview.current.size()!=67)throw new AssertionError("实际应67组成");List<Aggregate> aggregates=OfflineNumericReview.aggregates(Set.of());var params=OfflineNumericReview.parameters(Set.of());
  SkillNumericSemantics.validate(aggregates,params);
  Set<Target> targets=new HashSet<>();for(var p:params)targets.add(new Target(TargetType.PARAMETER,p.skillKey(),p.key(),""));
  for(JsonNode r:source.path("reads")){String route=r.path("route").asText();TargetType type=switch(route){case "/attributes"->TargetType.ATTRIBUTE;case "/modifier-zones"->TargetType.MODIFIER_ZONE;case "/damage-types"->TargetType.DAMAGE_TYPE;case "/statuses"->TargetType.STATUS;default->null;};if(type==null)continue;String key=switch(type){case ATTRIBUTE->"attributeKey";case MODIFIER_ZONE->"modifierZoneKey";case DAMAGE_TYPE->"damageTypeKey";case STATUS->"statusKey";default->throw new AssertionError();};JsonNode rows=r.path("data").has("items")?r.path("data").path("items"):r.path("data");for(JsonNode row:rows)targets.add(new Target(type,"",row.path(key).asText(),""));}
  var refs=SkillObjectReferences.extractAndValidate("lol",aggregates,targets);for(var a:aggregates)if(a.type()==SourceType.PROCESS||a.type()==SourceType.TRIGGER)throw new AssertionError("仍有自动引用需检查");
  Map<String,Object> report=new LinkedHashMap<>();report.put("status","PASS");report.put("source","本轮重新真实155GET中的67实际组成和4当前字典；未用模拟替换或原执行流水");report.put("components",67);report.put("formulaEffectEtcAggregates",aggregates.size());report.put("parameters",params.size());report.put("references",refs.size());report.put("numericValidationPassed",true);report.put("referenceValidationPassed",true);report.put("noProcessesOrTriggers",true);report.put("businessWrites",0);report.put("runtimeExecution",false);report.put("method","重新编译当前生产数值与引用校验类，直接离线调用实际最终对象");
  m.writerWithDefaultPrettyPrinter().writeValue(dir.resolve("实际最终67组成后端校验.json").toFile(),report);System.out.println(m.writeValueAsString(report));
 }
}
