package kr.mcbot.bridge.util;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;

/** Safe Adventure component -> plain text conversion (bundled with paper-api). */
public final class ComponentText {

    private ComponentText() {
    }

    public static String plain(Component component) {
        if (component == null) {
            return "";
        }
        try {
            return PlainTextComponentSerializer.plainText().serialize(component);
        } catch (Throwable ex) {
            return "";
        }
    }

    public static String plainOrNull(Component component) {
        String value = plain(component);
        return value.isBlank() ? null : value;
    }
}
