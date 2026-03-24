type DebugWebhookEvent = {
  id: string;
  receivedAt: string;
  headers: Record<string, string | string[]>;
  body: unknown;
};

const MAX_DEBUG_EVENTS = 20;
const debugWebhookEvents: DebugWebhookEvent[] = [];

export function recordDebugWebhookEvent(input: { headers: Record<string, string | string[] | undefined>; body: unknown }) {
  const event: DebugWebhookEvent = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    receivedAt: new Date().toISOString(),
    headers: Object.fromEntries(
      Object.entries(input.headers)
        .filter((entry): entry is [string, string | string[]] => entry[1] !== undefined)
        .map(([key, value]) => [key, value]),
    ),
    body: input.body,
  };

  debugWebhookEvents.unshift(event);
  if (debugWebhookEvents.length > MAX_DEBUG_EVENTS) {
    debugWebhookEvents.length = MAX_DEBUG_EVENTS;
  }

  return event;
}

export function listDebugWebhookEvents() {
  return [...debugWebhookEvents];
}

export function clearDebugWebhookEvents() {
  debugWebhookEvents.length = 0;
}