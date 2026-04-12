package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.ActionRequest;

class MarkConsumeRemovesAvailabilityTest {

    @Test
    void consumingMarkRemovesSubsequentActionAvailability() {
        EngineDemoFacade facade = new EngineDemoFacade();
        IllegalStateException exception = assertThrows(
                IllegalStateException.class,
                () -> facade.run(
                        facade.init(AkaliESampleFactory.bundle()),
                        DemoFixtures.runInput(List.of(
                                new ActionRequest(0, "self", "enemy", "akali_e1"),
                                new ActionRequest(1, "self", "enemy", "akali_e2"),
                                new ActionRequest(2, "self", "enemy", "akali_e2")))));

        assertEquals("action_blocked:mark:akali_e_mark", exception.getMessage());
    }
}
