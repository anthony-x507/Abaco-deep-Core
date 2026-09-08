/**
 * ABACO — Agent Status / hooks
 * --------------------------------------------------------------------
 * React hooks that derive `AgentStatusInfo` from external sources
 * (SSE streams, WebSocket events, plain Promises).  The host shell
 * can plug any of these into the `AgentStatusBar` via the `status`
 * prop.
 */

import * as React from 'react';
import type { AgentStatusInfo } from './types';

export interface UseAgentStatusOptions {
    /** Auto-poll the source every `pollMs` ms. 0 disables polling. */
    pollMs?: number;
}

export interface AgentStatusSource {
    fetch(): Promise<AgentStatusInfo>;
}

export function useAgentStatus(
    initial: AgentStatusInfo,
    source?: AgentStatusSource,
    options: UseAgentStatusOptions = {},
): AgentStatusInfo {
    const [status, setStatus] = React.useState<AgentStatusInfo>(initial);
    const pollMs = options.pollMs ?? 0;

    React.useEffect(() => {
        if (!source || pollMs <= 0) return;
        let cancelled = false;
        const tick = async () => {
            try {
                const next = await source.fetch();
                if (!cancelled) setStatus(next);
            } catch {
                /* swallow — host will see stale data */
            }
        };
        void tick();
        const id = window.setInterval(() => void tick(), pollMs);
        return () => {
            cancelled = true;
            window.clearInterval(id);
        };
    }, [source, pollMs]);

    return status;
}

export function useAgentStatusState(
    initial: AgentStatusInfo,
): [AgentStatusInfo, (next: AgentStatusInfo) => void] {
    const [status, setStatus] = React.useState<AgentStatusInfo>(initial);
    const ref = React.useRef(setStatus);
    ref.current = setStatus;
    return [status, (next) => ref.current(next)];
}
