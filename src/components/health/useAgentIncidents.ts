import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { projectTaskReminders } from '../../data/projectReminders';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { gateway, getGatewaySettings } from '../../integration/gateway';
import { desktopHost, type RuntimeRunView } from '../../integration/desktop';

export function useAgentIncidents(allProjects: boolean) {
  const { snap, projectSnapshots } = useWorkdeck();
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
  const incidents = useMemo(() => {
    const projects = allProjects ? [snap, ...projectSnapshots.filter(p => p.project.id !== snap.project.id)] : [snap];
    return projects.flatMap(p => projectTaskReminders(p,runs)).sort((a,b) => b.session.lastActivity.localeCompare(a.session.lastActivity));
  },[allProjects,snap,runs,projectSnapshots]);
  return { incidents, offline, refresh, selectedRun, setSelectedRun, open, setOpen };
}
