package xyz.game.datamanage.service.skilltrigger;

import static xyz.game.datamanage.service.skilltrigger.validation.SkillTriggerValidationSupport.fieldIssue;
import static xyz.game.datamanage.service.skilltrigger.validation.SkillTriggerValidationSupport.nullToEmpty;

import jakarta.validation.Valid;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skilltrigger.SkillTriggerRuleMapper;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleCreateRequest;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleDetailResponse;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleSummaryResponse;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleUpdateRequest;
import xyz.game.datamanage.service.skilltrigger.reference.SkillTriggerCatalogValidator;
import xyz.game.datamanage.service.skilltrigger.reference.SkillTriggerReferenceGuard;
import xyz.game.datamanage.service.skilltrigger.validation.SkillTriggerPayloadValidator;
import xyz.game.datamanage.service.skilltrigger.validation.ValidatedRule;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.authoring.SkillTriggerOncePerUseSemantics;
import xyz.game.datamanage.support.error.ApiException;

@Service
@Validated
public class SkillTriggerRuleService {

    private final xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites;

    private static final String PRIMARY_KEY_CONSTRAINT = "pk_skill_trigger_rules";
    private final GamesMapper gamesMapper;
    private final SkillMapper skillMapper;
    private final SkillTriggerRuleMapper mapper;
    private final SkillTriggerRuleAssembler assembler;
    private final SkillTriggerPayloadValidator payloadValidator;
    private final SkillTriggerCatalogValidator catalogs;
    private final SkillTriggerReferenceGuard references;
    private final SkillTriggerCycleValidator cycleValidator;

    public SkillTriggerRuleService(
        GamesMapper gamesMapper,
        SkillMapper skillMapper,
        SkillTriggerRuleMapper mapper,
        SkillTriggerRuleAssembler assembler,
        SkillTriggerPayloadValidator payloadValidator,
        SkillTriggerCatalogValidator catalogs,
        SkillTriggerReferenceGuard references,
        SkillTriggerCycleValidator cycleValidator,
        xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites
    ) {
        this.gamesMapper = gamesMapper;
        this.skillMapper = skillMapper;
        this.mapper = mapper;
        this.assembler = assembler;
        this.payloadValidator = payloadValidator;
        this.catalogs = catalogs;
        this.references = references;
        this.cycleValidator = cycleValidator;

        this.configurationWrites = java.util.Objects.requireNonNull(configurationWrites);
    }

    @Transactional(readOnly = true)
    public List<SkillTriggerRuleSummaryResponse> list(String gameId, String skillKey) {
        requireGame(gameId);
        requireSkillExists(gameId, skillKey);
        List<SkillTriggerRuleSummaryResponse> items = mapper.listSummaries(gameId, skillKey);
        return items == null ? List.of() : items;
    }

    @Transactional(readOnly = true)
    public SkillTriggerRuleDetailResponse get(String gameId, String skillKey, String ruleKey) {
        requireGame(gameId);
        requireSkillExists(gameId, skillKey);
        return requireDetail(gameId, skillKey, ruleKey);
    }

    /** 统一配置阶段仅检查当前规则形状，引用等待所有根行落地后再验证。 */
    public Prepared prepareConfigurationCreate(SkillTriggerRuleCreateRequest request) {
        return new Prepared(payloadValidator.validateCreate(request), null, true);
    }

    public Prepared prepareConfigurationUpdate(
        String ruleKey, SkillTriggerRuleUpdateRequest request, SkillTriggerRuleDetailResponse baselineDetail
    ) {
        if (baselineDetail == null) throw ruleNotFound(ruleKey);
        ValidatedRule values = payloadValidator.validateUpdate(request, ruleKey);
        payloadValidator.rejectImmutableKinds(baselineDetail, values);
        return new Prepared(values, baselineDetail, false);
    }

    public void writePreparedWithinConfiguration(String gameId, String skillKey, Prepared prepared) {
        ValidatedRule values = prepared.values;
        try {
            if (prepared.creating) {
                insertAggregate(gameId, skillKey, values);
            } else if (mapper.updateRule(gameId, skillKey, values.ruleKey(), values.name(), values.description(),
                values.sortOrder(), values.eventSource().eventType().name(), AggregateJson.write(values.eventSource()),
                AggregateJson.write(SkillTriggerRuleAssembler.orderedGroups(values.conditionGroups())),
                AggregateJson.write(SkillTriggerRuleAssembler.orderedActions(values.actions())),
                AggregateJson.write(new SkillTriggerRuleAssembler.Limits(
                    values.perTargetCooldown(), values.maxTriggersPerProcess(), values.oncePerUse()))) == 0) {
                throw ruleNotFound(values.ruleKey());
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
    }

    public void validatePreparedAgainstFinalDatabase(String gameId, String skillKey, Prepared prepared) {
        List<SkillTriggerRuleRow> finalRules = mapper.listRulesForUpdate(gameId, skillKey);
        assertOncePerUseGroup(prepared.values, finalRules);
        catalogs.lockAndValidateCatalogs(gameId, skillKey, prepared.values, prepared.baselineDetail);
        cycleValidator.validateCurrentSkill(gameId, skillKey);
    }

    public void deleteWithinConfiguration(String gameId, String skillKey, String ruleKey) {
        if (mapper.deleteRule(gameId, skillKey, ruleKey) == 0) throw ruleNotFound(ruleKey);
    }

    /** 只复核本次改变的目标在最终数据库中仍被既有规则使用时的形状。 */
    public void validateAffectedConfigurationFinal(
        String gameId, String skillKey, Collection<String> changedEffectKeys,
        Collection<String> changedProcessKeys, Collection<String> changedStateKeys
    ) {
        references.validateAffectedConfigurationFinal(gameId, skillKey, changedEffectKeys, changedProcessKeys, changedStateKeys);
    }

    public static final class Prepared {
        private final ValidatedRule values;
        private final SkillTriggerRuleDetailResponse baselineDetail;
        private final boolean creating;

        private Prepared(ValidatedRule values, SkillTriggerRuleDetailResponse baselineDetail, boolean creating) {
            this.values = values;
            this.baselineDetail = baselineDetail;
            this.creating = creating;
        }
    }

    @Transactional
    public SkillTriggerRuleDetailResponse create(
        String gameId,
        String skillKey,
        @Valid SkillTriggerRuleCreateRequest request
    ) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        ValidatedRule values = payloadValidator.validateCreate(request);
        lockParentSkill(gameId, skillKey);
        List<SkillTriggerRuleRow> locked = mapper.listRulesForUpdate(gameId, skillKey);
        if (mapper.countByKey(gameId, skillKey, values.ruleKey()) > 0) {
            throw keyExists();
        }
        assertOncePerUseGroup(values, locked);
        catalogs.lockAndValidateCatalogs(gameId, skillKey, values, null);
        try {
            insertAggregate(gameId, skillKey, values);
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
        cycleValidator.validateCurrentSkill(gameId, skillKey);
        return requireDetail(gameId, skillKey, values.ruleKey());
    }

    @Transactional
    public SkillTriggerRuleDetailResponse update(
        String gameId,
        String skillKey,
        String ruleKey,
        @Valid SkillTriggerRuleUpdateRequest request
    ) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        ValidatedRule values = payloadValidator.validateUpdate(request, ruleKey);
        lockParentSkill(gameId, skillKey);
        List<SkillTriggerRuleRow> locked = mapper.listRulesForUpdate(gameId, skillKey);
        SkillTriggerRuleRow existing = mapper.findRuleForUpdate(gameId, skillKey, ruleKey);
        if (existing == null) {
            throw ruleNotFound(ruleKey);
        }
        SkillTriggerRuleDetailResponse current = assembler.assemble(existing);
        payloadValidator.rejectImmutableKinds(current, values);
        assertOncePerUseGroup(values, locked);
        catalogs.lockAndValidateCatalogs(gameId, skillKey, values, current);
        try {
            if (mapper.updateRule(
                gameId,
                skillKey,
                ruleKey,
                values.name(),
                values.description(),
                values.sortOrder(),
                values.eventSource().eventType().name(),
                AggregateJson.write(values.eventSource()),
                AggregateJson.write(SkillTriggerRuleAssembler.orderedGroups(values.conditionGroups())),
                AggregateJson.write(SkillTriggerRuleAssembler.orderedActions(values.actions())),
                AggregateJson.write(new SkillTriggerRuleAssembler.Limits(
                    values.perTargetCooldown(), values.maxTriggersPerProcess(), values.oncePerUse()))
            ) == 0) {
                throw ruleNotFound(ruleKey);
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
        cycleValidator.validateCurrentSkill(gameId, skillKey);
        return requireDetail(gameId, skillKey, ruleKey);
    }

    @Transactional
    public void delete(String gameId, String skillKey, String ruleKey) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        lockParentSkill(gameId, skillKey);
        mapper.listRulesForUpdate(gameId, skillKey);
        if (mapper.findRuleForUpdate(gameId, skillKey, ruleKey) == null) {
            throw ruleNotFound(ruleKey);
        }
        if (mapper.deleteRule(gameId, skillKey, ruleKey) == 0) {
            throw ruleNotFound(ruleKey);
        }
        cycleValidator.validateCurrentSkill(gameId, skillKey);
    }

    public void deleteAllForSkill(String gameId, String skillKey) {
        mapper.deleteAllForSkill(gameId, skillKey);
    }

    private SkillTriggerRuleDetailResponse requireDetail(String gameId, String skillKey, String ruleKey) {
        SkillTriggerRuleRow rule = mapper.findRule(gameId, skillKey, ruleKey);
        if (rule == null) {
            throw ruleNotFound(ruleKey);
        }
        return assembler.assemble(rule);
    }

    private void insertAggregate(String gameId, String skillKey, ValidatedRule values) {
        mapper.insertRule(gameId, skillKey, values.ruleKey(), values.name(), values.description(), values.sortOrder(),
            values.eventSource().eventType().name(), AggregateJson.write(values.eventSource()),
            AggregateJson.write(SkillTriggerRuleAssembler.orderedGroups(values.conditionGroups())),
            AggregateJson.write(SkillTriggerRuleAssembler.orderedActions(values.actions())),
            AggregateJson.write(new SkillTriggerRuleAssembler.Limits(
                values.perTargetCooldown(), values.maxTriggersPerProcess(), values.oncePerUse())));
    }

    private void lockParentSkill(String gameId, String skillKey) {
        if (skillMapper.findByIdForUpdate(gameId, skillKey) == null) {
            throw skillNotFound(skillKey);
        }
    }

    private void requireSkillExists(String gameId, String skillKey) {
        if (skillMapper.findById(gameId, skillKey) == null) {
            throw skillNotFound(skillKey);
        }
    }

    private void requireGame(String gameId) {
        Long count = gamesMapper.countGames(gameId);
        if (count == null || count <= 0) {
            throw gameNotFound(gameId);
        }
    }

    private static ApiException gameNotFound(String gameId) {
        return new ApiException(
            HttpStatus.NOT_FOUND,
            "404.GAME_NOT_FOUND",
            "游戏不存在",
            Map.of("gameId", gameId == null ? "" : gameId)
        );
    }

    private static ApiException skillNotFound(String skillKey) {
        return new ApiException(
            HttpStatus.NOT_FOUND,
            "404.SKILL_NOT_FOUND",
            "技能不存在",
            Map.of("skillKey", skillKey == null ? "" : skillKey)
        );
    }

    private static ApiException ruleNotFound(String ruleKey) {
        return new ApiException(
            HttpStatus.NOT_FOUND,
            "404.SKILL_TRIGGER_RULE_NOT_FOUND",
            "技能触发规则不存在",
            Map.of("ruleKey", ruleKey == null ? "" : ruleKey)
        );
    }

    private static ApiException keyExists() {
        return new ApiException(
            HttpStatus.CONFLICT,
            "409.SKILL_TRIGGER_RULE_KEY_EXISTS",
            "技能触发规则标识已存在",
            Map.of("fieldIssues", List.of(fieldIssue("ruleKey", "CONFLICT", "技能触发规则标识已存在")))
        );
    }

    private static RuntimeException mapWriteConstraint(DataIntegrityViolationException ex) {
        String text = collectCauseMessages(ex).toLowerCase(Locale.ROOT);
        if (text.contains(PRIMARY_KEY_CONSTRAINT)) {
            return keyExists();
        }
        return ex;
    }

    private static String collectCauseMessages(Throwable throwable) {
        StringBuilder result = new StringBuilder();
        for (Throwable current = throwable; current != null; current = current.getCause()) {
            if (current.getMessage() != null) {
                result.append(' ').append(current.getMessage());
            }
        }
        return result.toString();
    }

    private void assertOncePerUseGroup(ValidatedRule values, List<SkillTriggerRuleRow> locked) {
        List<SkillTriggerOncePerUseSemantics.Member> others = new ArrayList<>();
        for (SkillTriggerRuleRow row : nullToEmpty(locked)) {
            if (row.ruleKey().equals(values.ruleKey())) {
                continue;
            }
            SkillTriggerRuleAssembler.Limits limits = AggregateJson.read(row.limitsJson(), SkillTriggerRuleAssembler.Limits.class);
            SkillTriggerOncePerUseSemantics.Member other = SkillTriggerOncePerUseSemantics.member(
                row.ruleKey(),
                SkillTriggerOncePerUseSemantics.fromDto(limits == null ? null : limits.oncePerUse())
            );
            if (other != null) {
                others.add(other);
            }
        }
        List<Map<String, String>> issues = SkillTriggerOncePerUseSemantics.groupIssues(
            values.ruleKey(),
            SkillTriggerOncePerUseSemantics.fromDto(values.oncePerUse()),
            others,
            "oncePerUse"
        );
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.CONFLICT,
                "409.SKILL_TRIGGER_RULE_ONCE_PER_USE_INVALID",
                "同次使用限制组范围与现有规则冲突",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }
}
