// Unofficial iframe Player API. Runtime compatibility has not been checked on Rutube.
export const rutubeProtocol = {
  events: {
    ready: "player:ready",
    state: "player:changeState",
    time: "player:currentTime",
  },
  commands: {
    seek: "player:setCurrentTime",
    pause: "player:pause",
    play: "player:play",
  },
} as const;

export type RutubeEvent =
  | { kind: "ready" }
  | { kind: "state"; playing: boolean }
  | { kind: "time"; position: number };

export function readRutubeEvent(raw: unknown): RutubeEvent | null {
  let value: unknown = raw;
  if (typeof value === "string") {
    if (value.length > 8192) return null;
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || !value) return null;
  const { type, data } = value as {
    type?: unknown;
    data?: { state?: unknown; time?: unknown };
  };
  if (type === rutubeProtocol.events.ready) return { kind: "ready" };
  if (type === rutubeProtocol.events.state && typeof data?.state === "string")
    return { kind: "state", playing: data.state === "playing" };
  if (
    type === rutubeProtocol.events.time &&
    typeof data?.time === "number" &&
    Number.isFinite(data.time) &&
    data.time >= 0
  )
    return { kind: "time", position: data.time };
  return null;
}

export function rutubeCommand(
  command: keyof typeof rutubeProtocol.commands,
  time?: number,
) {
  return JSON.stringify({
    type: rutubeProtocol.commands[command],
    data: command === "seek" ? { time } : {},
  });
}
