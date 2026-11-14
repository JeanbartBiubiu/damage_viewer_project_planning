package xyz.game.datamanage.service.simulation.availability;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.simulation.SimulationAvailabilityMapper;
import xyz.game.datamanage.mapper.simulation.SimulationAvailabilityMapper.Row;
import xyz.game.datamanage.model.simulation.SimulationAvailabilityResponse;
import xyz.game.datamanage.model.simulation.SimulationAvailabilityResponse.Entry;
import xyz.game.datamanage.model.simulation.SimulationAvailabilityResponse.ExcludedSkillSource;
import xyz.game.datamanage.model.simulation.SimulationAvailabilityResponse.Issue;
import xyz.game.datamanage.model.simulation.SimulationAvailabilityResponse.Status;
import xyz.game.datamanage.model.simulation.SimulationAvailabilityResponse.Verification;
import xyz.game.datamanage.service.simulation.availability.SimulationAvailabilityResources.Document;
import xyz.game.datamanage.support.error.ApiException;

import static xyz.game.datamanage.service.simulation.availability.SimulationAvailabilityResources.DIGEST_VERSION;
import static xyz.game.datamanage.service.simulation.availability.SimulationAvailabilityResources.PROFILE;

/** 管理只读目录，不执行公式和伤害，不把结构检查当作战斗证明。 */
@Service
public class SimulationAvailabilityService {
    private final GamesMapper games;
    private final SimulationAvailabilityMapper mapper;
    private final SimulationAvailabilityResources resources;
    private final ObjectMapper json;

    public SimulationAvailabilityService(GamesMapper games, SimulationAvailabilityMapper mapper,
                                         SimulationAvailabilityResources resources, ObjectMapper json) {
        this.games = games; this.mapper = mapper; this.resources = resources; this.json = json;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public SimulationAvailabilityResponse get(String gameId, String wasmSha256, String adapterVersion) {
        if (gameId == null || !gameId.matches("[a-z][a-z0-9_]{0,63}") || wasmSha256 == null
            || !wasmSha256.matches("[0-9a-fA-F]{64}") || adapterVersion == null || adapterVersion.isBlank()
            || adapterVersion.length() > 128 || adapterVersion.chars().anyMatch(Character::isISOControl)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "400.VALIDATION_FAILED", "必须提供合法游戏标识、正式Wasm摘要和适配器版本");
        }
        Long count = games.countGames(gameId);
        if (count == null || count == 0) throw new ApiException(HttpStatus.NOT_FOUND, "404.GAME_NOT_FOUND", "游戏不存在");
        Snapshot snapshot = new Snapshot(gameId, mapper.readGameRows(gameId));
        Document scope = resources.scope(gameId);
        Document proof = resources.verification(gameId);
        String scopeDigest = digest(identity(gameId).set("scope", scope.valid() ? scope.value() : json.nullNode()));
        String sharedDigest = digest(identity(gameId).set("shared", snapshot.shared()));
        String wasm = wasmSha256.toLowerCase(Locale.ROOT);
        List<Entry> characters = entries("CHARACTER", "characters", snapshot, scope, proof, scopeDigest, sharedDigest, wasm, adapterVersion);
        List<Entry> equipment = entries("EQUIPMENT", "equipment", snapshot, scope, proof, scopeDigest, sharedDigest, wasm, adapterVersion);
        return new SimulationAvailabilityResponse(gameId, PROFILE, DIGEST_VERSION, scopeDigest, sharedDigest, characters, equipment);
    }

    private List<Entry> entries(String kind, String scopeList, Snapshot snapshot, Document scope, Document proof,
                                String scopeDigest, String sharedDigest, String wasm, String adapterVersion) {
        Map<String, JsonNode> scoped = new TreeMap<>();
        if (scope.valid()) scope.value().path(scopeList).forEach(item -> scoped.put(item.path("key").asText(), item));
        Set<String> keys = new TreeSet<>(scoped.keySet());
        snapshot.rows(kind).forEach(row -> keys.add(row.key()));
        List<Entry> result = new ArrayList<>();
        for (String key : keys) {
            JsonNode definition = scoped.get(key);
            List<DataRow> own = snapshot.ownedRows(kind, key);
            Set<String> directSkills = new TreeSet<>();
            snapshot.owned(kind + "_BINDING", key).forEach(row -> directSkills.add(row.key()));
            List<ExcludedSkillSource> excludedSources = new ArrayList<>();
            if (definition != null && "CHARACTER".equals(kind)) {
                for (JsonNode skill : definition.path("expectedSkills")) {
                    if (skill.path("excluded").asBoolean(false)) {
                        for (String current : SimulationAvailabilityResources.currentSkillKeys(skill)) {
                            if (directSkills.contains(current)) excludedSources.add(new ExcludedSkillSource(
                                current, skill.path("exclusion").path("reason").asText()));
                        }
                    }
                }
            }
            Set<String> closure = snapshot.skillClosure(directSkills);
            ArrayNode ownSkills = snapshot.skills(closure);
            Set<String> externalSkills = new TreeSet<>(closure);
            externalSkills.removeAll(directSkills);
            String externalDigest = digest(identity(snapshot.gameId).set("skills", snapshot.skills(externalSkills)));
            ObjectNode content = identity(snapshot.gameId).put("kind", kind).put("key", key)
                .put("scopeDigest", scopeDigest).put("sharedDigest", sharedDigest).put("externalDigest", externalDigest);
            content.set("own", snapshot.serialize(own));
            content.set("skills", ownSkills);
            String contentDigest = digest(content);
            if (!scope.valid()) {
                result.add(entry(key, Status.UNVERIFIED, contentDigest, List.of(issue(scope.issueCode(), null, "scope", "当前优先范围缺失或损坏，不能确认计算可用性")),
                    wasm, adapterVersion, externalDigest, null, false, List.of(), excludedSources));
                continue;
            }
            if (definition == null) {
                result.add(entry(key, Status.OUT_OF_SCOPE, contentDigest, List.of(issue("OUT_OF_SCOPE", null, "scope", "未在当前优先录入范围内")),
                    wasm, adapterVersion, externalDigest, null, false, List.of(), excludedSources));
                continue;
            }
            List<Issue> issues = snapshot.diagnose(kind, key, definition, directSkills, closure);
            JsonNode coverage = snapshot.coverage(kind, definition, closure);
            if (!issues.isEmpty()) {
                result.add(entry(key, Status.CONFIGURATION_INCOMPLETE, contentDigest, issues, wasm, adapterVersion, externalDigest, coverage, false, List.of(), excludedSources));
                continue;
            }
            String proofIssue = proof.issueCode();
            JsonNode candidate = null;
            if (proof.valid()) {
                JsonNode root = proof.value();
                if (!scopeDigest.equals(root.path("scopeDigest").asText()) || !sharedDigest.equals(root.path("sharedDigest").asText())
                    || !wasm.equals(root.path("wasmSha256").asText()) || !adapterVersion.equals(root.path("adapterVersion").asText())) {
                    proofIssue = "VERIFICATION_STALE";
                } else {
                    for (JsonNode item : root.path("entries")) {
                        if (kind.equals(item.path("kind").asText()) && key.equals(item.path("key").asText())) { candidate = item; break; }
                    }
                    if (candidate == null) proofIssue = "VERIFICATION_NOT_FOUND";
                    else if (!contentDigest.equals(candidate.path("contentDigest").asText()) || !externalDigest.equals(candidate.path("externalDigest").asText())) proofIssue = "VERIFICATION_STALE";
                    else if (!SimulationAvailabilityResources.coverageMatches(json, coverage, candidate)) proofIssue = "VERIFICATION_COVERAGE_INCOMPLETE";
                }
            }
            if (proofIssue != null || candidate == null) {
                result.add(entry(key, Status.UNVERIFIED, contentDigest, List.of(issue(proofIssue == null ? "VERIFICATION_NOT_FOUND" : proofIssue, null,
                    "verification", "缺少与当前完整范围、数据、双方位置和等级覆盖一致的正式计算证明")),
                    wasm, adapterVersion, externalDigest, coverage, false, List.of(), excludedSources));
                continue;
            }
            List<String> evidence = new ArrayList<>();
            candidate.path("evidenceRefs").forEach(value -> evidence.add(value.textValue()));
            if ("ENGINE_UNSUPPORTED".equals(candidate.path("outcome").asText())) {
                List<Issue> failures = new ArrayList<>();
                candidate.path("issues").forEach(value -> failures.add(new Issue(value.path("code").textValue(), nullable(value.get("skillKey")),
                    nullable(value.get("fieldPath")), value.path("message").textValue())));
                result.add(entry(key, Status.ENGINE_UNSUPPORTED, contentDigest, failures, wasm, adapterVersion, externalDigest, coverage, true, evidence, excludedSources));
            } else {
                result.add(entry(key, Status.READY, contentDigest, List.of(), wasm, adapterVersion, externalDigest, coverage, true, evidence, excludedSources));
            }
        }
        return List.copyOf(result);
    }

    private static Entry entry(String key, Status status, String digest, List<Issue> issues, String wasm, String adapter,
                               String external, JsonNode coverage, boolean matched, List<String> evidence, List<ExcludedSkillSource> excludedSources) {
        return new Entry(key, status, digest, List.copyOf(issues), new Verification(wasm, adapter, external, coverage, matched, List.copyOf(evidence)),
            List.copyOf(excludedSources));
    }

    private ObjectNode identity(String gameId) { return json.createObjectNode().put("gameId", gameId).put("profile", PROFILE).put("digestVersion", DIGEST_VERSION); }
    private String digest(JsonNode value) { return AvailabilityDigest.digest(json, value); }
    private static Issue issue(String code, String skill, String path, String message) { return new Issue(code, skill, path, message); }
    private static String nullable(JsonNode value) { return value == null || value.isNull() ? null : value.textValue(); }

    private record DataRow(String kind, String owner, String key, JsonNode data) { }

    private final class Snapshot {
        private static final Set<String> SKILL_PARTS = Set.of("PARAMETER", "FORMULA", "EFFECT", "STATE", "PROCESS", "TRIGGER", "SKILL_CATEGORY", "REFERENCE");
        private static final Set<String> SHARED_KINDS = Set.of("ATTRIBUTE", "CATEGORY", "DAMAGE_TYPE", "MODIFIER_ZONE", "STATUS", "VAMP_RULE", "LEVEL_CONFIG", "CALCULATION_RULES");
        private final String gameId;
        private final Map<String, List<DataRow>> byKind = new HashMap<>();
        private final Map<String, Map<String, List<DataRow>>> byOwner = new HashMap<>();
        private final Map<String, JsonNode> skillCache = new HashMap<>();
        private final Map<String, DataRow> skillDefinitions = new TreeMap<>();
        private final Set<String> sharedSkillDependencies = new TreeSet<>();
        private final int minLevel;
        private final int maxLevel;

        Snapshot(String gameId, List<Row> rows) {
            this.gameId = gameId;
            try {
                for (Row row : rows) {
                    JsonNode data = json.readTree(row.data());
                    if (!data.isObject() || !gameId.equals(data.path("game_id").asText())) throw new IllegalArgumentException();
                    ((ObjectNode) data).remove(List.of("created_at", "updated_at"));
                    DataRow parsed = new DataRow(row.kind(), row.ownerKey(), row.objectKey(), data);
                    byKind.computeIfAbsent(row.kind(), ignored -> new ArrayList<>()).add(parsed);
                    byOwner.computeIfAbsent(row.kind(), ignored -> new HashMap<>()).computeIfAbsent(row.ownerKey(), ignored -> new ArrayList<>()).add(parsed);
                    if ("SKILL".equals(row.kind())) skillDefinitions.put(row.objectKey(), parsed);
                }
            } catch (Exception exception) {
                throw new ApiException(HttpStatus.CONFLICT, "409.SIMULATION_AVAILABILITY_INVALID", "计算可用目录读取到损坏或跨游戏的业务数据");
            }
            Comparator<DataRow> order = Comparator.comparing(DataRow::kind).thenComparing(DataRow::owner)
                .thenComparingInt(row -> row.data().path("sort_order").asInt(0)).thenComparing(DataRow::key)
                .thenComparing(row -> AvailabilityDigest.canonical(json, row.data()).toString());
            byKind.values().forEach(list -> list.sort(order));
            byOwner.values().forEach(owners -> owners.values().forEach(list -> list.sort(order)));
            for (DataRow row : owned("REFERENCE", "")) {
                String dependency = referencedSkill(row.data());
                if (!dependency.isEmpty()) sharedSkillDependencies.add(dependency);
            }
            JsonNode levels = first("LEVEL_CONFIG");
            minLevel = levels.path("min_level").asInt(0);
            maxLevel = levels.path("max_level").asInt(0);
        }

        List<DataRow> rows(String kind) { return byKind.getOrDefault(kind, List.of()); }
        List<DataRow> owned(String kind, String owner) { return byOwner.getOrDefault(kind, Map.of()).getOrDefault(owner, List.of()); }
        JsonNode first(String kind) { return rows(kind).isEmpty() ? json.nullNode() : rows(kind).getFirst().data(); }
        JsonNode ownFirst(String kind, String owner) { return owned(kind, owner).isEmpty() ? json.nullNode() : owned(kind, owner).getFirst().data(); }

        List<DataRow> ownedRows(String kind, String key) {
            List<DataRow> result = new ArrayList<>();
            rows(kind).stream().filter(row -> row.key().equals(key)).forEach(result::add);
            result.addAll(owned(kind + "_ATTRIBUTES", key));
            result.addAll(owned(kind + "_BINDING", key));
            return result;
        }

        JsonNode shared() {
            List<DataRow> result = new ArrayList<>();
            SHARED_KINDS.stream().sorted().forEach(kind -> result.addAll(rows(kind)));
            result.addAll(owned("REFERENCE", ""));
            return serialize(result);
        }

        ArrayNode serialize(Collection<DataRow> rows) {
            ArrayNode result = json.createArrayNode();
            for (DataRow row : rows) {
                ObjectNode item = result.addObject().put("kind", row.kind()).put("ownerKey", row.owner()).put("objectKey", row.key());
                item.set("data", row.data());
            }
            return result;
        }

        ArrayNode skills(Set<String> keys) {
            ArrayNode result = json.createArrayNode();
            for (String key : new TreeSet<>(keys)) result.add(skillCache.computeIfAbsent(key, this::skill));
            return result;
        }

        private JsonNode skill(String key) {
            ObjectNode result = json.createObjectNode().put("skillKey", key);
            DataRow definition = skillDefinitions.get(key);
            result.set("definition", definition == null ? json.nullNode() : definition.data());
            List<DataRow> parts = new ArrayList<>();
            SKILL_PARTS.stream().sorted().forEach(kind -> parts.addAll(owned(kind, key)));
            result.set("parts", serialize(parts));
            return result;
        }

        Set<String> skillClosure(Set<String> direct) {
            Set<String> result = new TreeSet<>();
            Deque<String> pending = new ArrayDeque<>(direct);
            pending.addAll(sharedSkillDependencies);
            while (!pending.isEmpty()) {
                String key = pending.removeFirst();
                if (!result.add(key)) continue;
                for (DataRow row : owned("REFERENCE", key)) {
                    String dependency = referencedSkill(row.data());
                    if (!dependency.isEmpty() && !result.contains(dependency)) pending.addLast(dependency);
                }
            }
            return result;
        }

        private String referencedSkill(JsonNode reference) {
            if ("SKILL".equals(reference.path("target_type").asText())) return reference.path("target_key").asText("");
            return reference.path("target_skill_key").asText("");
        }

        private Set<String> excluded(JsonNode scope) {
            Set<String> result = new HashSet<>();
            scope.path("expectedSkills").forEach(item -> {
                if (item.path("excluded").asBoolean(false)) result.addAll(SimulationAvailabilityResources.currentSkillKeys(item));
            });
            return result;
        }

        JsonNode coverage(String kind, JsonNode scope, Set<String> keys) {
            if (!validLevels()) return null;
            Set<String> excluded = excluded(scope);
            ObjectNode result = json.createObjectNode().put("scenario", "one-way-combat-analysis-v1");
            result.putArray("sides").add("source").add("target");
            ArrayNode levels = result.putArray("characterLevels");
            for (int level = minLevel; level <= maxLevel; level++) levels.add(level);
            ArrayNode skills = result.putArray("skills");
            for (String key : new TreeSet<>(keys)) {
                if (excluded.contains(key)) continue;
                DataRow definition = skillDefinitions.get(key);
                int maximum = definition == null ? 0 : definition.data().path("max_level").asInt(0);
                if (maximum < 1 || maximum > 100) return null;
                ObjectNode skill = skills.addObject().put("skillKey", key);
                ArrayNode skillLevels = skill.putArray("levels");
                for (int level = 1; level <= maximum; level++) skillLevels.add(level);
            }
            result.put("levelValidation", SimulationAvailabilityResources.REPRESENTATIVE_CASES).put("allRequiredSourcesEnabled", true)
                .put("sourceActiveStartedAndCompleted", true).put("relevantPassivesTriggered", true)
                .put("equipmentMode", "EQUIPMENT".equals(kind) ? "single-item" : "none");
            return result;
        }

        private boolean validLevels() { return minLevel >= 1 && maxLevel >= minLevel && maxLevel <= 100; }

        List<Issue> diagnose(String kind, String key, JsonNode scope, Set<String> direct, Set<String> closure) {
            List<Issue> issues = new ArrayList<>();
            String root = ("CHARACTER".equals(kind) ? "characters." : "equipment.") + key;
            if (rows(kind).stream().noneMatch(row -> row.key().equals(key))) issues.add(issue("OBJECT_MISSING", null, root, "范围内主体尚未录入"));
            if (!validLevels()) issues.add(issue("LEVEL_CONFIGURATION_MISSING", null, "catalogs.levelConfiguration", "缺少完整合法游戏等级范围"));
            JsonNode rules = first("CALCULATION_RULES").path("configuration");
            if (!rules.isObject()) issues.add(issue("CALCULATION_RULES_MISSING", null, "catalogs.calculationRules.configuration", "尚未配置游戏计算规则"));
            if ("CHARACTER".equals(kind)) {
                JsonNode levels = ownFirst("CHARACTER_ATTRIBUTES", key).path("level_values");
                if (!levels.isObject()) issues.add(issue("LEVEL_ATTRIBUTES_MISSING", null, root + ".levelValues", "尚未录入角色完整等级属性"));
                else if (validLevels()) {
                    for (int level = minLevel; level <= maxLevel; level++) {
                        JsonNode attributes = levels.path(Integer.toString(level));
                        if (!attributes.isObject() || attributes.isEmpty()) issues.add(issue("LEVEL_ATTRIBUTES_MISSING", null, root + ".levelValues." + level, "缺少角色第" + level + "级属性"));
                        else checkAttributes(attributes, root + ".levelValues." + level, issues, true);
                    }
                }
                for (JsonNode expected : scope.path("expectedSkills")) {
                    if (!expected.path("excluded").asBoolean()) {
                        for (String skill : SimulationAvailabilityResources.currentSkillKeys(expected)) {
                            if (!direct.contains(skill)) issues.add(issue("EXPECTED_SKILL_BINDING_MISSING", skill,
                                root + ".skillRelations." + skill, expected.path("name").asText(skill)
                                    + "的当前技能" + skill + "尚未绑定，不能按关闭或未学处理"));
                        }
                    }
                }
                String basicCategory = rules.path("basicAttackCategoryKey").asText("");
                long basicCount = direct.stream().filter(skill -> owned("SKILL_CATEGORY", skill).stream()
                    .anyMatch(row -> basicCategory.equals(row.data().path("skill_category_key").asText()))).count();
                if (basicCategory.isEmpty() || basicCount != 1) issues.add(issue("BASIC_ATTACK_BINDING_NOT_UNIQUE", null, root + ".skillRelations", "需要按当前用途绑定唯一真实普通攻击"));
            } else {
                JsonNode attributes = ownFirst("EQUIPMENT_ATTRIBUTES", key).path("attribute_values");
                if (!attributes.isObject()) issues.add(issue("EQUIPMENT_ATTRIBUTES_MISSING", null, root + ".attributeValues", "尚未录入装备完整直接属性"));
                else checkAttributes(attributes, root + ".attributeValues", issues, false);
                if (scope.path("requiresSkillBindings").asBoolean(true) && direct.isEmpty()) issues.add(issue("EQUIPMENT_SKILL_BINDING_MISSING", null,
                    root + ".skillRelations", "原来源未确认仅含属性，缺少完整装备技能绑定"));
            }
            Set<String> excluded = excluded(scope);
            for (String skill : closure) {
                if (excluded.contains(skill)) continue;
                DataRow definition = skillDefinitions.get(skill);
                String path = "skills." + skill;
                String name = definition == null ? skill : definition.data().path("name").asText(skill);
                if (definition == null) { issues.add(issue("SKILL_DEFINITION_MISSING", skill, path, "缺少技能定义：" + name)); continue; }
                if (!"ENABLED".equals(definition.data().path("status").asText())) issues.add(issue("SKILL_DISABLED", skill, path + ".status", name + "尚未全局启用"));
                int maximum = definition.data().path("max_level").asInt(0);
                if (maximum < 1 || maximum > 100) issues.add(issue("SKILL_LEVEL_INVALID", skill, path + ".maxLevel", name + "缺少合法技能等级范围"));
                if (direct.contains(skill) && owned("TRIGGER", skill).isEmpty()) issues.add(issue("SKILL_PROGRAM_MISSING", skill, path + ".triggerRules", name + "只有资料或参数，缺少完整触发程序"));
                for (DataRow trigger : owned("TRIGGER", skill)) {
                    JsonNode actions = trigger.data().path("actions");
                    if (!actions.isArray() || actions.isEmpty()) issues.add(issue("SKILL_PROGRAM_EMPTY", skill, path + ".triggerRules." + trigger.key() + ".actions", name + "的触发规则没有执行动作"));
                }
                for (DataRow process : owned("PROCESS", skill)) {
                    JsonNode steps = process.data().path("steps");
                    if (!steps.isArray() || steps.isEmpty()) issues.add(issue("SKILL_PROGRAM_EMPTY", skill, path + ".processes." + process.key() + ".steps", name + "的施放过程没有执行步骤"));
                }
                for (DataRow reference : owned("REFERENCE", skill)) checkReference(reference, skill, name, issues);
            }
            return List.copyOf(issues);
        }

        private void checkAttributes(JsonNode attributes, String path, List<Issue> issues, boolean requireHp) {
            if (requireHp && (!attributes.path("hp").isNumber() || attributes.path("hp").decimalValue().signum() <= 0)) {
                issues.add(issue("HEALTH_ATTRIBUTE_MISSING", null, path + ".hp", "需要明确且大于零的生命属性"));
            }
            for (var attribute : attributes.properties()) {
                DataRow definition = rows("ATTRIBUTE").stream().filter(row -> row.key().equals(attribute.getKey())).findFirst().orElse(null);
                if (definition == null || !"ENABLED".equals(definition.data().path("status").asText()) || !attribute.getValue().isNumber()) {
                    issues.add(issue("ATTRIBUTE_VALUE_INVALID", null, path + "." + attribute.getKey(), "属性未启用、定义缺失或数值不合法"));
                }
            }
        }

        private void checkReference(DataRow reference, String skill, String name, List<Issue> issues) {
            JsonNode ref = reference.data();
            String type = ref.path("target_type").asText();
            String targetSkill = referencedSkill(ref);
            if (targetSkill.isEmpty()) return;
            if (!skillDefinitions.containsKey(targetSkill) || (Set.of("PARAMETER", "FORMULA", "EFFECT", "STATE", "PROCESS").contains(type)
                && owned(type, targetSkill).stream().noneMatch(row -> row.key().equals(ref.path("target_key").asText())))) {
                issues.add(issue("SKILL_DEPENDENCY_MISSING", skill, "skills." + skill + ref.path("field_path").asText(), name + "缺少必要跨技能依赖：" + targetSkill));
            }
        }
    }
}
