import { useEffect, useState } from "react";
import { localDataSource } from "./data/repository";
import { createDesktopDataSource } from "./data/desktopRepository";
import { desktopHost } from "./integration/desktop";
import { createHttpDataSource } from "./data/httpRepository";
import { WorkdeckProvider, useWorkdeck } from "./state/WorkdeckContext";
import { ProjectDialog } from "./components/projects/ProjectDialog";
import { ProjectSwitcher } from "./components/projects/ProjectSwitcher";
import { Dashboard } from "./components/results/Dashboard";
import { SettingsDialog } from "./components/settings/SettingsDialog";
import { ResultsGallery } from "./components/results/ResultsGallery";
import { usePreferences } from "./state/preferences";
import type { MainPage } from "./components/layout/TopBar";
import { TopBar } from "./components/layout/TopBar";
import { ScheduleSummary } from "./components/schedule/ScheduleSummary";
import { ScheduleSheet } from "./components/schedule/ScheduleSheet";
import { Journal } from "./components/journal/Journal";
import { ExecutionRail } from "./components/deck/ExecutionRail";
import { Toasts } from "./components/ui/Toasts";
import { MergeFxLayer } from "./components/journal/MergeFx";
import { Workspace } from "./components/workspace/Workspace";
import "./components/layout/fullscreen.css";
import "./components/layout/workspace-refresh.css";
import { QuanDeckMark } from "./components/brand/QuanDeckLogo";
import { deriveProjectActivity, waitingCount } from "./data/projectActivity";

import { useWorkbenchDisplay } from "./components/layout/useWorkbenchDisplay";

type MobileView = "schedule" | "journal" | "deck";
const host = desktopHost();
const dataSource = host ? createDesktopDataSource(host) : import.meta.env.VITE_WORKDECK_API ? createHttpDataSource(import.meta.env.VITE_WORKDECK_API) : localDataSource;

function Workbench() {
  const { snap, drag, setDrag, workspace, closeWorkspace, api, toast } = useWorkdeck();
  const { preferences } = usePreferences();
  const [page, setPage] = useState<MainPage>("overview");
  const [projectDialog, setProjectDialog] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const activePage = workspace ? (workspace.view === "results" ? "results" : "tasks") : page;
  const display = useWorkbenchDisplay(`${activePage}:${workspace?.view ?? "main"}`, preferences.reduceMotion);
  useEffect(() => {
    if (workspace) setPage(workspace.view === "results" ? "results" : "tasks");
  }, [workspace?.view]);
  const navigate = (next: MainPage) => { closeWorkspace(); setPage(next); if (next === "tasks") setMobile("journal"); setScheduleDrawer(false); };
  const [runtimeOffline, setRuntimeOffline] = useState(false);
  const [mobile, setMobile] = useState<MobileView>("journal");
  const [scheduleDrawer, setScheduleDrawer] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [scheduleDate, setScheduleDate] = useState<string>();
  const activity = deriveProjectActivity(snap);
  const waitCount = waitingCount(activity.counts);

  useEffect(() => {
    const status = (event: Event) => setRuntimeOffline(!(event as CustomEvent<{ connected: boolean }>).detail.connected);
    window.addEventListener("quandeck:runtime-status", status);
    return () => window.removeEventListener("quandeck:runtime-status", status);
  }, []);

  useEffect(() => {
    const show = () => { setMobile("journal"); setPage("tasks"); };
    const deck = () => { setMobile("deck"); setPage("tasks"); };
    const schedule = () => { setMobile("schedule"); setPage("tasks"); setScheduleDrawer(window.innerWidth >= 960); };
    window.addEventListener("quandeck:show-journal", show);
    window.addEventListener("quandeck:show-deck", deck);
    window.addEventListener("quandeck:show-schedule", schedule);
    return () => {
      window.removeEventListener("quandeck:show-journal", show);
      window.removeEventListener("quandeck:show-deck", deck);
      window.removeEventListener("quandeck:show-schedule", schedule);
    };
  }, []);

  useEffect(() => { setSheet(false); setScheduleDrawer(false); setMobile("journal"); }, [snap.project.id]);

  // 窄屏拖动任务时切到执行区不可行，改为由纸飞机菜单等效完成；这里确保拖动结束一定复位
  useEffect(() => {
    if (!drag) return;
    const end = () => setDrag(null);
    window.addEventListener("drop", end);
    window.addEventListener("dragend", end);
    return () => {
      window.removeEventListener("drop", end);
      window.removeEventListener("dragend", end);
    };
  }, [drag, setDrag]);

  return (
    <div ref={display.root} className={`qd-app qd-focused-workbench ${display.fullscreen ? "is-fullscreen" : ""} ${drag ? "is-dragging" : ""} ${display.expanded ? "is-expanded" : ""} ${display.wide ? "is-wide" : ""}`}>
      <TopBar fullscreen={display.fullscreen} fullscreenBusy={display.busy} onToggleFullscreen={() => { void display.toggle().catch(() => toast("暂时无法切换全屏，可使用系统窗口的放大按钮", "error")); }} onToggleSchedule={() => setScheduleDrawer((v) => !v)} scheduleOpen={scheduleDrawer} page={activePage} onNavigate={navigate} onSettings={() => setSettingsOpen(true)} settingsOpen={settingsOpen} onCreateProject={() => setProjectDialog("new")} onEditProject={setProjectDialog} />
      <div className="qd-mobile-project"><ProjectSwitcher onCreate={() => setProjectDialog("new")} onEdit={setProjectDialog} /><span>{snap.project.id ? "当前项目" : "项目工作区"}</span></div>
      {api.mode === "live" && runtimeOffline && <div className="qd-runtime-notice" role="status">
        连接中断，当前显示最后同步的记录。
        <button type="button" className="qd-link" onClick={() => { void api.load().then(() => toast("已刷新记录，正在重连实时更新")).catch(() => toast("服务仍不可用，请稍后重试", "error")); }}>重新连接</button>
      </div>}

      {!!snap.project.id && !workspace && page === "tasks" && (
      <div className="qd-mobile-tabs" role="tablist" aria-label="工作台区域">
        {(
          [
            ["schedule", "日程"],
            ["journal", "任务"],
            ["deck", `执行 ${activity.entries.length}`],
          ] as [MobileView, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mobile === key}
            className={mobile === key ? "is-on" : ""}
            onClick={() => setMobile(key)}
          >
            {label}
            {key === "deck" && waitCount > 0 && (
              <span className="qd-tab-badge">{waitCount} 待处理</span>
            )}
          </button>
        ))}
      </div>
      )}

      {!snap.project.id || !workspace && page === "overview" ? <Dashboard onTasks={() => navigate("tasks")} onResults={() => navigate("results")} onCreateProject={() => setProjectDialog("new")} onEditProject={setProjectDialog} /> : !workspace && page === "results" ? <ResultsGallery onNew={() => navigate("tasks")} /> : <main
        className={`qd-grid show-${mobile} ${workspace ? "has-ws" : ""} ${workspace?.focus || workspace?.view === "results" ? "is-focus" : ""}`}
      >
        <div className={`qd-col qd-col-schedule ${scheduleDrawer ? "is-drawer-open" : ""}`}>
          <ScheduleSummary onExpand={date => { setScheduleDate(date); setSheet(true); }} />
        </div>
        {scheduleDrawer && (
          <button
            type="button"
            className="qd-scrim"
            aria-label="关闭日程"
            onClick={() => setScheduleDrawer(false)}
          />
        )}
        {workspace ? (
          <div className="qd-col qd-col-ws">
            <Workspace />
          </div>
        ) : (
          <>
            <div className="qd-col qd-col-journal">
              <Journal key={snap.project.id} />
            </div>
            <div className="qd-col qd-col-rail">
              <ExecutionRail />
            </div>
          </>
        )}
      </main>}

      {projectDialog !== null && <ProjectDialog projectId={projectDialog === "new" ? undefined : projectDialog} onClose={() => setProjectDialog(null)} onSaved={created => { if (created) navigate("tasks"); }} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      <ScheduleSheet key={snap.project.id} open={sheet} initialDate={scheduleDate} onClose={() => setSheet(false)} />
      <MergeFxLayer />
      <Toasts />
    </div>
  );
}

function Loading() {
  return (
    <div className="qd-loading" role="status">
      <QuanDeckMark size={32} />
      <span>正在载入今日工作台…</span>
    </div>
  );
}

export default function App() {
  return (
    <WorkdeckProvider source={dataSource} fallback={<Loading />}>
      <Workbench />
    </WorkdeckProvider>
  );
}
