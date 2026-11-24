import { useMemo, useState } from "react";
import { feedbackOptions, type MemoryEffect } from "../../data/projectMemoryNotes";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { ProjectReflection } from "./ProjectReflection";

const effectLabels = { helpful: "有效", adjust: "需调整", inapplicable: "不适用" } as const;

export function AcceptedReflection({ artifactId }: { artifactId: string }) {
  return (
    <section aria-label="本次交付复盘">
      <AppliedLessons key={artifactId} artifactId={artifactId} />
      <NewLesson key={"new-" + artifactId} artifactId={artifactId} />
    </section>
  );
}

export function NewLesson({ artifactId }: { artifactId: string }) {
  const { snap } = useWorkdeck();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="qd-link" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "收起新做法" : "记录新做法"}
      </button>
      {open && <ProjectReflection snapshot={snap} fixedArtifactId={artifactId} />}
    </>
  );
}

export function AppliedLessons({ artifactId, pendingOnly = false }: { artifactId: string; pendingOnly?: boolean }) {
  const { snap, api } = useWorkdeck();
  const options = useMemo(() => feedbackOptions(snap, artifactId), [snap, artifactId]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [effects, setEffects] = useState<Record<string, MemoryEffect>>({}),
    [reasons, setReasons] = useState<Record<string, string>>({});
  const rows = options.map(option => ({
    ...option,
    previous: snap.collaboration?.memoryFeedback?.find(f => f.reviewId === option.review.id && f.lessonId === option.note.id),
  })).filter(row => !pendingOnly || !row.previous);
  if (!rows.length) return null;
  return (
    <section className="qd-lesson-effects" aria-label="本次收到的经验">
      <h4>这次收到的经验有用吗？</h4>
      {rows.map(({ note, artifact, previous }) => {
        const effect = effects[note.id], reason = reasons[note.id]?.trim();
        return (
          <div key={note.id} role="group" aria-label={note.situation}>
            <strong>{note.action}</strong>
            <p>{note.situation} · {note.limitation}</p>
            {previous ? (
              <p>{effectLabels[previous.effect]} · {previous.reason}</p>
            ) : (
              <>
                <div className="qd-lesson-effects-actions" role="group" aria-label="采用效果">
                  {(Object.keys(effectLabels) as MemoryEffect[]).map(value => (
                    <button key={value} type="button" className="qd-btn ghost" disabled={busy} aria-pressed={effect === value}
                      onClick={() => setEffects(v => ({ ...v, [note.id]: value }))}>{effectLabels[value]}</button>
                  ))}
                </div>
                {effect && <form onSubmit={async event => {
                  event.preventDefault();
                  if (busy || !reason) return;
                  setBusy(true); setMessage("");
                  try {
                    const result = await api.collaborate({
                      projectId: snap.project.id, type: "record_memory_feedback", idempotencyKey: crypto.randomUUID(),
                      payload: { lessonId: note.id, artifactId, artifactHash: artifact.hash, effect, reason },
                    });
                    setMessage(result.ok ? "已记下采用效果" : result.message || "保存失败");
                  } catch (error) {
                    setMessage(error instanceof Error ? error.message : "保存失败");
                  } finally { setBusy(false); }
                }}>
                  <label>实际情况
                    <input maxLength={1000} required value={reasons[note.id] ?? ""}
                      onChange={e => { const value = e.target.value; setReasons(v => ({ ...v, [note.id]: value })); }} />
                  </label>
                  <button type="submit" className="qd-btn" disabled={busy || !reason}>记下反馈</button>
                </form>}
              </>
            )}
          </div>
        );
      })}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
