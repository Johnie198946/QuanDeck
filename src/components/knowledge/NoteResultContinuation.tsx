import { useEffect, useMemo, useRef, useState } from 'react';
import { listResultContinuations, type ResultContinuationChoice } from '../../data/resultContinuation';
import type { Snapshot } from '../../data/types';
import { desktopHost, type ResultFilePreview } from '../../integration/desktop';
import { Icon } from '../ui/Icon';

type FileCheck = { preview: ResultFilePreview; error?: undefined } | { preview?: undefined; error: string };
type SelectedSource = { id: string; choice?: ResultContinuationChoice; key: string };

function useResultPreviews(sources: SelectedSource[]) {
  const previewFiles = desktopHost()?.previewResultFiles;
  const cache = useRef(new Map<string, Promise<FileCheck>>());
  const [results, setResults] = useState<Record<string, FileCheck>>({});

  useEffect(() => {
    let active = true;
    const keys = new Set(sources.map(source => source.key));
    for (const key of cache.current.keys()) if (!keys.has(key)) cache.current.delete(key);
    setResults(current => Object.keys(current).some(key => !keys.has(key))
      ? Object.fromEntries(Object.entries(current).filter(([key]) => keys.has(key))) : current);
    for (const {choice, key} of sources) {
      if (!choice || !previewFiles) continue;
      let pending = cache.current.get(key);
      if (!pending) {
        const {projectId, artifactId, hash} = choice.pin;
        pending = previewFiles(projectId, artifactId, hash).then(
          preview => ({preview}),
          error => ({error: error instanceof Error ? error.message : '读取成果文件失败'}),
        );
        cache.current.set(key, pending);
      }
      void pending.then(result => {
        if (active) setResults(current => current[key] === result ? current : {...current, [key]:result});
      });
    }
    return () => { active = false; };
  }, [sources, previewFiles]);
  return results;
}

export function useNoteContinuation(project: Snapshot | undefined, text: string, initialArtifactId?: string) {
  const [enabled, setEnabled] = useState(!!initialArtifactId);
  const [ids, setIds] = useState<string[]>(() => initialArtifactId ? [initialArtifactId] : []);
  const [requirement, setRequirement] = useState(text);
  const [attempts, setAttempts] = useState<Record<string, number>>({});
  const choices = useMemo(() => enabled && project ? listResultContinuations(project) : [], [enabled, project]);
  const sources = useMemo(() => {
    if (!enabled) return [];
    const byId = new Map(choices.map(choice => [choice.pin.artifactId, choice]));
    return ids.map(id => {
      const choice = byId.get(id);
      return {id, choice, key: JSON.stringify([choice?.pin.projectId, id, choice?.pin.hash, attempts[id]])};
    });
  }, [enabled, ids, choices, attempts]);
  const checks = useResultPreviews(sources);
  const available = !!desktopHost()?.previewResultFiles && !!desktopHost()?.freezeResultFiles;
  const request = requirement.trim();
  const ready = available && !!request && request.length <= 8000 && sources.length > 0 &&
    sources.every(source => !!source.choice && !!checks[source.key]?.preview);

  function toggle(id: string) {
    setIds(current => current.includes(id) ? current.filter(old => old !== id) : [...current, id]);
  }
  function reload(id: string) {
    setAttempts(current => ({...current, [id]:(current[id] ?? 0) + 1}));
  }
  async function freeze() {
    const freezeFiles = desktopHost()?.freezeResultFiles;
    if (!ready || !freezeFiles) throw Error('请勾选成果、填写开发要求，并等待文件核对完成。');
    const frozen = [];
    for (const {id, choice, key} of sources) {
      const preview = checks[key]?.preview;
      if (!choice || !preview) throw Error('成果已变化，请重新核对。');
      const {pin} = choice;
      try {
        const files = await freezeFiles(pin.projectId, id, pin.hash, preview.fingerprint);
        frozen.push({pin, files});
      } catch (error) {
        reload(id);
        throw Error(choice.title + ' · v' + choice.version + '：' + (error instanceof Error ? error.message : '核对文件失败'));
      }
    }
    const files = [...new Map(frozen.flatMap(source => source.files).map(file => [file.id, file])).values()];
    const origin = frozen.length === 1 ? {...frozen[0].pin, requirement:request} : {
      requirement:request, sources:frozen.map(source => ({...source.pin, fileIds:source.files.map(file => file.id)})),
    };
    return {files, origin};
  }
  return {enabled, setEnabled, choices, sources, checks, toggle, reset:() => setIds([]), reload,
    available, requirement, setRequirement, freeze, ready};
}

function sourceStatus(choice: ResultContinuationChoice) {
  if (choice.historical) return '历史版本，仅作参考';
  if (choice.returned) return '已退回，仅作参考';
  return choice.status === 'accepted' ? '已验收' : '候选，待验收';
}

export function NoteResultContinuation({model, busy}: {model: ReturnType<typeof useNoteContinuation>; busy: boolean}) {
  const {choices, sources, checks} = model;
  const choicesByTitle = new Map<string, Set<string>>();
  for (const choice of choices) {
    const tasks = choicesByTitle.get(choice.title) ?? new Set<string>();
    tasks.add(choice.taskTitle);
    choicesByTitle.set(choice.title, tasks);
  }
  return <section className="qd-note-continuation" aria-label="成果续做">
    <label className="qd-continuation-toggle"><input type="checkbox" checked={model.enabled} disabled={busy}
      onChange={event => model.setEnabled(event.target.checked)}/>引用已有成果</label>
    {model.enabled && <>
      <fieldset className="qd-continuation-picker" aria-label="来源成果与版本" disabled={busy}>
        <legend>来源成果与版本 <span aria-live="polite">已选 {sources.length} 项</span></legend>
        {choices.length ? <div className="qd-continuation-choices">
          {choices.map(choice => {
            const id = choice.pin.artifactId;
            const selected = sources.find(source => source.id === id);
            const check = selected && checks[selected.key];
            return <div className="qd-continuation-option" key={id}>
              <label className="qd-continuation-row">
                <input type="checkbox" value={id} checked={!!selected} onChange={() => model.toggle(id)}/>
                <span><strong>{choice.title}</strong><small>{choicesByTitle.get(choice.title)!.size > 1 && choice.taskTitle + ' · '}{sourceStatus(choice)}</small></span>
                <span className="qd-continuation-version">v{choice.version}</span>
              </label>
              {selected && check?.preview && <details className="qd-continuation-source">
                <summary><Icon name="chevron-right" size={14}/>预览正文与文件
                  <small>{check.preview.files.length ? check.preview.files.length + ' 个文件' : '仅正文'}</small></summary>
                <div className="qd-continuation-preview">
                  <pre>{choice.body || '这版成果没有正文。'}</pre>
                  {check.preview.files.length > 0 && <ul aria-label="成果文件">{check.preview.files.map(file =>
                    <li key={file.name + file.sha256}>{file.name}</li>)}</ul>}
                </div>
              </details>}
              {check?.error ? <p role="alert">{check.error} <button type="button" className="qd-link"
                disabled={busy} onClick={() => model.reload(id)}>重新核对文件</button></p>
                : selected && model.available && !check?.preview && <p role="status">正在核对成果文件…</p>}
            </div>;
          })}
        </div> : <p role="status">这个项目目前没有可用于开发的成果。可以更换目标项目。</p>}
      </fieldset>
      {!model.available && <p role="alert">此客户端不能核对成果文件，请使用支持此功能的桌面版。</p>}
      {sources.filter(source => !source.choice).map(({id}) =>
        <p key={id} role="alert">所选成果已不可用。 <button type="button" className="qd-link" disabled={busy}
          onClick={() => model.toggle(id)}>移除该项</button></p>)}
      <label className="qd-handoff-field">这次的开发要求
        <textarea rows={3} maxLength={8000} disabled={busy} value={model.requirement}
          onChange={event => model.setRequirement(event.target.value)} placeholder="写下要结合所选成果完成的事。"/>
      </label>
      {model.requirement.trim().length > 8000 && <p role="alert">请将这次的开发要求缩短到 8000 字以内。</p>}
    </>}
  </section>;
}
