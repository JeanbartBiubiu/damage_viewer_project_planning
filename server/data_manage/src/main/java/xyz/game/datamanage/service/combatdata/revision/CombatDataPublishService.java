package xyz.game.datamanage.service.combatdata.revision;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.Map;
import java.util.Set;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.GameVersionsMapper;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatGameProgressionSchemaMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAttributeDefinitionsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatTypesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatTypeRelationsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatGameEntitiesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEntityAttributeValuesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEntityAttributeStageValuesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatResourceDefinitionsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEntityResourceValuesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEntityResourceStageValuesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderDefinitionsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderFormulasMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderLifecyclesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEntityProviderMountsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderStateFieldsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityDefinitionsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityParametersMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityStateFieldsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityPhasesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityCostsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityCooldownsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderModifiersMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderListenersMapper;
import xyz.game.datamanage.mapper.combatdata.CombatListenerMatchTypesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEffectSequencesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEffectStepsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityPhaseEffectSequencesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatListenerEffectSequencesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderTickSequencesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatDamageEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatHealEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatResourceEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAttributeEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatShieldEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEventEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityControlEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatStateEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatRepeatEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatExecuteEffectDetailsMapper;
import xyz.game.datamanage.service.PostgresJsonSupport;
import xyz.game.datamanage.support.error.ApiException;

/**
 * Revision-interval publish: lock game_data_state, freeze current_revision,
 * upsert changed business rows into *_log, then advance published_revision / current version.
 * Does not build Bundle/Catalog or update main-table version ranges.
 */
@Service
public class CombatDataPublishService {

    private static final String WORKSPACE_VERSION_CODE = "__workspace__";
    private static final Set<String> ALLOWED_FIELDS = Set.of("versionCode", "releaseDate");

    private final GameDataRevisionService revisionService;
    private final GamesMapper gamesMapper;
    private final GameVersionsMapper gameVersionsMapper;
    private final PostgresJsonSupport jsonSupport;
    private final ObjectMapper objectMapper;
    private final CombatGameProgressionSchemaMapper combatGameProgressionSchemaMapper;
    private final CombatAttributeDefinitionsMapper combatAttributeDefinitionsMapper;
    private final CombatTypesMapper combatTypesMapper;
    private final CombatTypeRelationsMapper combatTypeRelationsMapper;
    private final CombatGameEntitiesMapper combatGameEntitiesMapper;
    private final CombatEntityAttributeValuesMapper combatEntityAttributeValuesMapper;
    private final CombatEntityAttributeStageValuesMapper combatEntityAttributeStageValuesMapper;
    private final CombatResourceDefinitionsMapper combatResourceDefinitionsMapper;
    private final CombatEntityResourceValuesMapper combatEntityResourceValuesMapper;
    private final CombatEntityResourceStageValuesMapper combatEntityResourceStageValuesMapper;
    private final CombatProviderDefinitionsMapper combatProviderDefinitionsMapper;
    private final CombatProviderFormulasMapper combatProviderFormulasMapper;
    private final CombatProviderLifecyclesMapper combatProviderLifecyclesMapper;
    private final CombatEntityProviderMountsMapper combatEntityProviderMountsMapper;
    private final CombatProviderStateFieldsMapper combatProviderStateFieldsMapper;
    private final CombatAbilityDefinitionsMapper combatAbilityDefinitionsMapper;
    private final CombatAbilityParametersMapper combatAbilityParametersMapper;
    private final CombatAbilityStateFieldsMapper combatAbilityStateFieldsMapper;
    private final CombatAbilityPhasesMapper combatAbilityPhasesMapper;
    private final CombatAbilityCostsMapper combatAbilityCostsMapper;
    private final CombatAbilityCooldownsMapper combatAbilityCooldownsMapper;
    private final CombatProviderModifiersMapper combatProviderModifiersMapper;
    private final CombatProviderListenersMapper combatProviderListenersMapper;
    private final CombatListenerMatchTypesMapper combatListenerMatchTypesMapper;
    private final CombatEffectSequencesMapper combatEffectSequencesMapper;
    private final CombatEffectStepsMapper combatEffectStepsMapper;
    private final CombatAbilityPhaseEffectSequencesMapper combatAbilityPhaseEffectSequencesMapper;
    private final CombatListenerEffectSequencesMapper combatListenerEffectSequencesMapper;
    private final CombatProviderTickSequencesMapper combatProviderTickSequencesMapper;
    private final CombatDamageEffectDetailsMapper combatDamageEffectDetailsMapper;
    private final CombatHealEffectDetailsMapper combatHealEffectDetailsMapper;
    private final CombatResourceEffectDetailsMapper combatResourceEffectDetailsMapper;
    private final CombatAttributeEffectDetailsMapper combatAttributeEffectDetailsMapper;
    private final CombatShieldEffectDetailsMapper combatShieldEffectDetailsMapper;
    private final CombatProviderEffectDetailsMapper combatProviderEffectDetailsMapper;
    private final CombatEventEffectDetailsMapper combatEventEffectDetailsMapper;
    private final CombatAbilityControlEffectDetailsMapper combatAbilityControlEffectDetailsMapper;
    private final CombatStateEffectDetailsMapper combatStateEffectDetailsMapper;
    private final CombatRepeatEffectDetailsMapper combatRepeatEffectDetailsMapper;
    private final CombatExecuteEffectDetailsMapper combatExecuteEffectDetailsMapper;

    public CombatDataPublishService(
        GameDataRevisionService revisionService,
        GamesMapper gamesMapper,
        GameVersionsMapper gameVersionsMapper,
        PostgresJsonSupport jsonSupport,
        ObjectMapper objectMapper,
        CombatGameProgressionSchemaMapper combatGameProgressionSchemaMapper,
        CombatAttributeDefinitionsMapper combatAttributeDefinitionsMapper,
        CombatTypesMapper combatTypesMapper,
        CombatTypeRelationsMapper combatTypeRelationsMapper,
        CombatGameEntitiesMapper combatGameEntitiesMapper,
        CombatEntityAttributeValuesMapper combatEntityAttributeValuesMapper,
        CombatEntityAttributeStageValuesMapper combatEntityAttributeStageValuesMapper,
        CombatResourceDefinitionsMapper combatResourceDefinitionsMapper,
        CombatEntityResourceValuesMapper combatEntityResourceValuesMapper,
        CombatEntityResourceStageValuesMapper combatEntityResourceStageValuesMapper,
        CombatProviderDefinitionsMapper combatProviderDefinitionsMapper,
        CombatProviderFormulasMapper combatProviderFormulasMapper,
        CombatProviderLifecyclesMapper combatProviderLifecyclesMapper,
        CombatEntityProviderMountsMapper combatEntityProviderMountsMapper,
        CombatProviderStateFieldsMapper combatProviderStateFieldsMapper,
        CombatAbilityDefinitionsMapper combatAbilityDefinitionsMapper,
        CombatAbilityParametersMapper combatAbilityParametersMapper,
        CombatAbilityStateFieldsMapper combatAbilityStateFieldsMapper,
        CombatAbilityPhasesMapper combatAbilityPhasesMapper,
        CombatAbilityCostsMapper combatAbilityCostsMapper,
        CombatAbilityCooldownsMapper combatAbilityCooldownsMapper,
        CombatProviderModifiersMapper combatProviderModifiersMapper,
        CombatProviderListenersMapper combatProviderListenersMapper,
        CombatListenerMatchTypesMapper combatListenerMatchTypesMapper,
        CombatEffectSequencesMapper combatEffectSequencesMapper,
        CombatEffectStepsMapper combatEffectStepsMapper,
        CombatAbilityPhaseEffectSequencesMapper combatAbilityPhaseEffectSequencesMapper,
        CombatListenerEffectSequencesMapper combatListenerEffectSequencesMapper,
        CombatProviderTickSequencesMapper combatProviderTickSequencesMapper,
        CombatDamageEffectDetailsMapper combatDamageEffectDetailsMapper,
        CombatHealEffectDetailsMapper combatHealEffectDetailsMapper,
        CombatResourceEffectDetailsMapper combatResourceEffectDetailsMapper,
        CombatAttributeEffectDetailsMapper combatAttributeEffectDetailsMapper,
        CombatShieldEffectDetailsMapper combatShieldEffectDetailsMapper,
        CombatProviderEffectDetailsMapper combatProviderEffectDetailsMapper,
        CombatEventEffectDetailsMapper combatEventEffectDetailsMapper,
        CombatAbilityControlEffectDetailsMapper combatAbilityControlEffectDetailsMapper,
        CombatStateEffectDetailsMapper combatStateEffectDetailsMapper,
        CombatRepeatEffectDetailsMapper combatRepeatEffectDetailsMapper,
        CombatExecuteEffectDetailsMapper combatExecuteEffectDetailsMapper
    ) {
        this.revisionService = revisionService;
        this.gamesMapper = gamesMapper;
        this.gameVersionsMapper = gameVersionsMapper;
        this.jsonSupport = jsonSupport;
        this.objectMapper = objectMapper;
        this.combatGameProgressionSchemaMapper = combatGameProgressionSchemaMapper;
        this.combatAttributeDefinitionsMapper = combatAttributeDefinitionsMapper;
        this.combatTypesMapper = combatTypesMapper;
        this.combatTypeRelationsMapper = combatTypeRelationsMapper;
        this.combatGameEntitiesMapper = combatGameEntitiesMapper;
        this.combatEntityAttributeValuesMapper = combatEntityAttributeValuesMapper;
        this.combatEntityAttributeStageValuesMapper = combatEntityAttributeStageValuesMapper;
        this.combatResourceDefinitionsMapper = combatResourceDefinitionsMapper;
        this.combatEntityResourceValuesMapper = combatEntityResourceValuesMapper;
        this.combatEntityResourceStageValuesMapper = combatEntityResourceStageValuesMapper;
        this.combatProviderDefinitionsMapper = combatProviderDefinitionsMapper;
        this.combatProviderFormulasMapper = combatProviderFormulasMapper;
        this.combatProviderLifecyclesMapper = combatProviderLifecyclesMapper;
        this.combatEntityProviderMountsMapper = combatEntityProviderMountsMapper;
        this.combatProviderStateFieldsMapper = combatProviderStateFieldsMapper;
        this.combatAbilityDefinitionsMapper = combatAbilityDefinitionsMapper;
        this.combatAbilityParametersMapper = combatAbilityParametersMapper;
        this.combatAbilityStateFieldsMapper = combatAbilityStateFieldsMapper;
        this.combatAbilityPhasesMapper = combatAbilityPhasesMapper;
        this.combatAbilityCostsMapper = combatAbilityCostsMapper;
        this.combatAbilityCooldownsMapper = combatAbilityCooldownsMapper;
        this.combatProviderModifiersMapper = combatProviderModifiersMapper;
        this.combatProviderListenersMapper = combatProviderListenersMapper;
        this.combatListenerMatchTypesMapper = combatListenerMatchTypesMapper;
        this.combatEffectSequencesMapper = combatEffectSequencesMapper;
        this.combatEffectStepsMapper = combatEffectStepsMapper;
        this.combatAbilityPhaseEffectSequencesMapper = combatAbilityPhaseEffectSequencesMapper;
        this.combatListenerEffectSequencesMapper = combatListenerEffectSequencesMapper;
        this.combatProviderTickSequencesMapper = combatProviderTickSequencesMapper;
        this.combatDamageEffectDetailsMapper = combatDamageEffectDetailsMapper;
        this.combatHealEffectDetailsMapper = combatHealEffectDetailsMapper;
        this.combatResourceEffectDetailsMapper = combatResourceEffectDetailsMapper;
        this.combatAttributeEffectDetailsMapper = combatAttributeEffectDetailsMapper;
        this.combatShieldEffectDetailsMapper = combatShieldEffectDetailsMapper;
        this.combatProviderEffectDetailsMapper = combatProviderEffectDetailsMapper;
        this.combatEventEffectDetailsMapper = combatEventEffectDetailsMapper;
        this.combatAbilityControlEffectDetailsMapper = combatAbilityControlEffectDetailsMapper;
        this.combatStateEffectDetailsMapper = combatStateEffectDetailsMapper;
        this.combatRepeatEffectDetailsMapper = combatRepeatEffectDetailsMapper;
        this.combatExecuteEffectDetailsMapper = combatExecuteEffectDetailsMapper;
    }

    @Transactional
    public ObjectNode publishVersion(String gameId, ObjectNode requestBody) {
        if (requestBody == null || requestBody.isEmpty()) {
            throw badRequest("Request body cannot be empty", Map.of("path", "/", "reason", "empty body"));
        }
        jsonSupport.validateAllowedTopLevelFields(requestBody, ALLOWED_FIELDS);

        String versionCode = jsonSupport.requireText(requestBody, "versionCode", "version");
        if (WORKSPACE_VERSION_CODE.equals(versionCode)) {
            throw badRequest("versionCode is reserved", Map.of("path", "/versionCode"));
        }
        LocalDate releaseDate = null;
        if (requestBody.hasNonNull("releaseDate")) {
            try {
                releaseDate = LocalDate.parse(requestBody.path("releaseDate").asText());
            } catch (DateTimeParseException ex) {
                throw badRequest("releaseDate must be ISO date", Map.of("path", "/releaseDate"));
            }
        }

        gamesMapper.ensureGamePartitions(gameId);

        GameDataRevisionService.GameDataStateView locked = revisionService.lockState(gameId);
        long publishRevision = locked.currentRevision();
        long previousPublishedRevision = locked.publishedRevision();

        if (gameVersionsMapper.findVersionByCode(gameId, versionCode) != null) {
            throw conflict("Version code already exists", Map.of("gameId", gameId, "versionCode", versionCode));
        }

        Long versionId;
        try {
            versionId = gameVersionsMapper.createVersion(
                gameId,
                versionCode,
                releaseDate == null ? null : Date.valueOf(releaseDate),
                publishRevision
            );
        } catch (DataIntegrityViolationException ex) {
            throw conflict("Version code already exists", Map.of("gameId", gameId, "versionCode", versionCode));
        }
        if (versionId == null) {
            throw notFound("Version not found", Map.of("gameId", gameId, "versionCode", versionCode));
        }

        combatGameProgressionSchemaMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatAttributeDefinitionsMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatTypesMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatTypeRelationsMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatGameEntitiesMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatEntityAttributeValuesMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatEntityAttributeStageValuesMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatResourceDefinitionsMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatEntityResourceValuesMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatEntityResourceStageValuesMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatProviderDefinitionsMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatProviderFormulasMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatProviderLifecyclesMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatEntityProviderMountsMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatProviderStateFieldsMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatAbilityDefinitionsMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatAbilityParametersMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatAbilityStateFieldsMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatAbilityPhasesMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatAbilityCostsMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatAbilityCooldownsMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatProviderModifiersMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatProviderListenersMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatListenerMatchTypesMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatEffectSequencesMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatEffectStepsMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatAbilityPhaseEffectSequencesMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatListenerEffectSequencesMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatProviderTickSequencesMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatDamageEffectDetailsMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatHealEffectDetailsMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatResourceEffectDetailsMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatAttributeEffectDetailsMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatShieldEffectDetailsMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatProviderEffectDetailsMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatEventEffectDetailsMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatAbilityControlEffectDetailsMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatStateEffectDetailsMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatRepeatEffectDetailsMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);
        combatExecuteEffectDetailsMapper.copyChangedToLog(gameId, versionId, previousPublishedRevision, publishRevision);

        Instant publishedAt = Instant.now();
        gameVersionsMapper.clearCurrentVersion(gameId);
        int updatedRows = gameVersionsMapper.markVersionCurrent(
            Timestamp.from(publishedAt),
            gameId,
            versionId
        );
        if (updatedRows == 0) {
            throw notFound("Version not found", Map.of("gameId", gameId, "versionCode", versionCode));
        }

        revisionService.markPublished(gameId, publishRevision);

        ObjectNode response = objectMapper.createObjectNode();
        response.put("gameId", gameId);
        response.put("versionCode", versionCode);
        if (releaseDate != null) {
            response.put("releaseDate", releaseDate.toString());
        }
        response.put("changeRevision", publishRevision);
        response.put("publishedAt", publishedAt.toString());
        response.put("updatedAt", publishedAt.toString());
        return response;
    }

    private static ApiException badRequest(String message, Map<String, Object> details) {
        return new ApiException(HttpStatus.BAD_REQUEST, "400.INVALID_BODY", message, details);
    }

    private static ApiException notFound(String message, Map<String, Object> details) {
        return new ApiException(HttpStatus.NOT_FOUND, "404.NOT_FOUND", message, details);
    }

    private static ApiException conflict(String message, Map<String, Object> details) {
        return new ApiException(HttpStatus.CONFLICT, "409.CONFLICT", message, details);
    }
}
