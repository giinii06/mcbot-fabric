package kr.mcbot.bridge.bridge;

/** Response of the bridge HTTP API. */
public record HttpResult(int status, String body) {
}
