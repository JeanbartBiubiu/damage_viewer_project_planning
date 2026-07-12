package xyz.game.datamanage.service.combatdata.revision;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.InputStream;
import java.io.StringReader;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.sql.Date;
import java.sql.Timestamp;
import java.util.Arrays;
import java.util.stream.Stream;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.w3c.dom.Document;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;
import xyz.game.datamanage.mapper.GameVersionsMapper;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityControlEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityCooldownsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityCostsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityDefinitionsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityParametersMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityPhaseEffectSequencesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityPhasesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityStateFieldsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAttributeDefinitionsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAttributeEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatDamageEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEffectSequencesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEffectStepsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEntityAttributeStageValuesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEntityAttributeValuesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEntityProviderMountsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEntityResourceStageValuesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEntityResourceValuesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEventEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatGameEntitiesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatGameProgressionSchemaMapper;
import xyz.game.datamanage.mapper.combatdata.CombatHealEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatListenerEffectSequencesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatListenerMatchTypesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderDefinitionsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderFormulasMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderLifecyclesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderListenersMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderModifiersMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderStateFieldsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderTickSequencesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatResourceDefinitionsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatResourceEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatShieldEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatStateEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatTypeRelationsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatTypesMapper;
import xyz.game.datamanage.service.PostgresJsonSupport;
import xyz.game.datamanage.service.PostgresReadStore;
import xyz.game.datamanage.service.PostgresWriteStore;

@ExtendWith(MockitoExtension.class)
class CombatDataPublishServiceTest {

    private static final String GAME_ID = "lol";
    private static final long PREVIOUS_REVISION = 3L;
    private static final long PUBLISH_REVISION = 7L;
    private static final long VERSION_ID = 42L;

    @Mock private GameDataRevisionService revisionService;
    @Mock private GamesMapper gamesMapper;
    @Mock private GameVersionsMapper gameVersionsMapper;
    @Mock private CombatGameProgressionSchemaMapper combatGameProgressionSchemaMapper;
    @Mock private CombatAttributeDefinitionsMapper combatAttributeDefinitionsMapper;
    @Mock private CombatTypesMapper combatTypesMapper;
    @Mock private CombatTypeRelationsMapper combatTypeRelationsMapper;
    @Mock private CombatGameEntitiesMapper combatGameEntitiesMapper;
    @Mock private CombatEntityAttributeValuesMapper combatEntityAttributeValuesMapper;
    @Mock private CombatEntityAttributeStageValuesMapper combatEntityAttributeStageValuesMapper;
    @Mock private CombatResourceDefinitionsMapper combatResourceDefinitionsMapper;
    @Mock private CombatEntityResourceValuesMapper combatEntityResourceValuesMapper;
    @Mock private CombatEntityResourceStageValuesMapper combatEntityResourceStageValuesMapper;
    @Mock private CombatProviderDefinitionsMapper combatProviderDefinitionsMapper;
    @Mock private CombatProviderFormulasMapper combatProviderFormulasMapper;
    @Mock private CombatProviderLifecyclesMapper combatProviderLifecyclesMapper;
    @Mock private CombatEntityProviderMountsMapper combatEntityProviderMountsMapper;
    @Mock private CombatProviderStateFieldsMapper combatProviderStateFieldsMapper;
    @Mock private CombatAbilityDefinitionsMapper combatAbilityDefinitionsMapper;
    @Mock private CombatAbilityParametersMapper combatAbilityParametersMapper;
    @Mock private CombatAbilityStateFieldsMapper combatAbilityStateFieldsMapper;
    @Mock private CombatAbilityPhasesMapper combatAbilityPhasesMapper;
    @Mock private CombatAbilityCostsMapper combatAbilityCostsMapper;
    @Mock private CombatAbilityCooldownsMapper combatAbilityCooldownsMapper;
    @Mock private CombatProviderModifiersMapper combatProviderModifiersMapper;
    @Mock private CombatProviderListenersMapper combatProviderListenersMapper;
    @Mock private CombatListenerMatchTypesMapper combatListenerMatchTypesMapper;
    @Mock private CombatEffectSequencesMapper combatEffectSequencesMapper;
    @Mock private CombatEffectStepsMapper combatEffectStepsMapper;
    @Mock private CombatAbilityPhaseEffectSequencesMapper combatAbilityPhaseEffectSequencesMapper;
    @Mock private CombatListenerEffectSequencesMapper combatListenerEffectSequencesMapper;
    @Mock private CombatProviderTickSequencesMapper combatProviderTickSequencesMapper;
    @Mock private CombatDamageEffectDetailsMapper combatDamageEffectDetailsMapper;
    @Mock private CombatHealEffectDetailsMapper combatHealEffectDetailsMapper;
    @Mock private CombatResourceEffectDetailsMapper combatResourceEffectDetailsMapper;
    @Mock private CombatAttributeEffectDetailsMapper combatAttributeEffectDetailsMapper;
    @Mock private CombatShieldEffectDetailsMapper combatShieldEffectDetailsMapper;
    @Mock private CombatProviderEffectDetailsMapper combatProviderEffectDetailsMapper;
    @Mock private CombatEventEffectDetailsMapper combatEventEffectDetailsMapper;
    @Mock private CombatAbilityControlEffectDetailsMapper combatAbilityControlEffectDetailsMapper;
    @Mock private CombatStateEffectDetailsMapper combatStateEffectDetailsMapper;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private CombatDataPublishService service;

    @BeforeEach
    void setUp() {
        service = new CombatDataPublishService(
            revisionService,
            gamesMapper,
            gameVersionsMapper,
            new PostgresJsonSupport(objectMapper),
            objectMapper,
            combatGameProgressionSchemaMapper,
            combatAttributeDefinitionsMapper,
            combatTypesMapper,
            combatTypeRelationsMapper,
            combatGameEntitiesMapper,
            combatEntityAttributeValuesMapper,
            combatEntityAttributeStageValuesMapper,
            combatResourceDefinitionsMapper,
            combatEntityResourceValuesMapper,
            combatEntityResourceStageValuesMapper,
            combatProviderDefinitionsMapper,
            combatProviderFormulasMapper,
            combatProviderLifecyclesMapper,
            combatEntityProviderMountsMapper,
            combatProviderStateFieldsMapper,
            combatAbilityDefinitionsMapper,
            combatAbilityParametersMapper,
            combatAbilityStateFieldsMapper,
            combatAbilityPhasesMapper,
            combatAbilityCostsMapper,
            combatAbilityCooldownsMapper,
            combatProviderModifiersMapper,
            combatProviderListenersMapper,
            combatListenerMatchTypesMapper,
            combatEffectSequencesMapper,
            combatEffectStepsMapper,
            combatAbilityPhaseEffectSequencesMapper,
            combatListenerEffectSequencesMapper,
            combatProviderTickSequencesMapper,
            combatDamageEffectDetailsMapper,
            combatHealEffectDetailsMapper,
            combatResourceEffectDetailsMapper,
            combatAttributeEffectDetailsMapper,
            combatShieldEffectDetailsMapper,
            combatProviderEffectDetailsMapper,
            combatEventEffectDetailsMapper,
            combatAbilityControlEffectDetailsMapper,
            combatStateEffectDetailsMapper
        );
    }

    @Test
    void publishLocksCreatesLogsThenMarksPublishedInOrder() {
        stubSuccessfulPublish(PREVIOUS_REVISION, PUBLISH_REVISION);

        ObjectNode body = objectMapper.createObjectNode();
        body.put("versionCode", "14.1");
        body.put("releaseDate", "2026-07-12");

        ObjectNode response = service.publishVersion(GAME_ID, body);

        InOrder order = inOrder(
            revisionService,
            gameVersionsMapper,
            combatGameProgressionSchemaMapper,
            combatAttributeDefinitionsMapper,
            combatTypesMapper,
            combatTypeRelationsMapper,
            combatGameEntitiesMapper,
            combatEntityAttributeValuesMapper,
            combatEntityAttributeStageValuesMapper,
            combatResourceDefinitionsMapper,
            combatEntityResourceValuesMapper,
            combatEntityResourceStageValuesMapper,
            combatProviderDefinitionsMapper,
            combatProviderFormulasMapper,
            combatProviderLifecyclesMapper,
            combatEntityProviderMountsMapper,
            combatProviderStateFieldsMapper,
            combatAbilityDefinitionsMapper,
            combatAbilityParametersMapper,
            combatAbilityStateFieldsMapper,
            combatAbilityPhasesMapper,
            combatAbilityCostsMapper,
            combatAbilityCooldownsMapper,
            combatProviderModifiersMapper,
            combatProviderListenersMapper,
            combatListenerMatchTypesMapper,
            combatEffectSequencesMapper,
            combatEffectStepsMapper,
            combatAbilityPhaseEffectSequencesMapper,
            combatListenerEffectSequencesMapper,
            combatProviderTickSequencesMapper,
            combatDamageEffectDetailsMapper,
            combatHealEffectDetailsMapper,
            combatResourceEffectDetailsMapper,
            combatAttributeEffectDetailsMapper,
            combatShieldEffectDetailsMapper,
            combatProviderEffectDetailsMapper,
            combatEventEffectDetailsMapper,
            combatAbilityControlEffectDetailsMapper,
            combatStateEffectDetailsMapper
        );

        order.verify(revisionService).lockState(GAME_ID);
        order.verify(gameVersionsMapper).findVersionByCode(GAME_ID, "14.1");
        order.verify(gameVersionsMapper).createVersion(
            eq(GAME_ID),
            eq("14.1"),
            eq(Date.valueOf("2026-07-12")),
            eq(PUBLISH_REVISION)
        );
        verifyAllLoggersInOrder(order, PREVIOUS_REVISION, PUBLISH_REVISION);
        order.verify(gameVersionsMapper).clearCurrentVersion(GAME_ID);
        order.verify(gameVersionsMapper).markVersionCurrent(any(Timestamp.class), eq(GAME_ID), eq(VERSION_ID));
        order.verify(revisionService).markPublished(GAME_ID, PUBLISH_REVISION);

        assertEquals(GAME_ID, response.get("gameId").asText());
        assertEquals("14.1", response.get("versionCode").asText());
        assertEquals("2026-07-12", response.get("releaseDate").asText());
        assertEquals(PUBLISH_REVISION, response.get("changeRevision").asLong());
        assertTrue(response.hasNonNull("publishedAt"));
        assertTrue(response.hasNonNull("updatedAt"));
    }

    @Test
    void publishPassesExclusiveOpenInclusiveCloseRevisionInterval() {
        stubSuccessfulPublish(PREVIOUS_REVISION, PUBLISH_REVISION);

        ObjectNode body = objectMapper.createObjectNode();
        body.put("versionCode", "14.2");

        service.publishVersion(GAME_ID, body);

        verify(combatGameProgressionSchemaMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, PREVIOUS_REVISION, PUBLISH_REVISION);
        verify(combatAttributeDefinitionsMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, PREVIOUS_REVISION, PUBLISH_REVISION);
        verify(combatTypesMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, PREVIOUS_REVISION, PUBLISH_REVISION);
        verify(combatStateEffectDetailsMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, PREVIOUS_REVISION, PUBLISH_REVISION);
        verify(gameVersionsMapper).createVersion(eq(GAME_ID), eq("14.2"), isNull(), eq(PUBLISH_REVISION));
    }

    @Test
    void repeatPublishWithNoChangesStillCallsLoggersWithEmptyInterval() {
        stubSuccessfulPublish(PUBLISH_REVISION, PUBLISH_REVISION);

        ObjectNode body = objectMapper.createObjectNode();
        body.put("versionCode", "14.3");

        ObjectNode response = service.publishVersion(GAME_ID, body);

        verify(combatGameProgressionSchemaMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, PUBLISH_REVISION, PUBLISH_REVISION);
        verify(combatAttributeDefinitionsMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, PUBLISH_REVISION, PUBLISH_REVISION);
        verify(combatTypesMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, PUBLISH_REVISION, PUBLISH_REVISION);
        verify(combatTypeRelationsMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, PUBLISH_REVISION, PUBLISH_REVISION);
        verify(combatGameEntitiesMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, PUBLISH_REVISION, PUBLISH_REVISION);
        verify(combatStateEffectDetailsMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, PUBLISH_REVISION, PUBLISH_REVISION);
        assertEquals(PUBLISH_REVISION, response.get("changeRevision").asLong());
        // SQL: change_revision > previous AND <= publish is empty when equal → no business log rows.
    }

    @Test
    void publishServiceDoesNotDependOnLegacyStores() {
        for (Field field : CombatDataPublishService.class.getDeclaredFields()) {
            assertFalse(
                field.getType().equals(PostgresReadStore.class)
                    || field.getType().equals(PostgresWriteStore.class),
                "unexpected legacy store field: " + field.getName()
            );
        }
        for (Constructor<?> ctor : CombatDataPublishService.class.getDeclaredConstructors()) {
            assertTrue(
                Stream.of(ctor.getParameterTypes())
                    .noneMatch(type -> type.equals(PostgresReadStore.class) || type.equals(PostgresWriteStore.class))
            );
        }
        assertFalse(
            Arrays.asList(CombatDataPublishService.class.getInterfaces())
                .contains(PostgresReadStore.class)
        );
    }

    @Test
    void copyChangedToLogXmlUsesOpenClosedRevisionInterval() throws Exception {
        try (InputStream in = getClass().getResourceAsStream(
            "/mapper/combatdata/attribute_definitions/CombatAttributeDefinitionsMapper.xml"
        )) {
            assertNotNull(in);
            Document doc = parseXmlWithoutExternalDtd(in);
            NodeList inserts = doc.getElementsByTagName("insert");
            boolean found = false;
            for (int i = 0; i < inserts.getLength(); i++) {
                var element = (org.w3c.dom.Element) inserts.item(i);
                if (!"copyChangedToLog".equals(element.getAttribute("id"))) {
                    continue;
                }
                found = true;
                String sql = element.getTextContent();
                assertTrue(sql.contains("change_revision > #{previousRevision}")
                    || sql.contains("change_revision &gt; #{previousRevision}"));
                assertTrue(sql.contains("change_revision <= #{publishRevision}")
                    || sql.contains("change_revision &lt;= #{publishRevision}"));
                assertTrue(sql.contains("ON CONFLICT"));
                assertTrue(sql.contains("attribute_definitions_log"));
            }
            assertTrue(found, "copyChangedToLog insert must exist");
        }
    }

    @Test
    void createVersionXmlWritesChangeRevision() throws Exception {
        try (InputStream in = getClass().getResourceAsStream("/mapper/game_versions/GameVersionsMapper.xml")) {
            assertNotNull(in);
            Document doc = parseXmlWithoutExternalDtd(in);
            NodeList selects = doc.getElementsByTagName("select");
            boolean found = false;
            for (int i = 0; i < selects.getLength(); i++) {
                var element = (org.w3c.dom.Element) selects.item(i);
                if (!"createVersion".equals(element.getAttribute("id"))) {
                    continue;
                }
                found = true;
                String sql = element.getTextContent();
                assertTrue(sql.contains("change_revision"));
                assertTrue(sql.contains("#{changeRevision}"));
                assertFalse(sql.toLowerCase().contains("data_hash"));
            }
            assertTrue(found);
        }
    }

    /** Parse mapper XML offline: block external DTD/entities so CI without network does not hang. */
    private static Document parseXmlWithoutExternalDtd(InputStream in) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setValidating(false);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
        factory.setExpandEntityReferences(false);
        DocumentBuilder builder = factory.newDocumentBuilder();
        builder.setEntityResolver((publicId, systemId) -> new InputSource(new StringReader("")));
        return builder.parse(in);
    }

    @Test
    void publishNeverTouchesLegacyStoreApis() {
        stubSuccessfulPublish(PREVIOUS_REVISION, PUBLISH_REVISION);

        ObjectNode body = objectMapper.createObjectNode();
        body.put("versionCode", "14.4");
        service.publishVersion(GAME_ID, body);

        verify(revisionService, never()).nextRevision(any());
        verify(gamesMapper).ensureGamePartitions(GAME_ID);
        verify(gameVersionsMapper).createVersion(eq(GAME_ID), eq("14.4"), isNull(), eq(PUBLISH_REVISION));
        verify(revisionService).markPublished(GAME_ID, PUBLISH_REVISION);
    }

    private void stubSuccessfulPublish(long previousRevision, long publishRevision) {
        when(revisionService.lockState(GAME_ID)).thenReturn(
            new GameDataRevisionService.GameDataStateView(
                GAME_ID,
                publishRevision,
                previousRevision,
                Timestamp.valueOf("2026-07-12 00:00:00")
            )
        );
        when(gameVersionsMapper.findVersionByCode(eq(GAME_ID), any())).thenReturn(null);
        when(gameVersionsMapper.createVersion(eq(GAME_ID), any(), any(), eq(publishRevision)))
            .thenReturn(VERSION_ID);
        when(gameVersionsMapper.markVersionCurrent(any(Timestamp.class), eq(GAME_ID), eq(VERSION_ID)))
            .thenReturn(1);
    }

    private void verifyAllLoggersInOrder(InOrder order, long previousRevision, long publishRevision) {
        order.verify(combatGameProgressionSchemaMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatAttributeDefinitionsMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatTypesMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatTypeRelationsMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatGameEntitiesMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatEntityAttributeValuesMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatEntityAttributeStageValuesMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatResourceDefinitionsMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatEntityResourceValuesMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatEntityResourceStageValuesMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatProviderDefinitionsMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatProviderFormulasMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatProviderLifecyclesMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatEntityProviderMountsMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatProviderStateFieldsMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatAbilityDefinitionsMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatAbilityParametersMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatAbilityStateFieldsMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatAbilityPhasesMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatAbilityCostsMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatAbilityCooldownsMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatProviderModifiersMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatProviderListenersMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatListenerMatchTypesMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatEffectSequencesMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatEffectStepsMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatAbilityPhaseEffectSequencesMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatListenerEffectSequencesMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatProviderTickSequencesMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatDamageEffectDetailsMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatHealEffectDetailsMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatResourceEffectDetailsMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatAttributeEffectDetailsMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatShieldEffectDetailsMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatProviderEffectDetailsMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatEventEffectDetailsMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatAbilityControlEffectDetailsMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
        order.verify(combatStateEffectDetailsMapper)
            .copyChangedToLog(GAME_ID, VERSION_ID, previousRevision, publishRevision);
    }
}
