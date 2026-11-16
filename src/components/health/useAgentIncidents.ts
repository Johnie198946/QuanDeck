import { useCallback, useEffect, useRef, useState } from 'react';
import { gateway, getGatewaySettings } from '../../integration/gateway';
import { desktopHost, type RuntimeRunView } from '../../integration/desktop';

export function useAgentIncidents() {
  const [runs, setRuns] = useState<RuntimeRunView[]>([]);
  const [offline, setOffline] = useState(false);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    if (busy.current || !getGatewaySettings().token) return;
    busy.current = true;
    try {
      const data = await gateway.listRuntimeRuns();
      if (alive.current) { setRuns(data.runs); setOffline(false); }
    } catch { if (alive.current) setOffline(true); }
    finally { busy.current = false; }
  }, []);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    const notify = desktopHost()?.onRunEvent(() => void refresh());
    const navigate = desktopHost()?.onNavigate(target => {
      if (target.incidentId) { setSelectedRun(target.runId || null); setOpen(true); void refresh(); }
    });
    const update = () => void refresh();
    for (const name of ['focus', 'quandeck:gateway-settings', 'quandeck:agent-configured']) window.addEventListener(name, update);
    return () => { alive.current = false; clearInterval(timer); notify?.(); navigate?.(); for (const name of ['focus', 'quandeck:gateway-settings', 'quandeck:agent-configured']) window.removeEventListener(name, update); };
  }, [refresh]);
  // A fallback receipt is a visible audit notice, not a fabricated execution event.
  const incidents = runs.map(run => !run.health?.incident && run.fallback && run.acceptance === 'acknowledged' ? { ...run, health: { ...run.health, incident: { id:`fallback:${run.runId}`,code:'fallback',title:'启动前已换用备用 Agent',message:run.fallback.reason,detectedAt:run.acceptedAt || run.events.at(-1)?.at || '',status:'resolved' as const,kind:'attention' as const } } } : run).filter(run => run.health?.incident).sort((a,b) => (a.health!.incident!.status === 'open' ? 0 : 1) - (b.health!.incident!.status === 'open' ? 0 : 1) || b.health!.incident!.detectedAt.localeCompare(a.health!.incident!.detectedAt));
  return { incidents, offline, refresh, selectedRun, setSelectedRun, open, setOpen };
}
