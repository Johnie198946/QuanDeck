import { TaskIcon } from "../ui/TaskIcon";
import "../ui/task-label.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { createHttpSearchBackend, createLocalSearchBackend, SearchRequestGate } from "../../data/search";
import type { SearchHit, SearchKind, SearchResponse } from "../../data/search";
import { usePreferences } from "../../state/preferences";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { QuanDeckLogo } from "../brand/QuanDeckLogo";
import { Icon } from "../ui/Icon";
import "./navigation.css";
import { ProjectSwitcher } from "../projects/ProjectSwitcher";
import { AgentHealthCenter } from "../health/AgentHealthCenter";

const kindLabel: Record<SearchKind, string> = { task: "任务", work: "子任务", session: "会话", journal: "日记", plan: "方案", conclusion: "结论" };
const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

function ProjectSearch() {
  const { snap, api, locateTask, locateWorkItem, selectWork, toast, closeWorkspace, openWorkspace, openSourceSession } = useWorkdeck();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const gate = useRef(new SearchRequestGate());
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const backend = useMemo(() => import.meta.env.VITE_WORKDECK_API ? createHttpSearchBackend(import.meta.env.VITE_WORKDECK_API) : createLocalSearchBackend(() => snapRef.current), []);
  const results = response?.items ?? [];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); clearTimeout(blurTimer.current); gate.current.cancel(); };
  }, []);
  useEffect(() => {
    gate.current.cancel();
    setError("");
    setActive(0);
    setResponse(null);
    if (!focused || !query.trim()) { setLoading(false); return; }
    setLoading(true);
    const timeout = setTimeout(() => {
      gate.current.run(backend, { query, projectId: snap.project.id, limit: 12 }).then(result => {
        if (!result) return;
        setResponse(result);
        setLoading(false);
      }).catch(error => { setError(error instanceof Error ? error.message : "搜索暂不可用，请重试"); setLoading(false); });
    }, 140);
    return () => { clearTimeout(timeout); gate.current.cancel(); };
  }, [query, focused, snap.version, snap.project.id, backend]);

  const pick = async (hit: SearchHit) => {
    const navigate = (api as typeof api & { navigateToDate?: (date: string) => Promise<void> }).navigateToDate;
    if (hit.date !== snap.date) {
      if (!navigate) { toast("该结果在其他日期；当前数据源尚未提供跨日打开", "error"); return; }
      try { await navigate.call(api, hit.date); await nextFrame(); } catch { toast("打开该日期失败，请稍后重试", "error"); return; }
    }
    const target = hit.target;
    setFocused(false);
    input.current?.blur();
    setQuery("");
    if (hit.kind === "plan" || hit.kind === "conclusion") {
      if (!target.taskId) { toast("搜索结果缺少任务位置", "error"); return; }
      openWorkspace(target.taskId, { view: "plan", itemId: target.itemId ?? null, scope: target.sectionId ?? "root", pane: hit.kind === "conclusion" ? "side" : "main" });
      await nextFrame(); await nextFrame();
      if (target.conclusionId) {
        window.dispatchEvent(new CustomEvent("quandeck:select-conclusion", { detail: { planId: target.planId, conclusionId: target.conclusionId } }));
        await nextFrame();
      }
      const selector = target.conclusionId ? `[data-discussion-conclusion="${CSS.escape(target.conclusionId)}"]` : target.sectionId ? `[data-plan-section="${CSS.escape(target.sectionId)}"]` : ".qd-ws";
      document.querySelector(selector)?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    } else if (hit.kind === "session" && target.sessionId) {
      openSourceSession(target.sessionId);
    } else {
      closeWorkspace();
      window.dispatchEvent(new CustomEvent("quandeck:show-journal"));
      await nextFrame();
      if (target.itemId && target.taskId) { selectWork(target.taskId, target.itemId); locateWorkItem(target.taskId, target.itemId); }
      else if (target.taskId) locateTask(target.taskId);
      else {
        await nextFrame();
        const node = document.querySelector<HTMLElement>(target.blockId ? `[data-journal-block="${CSS.escape(target.blockId)}"]` : ".qd-page-title");
        node?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        const focusable = node?.querySelector<HTMLElement>("[tabindex],input,textarea,button") ?? node;
        focusable?.focus({ preventScroll: true });
      }
    }
  };

  return <div className={`qd-search qd-project-search ${focused ? "is-open" : ""}`}>
    <Icon name="search" size={17} />
    <input ref={input} value={query} maxLength={200} placeholder="搜索" aria-label="搜索项目内容" role="combobox" aria-expanded={focused && !!query.trim()} aria-controls="qd-search-list" aria-autocomplete="list" aria-activedescendant={focused && results[active] ? `qd-search-option-${active}` : undefined}
      onChange={event => setQuery(event.target.value)} onFocus={() => { clearTimeout(blurTimer.current); setFocused(true); }}
      onBlur={() => { blurTimer.current = setTimeout(() => setFocused(false), 120); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "ArrowDown") { event.preventDefault(); setActive(value => results.length ? (value + 1) % results.length : 0); }
        if (event.key === "ArrowUp") { event.preventDefault(); setActive(value => results.length ? (value - 1 + results.length) % results.length : 0); }
        if (event.key === "Enter" && results[active]) { event.preventDefault(); void pick(results[active]); }
        if (event.key === "Escape") { event.preventDefault(); setFocused(false); setQuery(""); input.current?.blur(); }
      }} />
    <kbd>⌘K</kbd>
    {focused && query.trim() && <div className="qd-search-results">
      <div className="qd-search-scope">{response?.scope === "project_index" ? "当前项目" : "当前日记与已加载内容"}<span>{response ? `${response.total} 条` : ""}</span></div>
      <div role="status" className="qd-search-status">{loading ? "搜索中…" : error || (response && !results.length ? "没有匹配结果，试试关键词或近似写法" : "")}</div>
      <div id="qd-search-list" role="listbox" aria-label="搜索结果" aria-busy={loading}>
        {results.map((result, index) => <button key={result.id} id={`qd-search-option-${index}`} type="button" role="option" aria-selected={active === index} tabIndex={-1} className="qd-search-hit" onMouseEnter={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => void pick(result)}>
          <span className="qd-search-kind">{kindLabel[result.kind]}</span>
          <span className="qd-search-hit-copy"><strong className="qd-task-label"><TaskIcon snapshot={snap} taskId={result.target.taskId} workItemId={result.target.itemId} sessionId={result.target.parentSessionId ?? result.target.sessionId} subAgentId={result.target.subAgentId} size={18} /><span>{result.title}</span></strong><small>{result.snippet}</small>{result.date !== snap.date && <time>{result.date}</time>}</span>
          <Icon name="chevron-right" size={14} />
        </button>)}
      </div>
      {!!results.length && <div className="qd-search-help">↑↓ 选择 · 回车打开{response?.nextCursor ? " · 仅显示最相关的 12 条，可增加关键词" : ""}</div>}
    </div>}
  </div>;
}

export type MainPage = "overview" | "tasks" | "results";

export function TopBar({ fullscreen, onFullscreen, onToggleSchedule, scheduleOpen, page, onNavigate, onSettings, settingsOpen, onCreateProject, onEditProject }: {
  fullscreen: boolean; onFullscreen: () => void; onToggleSchedule: () => void; scheduleOpen: boolean; page: MainPage; onNavigate: (page: MainPage) => void; onSettings: () => void; settingsOpen: boolean; onCreateProject: () => void; onEditProject: (id: string) => void;
}) {
  const { snap, api } = useWorkdeck();
  const { preferences } = usePreferences();
  return <header className="qd-topbar">
    <div className="qd-topbar-left">
      <QuanDeckLogo />
      <span className="qd-divider" aria-hidden="true" />
      <ProjectSwitcher onCreate={onCreateProject} onEdit={onEditProject} />
      <nav className="qd-nav" aria-label="主导航">
        {([["overview", "总览"], ["tasks", "任务"], ["results", "成果"]] as [MainPage, string][]).map(([key, label]) => <button type="button" key={key} className={`qd-nav-item ${page === key ? "is-active" : ""}`} aria-current={page === key ? "page" : undefined} onClick={() => onNavigate(key)}>{label}</button>)}
      </nav>
    </div>
    <div className="qd-topbar-right">
      {page === "tasks" && <button type="button" className={`qd-schedule-toggle ${scheduleOpen ? "is-on" : ""}`} onClick={onToggleSchedule} aria-pressed={scheduleOpen}><Icon name="clock" size={17} />日程</button>}
      {snap.project.id && <ProjectSearch key={snap.project.id} />}
      <AgentHealthCenter />
      <button type="button" className="qd-icon-btn qd-fullscreen-toggle" aria-label={fullscreen ? "退出全屏" : "进入全屏"} title={fullscreen ? "退出全屏" : "进入全屏"} aria-pressed={fullscreen} onClick={onFullscreen}><Icon name={fullscreen ? "collapse" : "expand"} size={18} /></button>
      <button type="button" className="qd-profile-avatar" aria-label="打开我的设置" aria-haspopup="dialog" aria-expanded={settingsOpen} title={preferences.name} onClick={onSettings}>
        {preferences.name === "我的工作台" ? <Icon name="user" size={19} /> : <span>{Array.from(preferences.name.trim())[0] || "我"}</span>}
      </button>
    </div>
  </header>;
}
