import { useCallback, useEffect, useMemo, useState } from "react";

import { MockEventSource } from "../events/MockEventSource";
import type { ConnectionStatus, RoutingEvent } from "../events/types";

export interface RouterEventsResult {
  event: RoutingEvent;
  status: ConnectionStatus;
  advance: () => void;
  canAdvance: boolean;
  totalSteps: number;
}

/**
 * Binds a `RoutingEventSource` to React.
 *
 * TODO(scheduler): construct a different source here to go live. Components
 * receive the resulting `RoutingEvent` as props, so nothing else changes.
 */
export function useRouterEvents(): RouterEventsResult {
  const source = useMemo(() => new MockEventSource(), []);
  const [event, setEvent] = useState<RoutingEvent>(() => source.current());

  useEffect(() => source.subscribe(setEvent), [source]);

  const advance = useCallback(() => {
    source.next();
  }, [source]);

  return {
    event,
    status: source.getStatus(),
    advance,
    canAdvance: source.supportsManualAdvance,
    totalSteps: source.totalSteps,
  };
}
