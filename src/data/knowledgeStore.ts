import { desktopHost } from '../integration/desktop';
import { emptyKnowledge, KNOWLEDGE_STORAGE_KEY, parseKnowledge, type KnowledgeLibrary } from './knowledgeNotes';

const changed = 'quandeck:personal-knowledge';
let mutationTail: Promise<void> = Promise.resolve();

export async function readKnowledge() {
  const host = desktopHost();
  if (host?.readKnowledge) return parseKnowledge(await host.readKnowledge());
  if (!globalThis.localStorage) return emptyKnowledge();
  return parseKnowledge(localStorage.getItem(KNOWLEDGE_STORAGE_KEY));
}

export function onKnowledgeChange(handler: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === KNOWLEDGE_STORAGE_KEY) handler(); };
  const offDesktop = desktopHost()?.onKnowledgeChange?.(handler);
  window.addEventListener(changed, handler);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(changed, handler);
    window.removeEventListener('storage', storage);
    offDesktop?.();
  };
}

export function mutateKnowledge(mutate: (library: KnowledgeLibrary) => void): Promise<KnowledgeLibrary> {
  const persist = async () => {
    const host = desktopHost();
    if (host && (!host.readKnowledge || !host.compareKnowledge)) throw new Error('桌面版暂未提供笔记存储');
    for (let attempt = 0; attempt < 4; attempt++) {
      const before = host?.readKnowledge ? await host.readKnowledge() : localStorage.getItem(KNOWLEDGE_STORAGE_KEY);
      const library = parseKnowledge(before);
      mutate(library);
      const payload = JSON.stringify(library);
      if (host?.compareKnowledge) {
        if (!await host.compareKnowledge(before, payload)) continue;
      } else {
        localStorage.setItem(KNOWLEDGE_STORAGE_KEY, payload);
      }
      window.dispatchEvent(new Event(changed));
      return library;
    }
    throw new Error('笔记刚从另一个窗口更新，请重试');
  };
  const task = mutationTail.then(async () => {
    const locks = !desktopHost() && globalThis.navigator?.locks;
    return locks ? await locks.request(KNOWLEDGE_STORAGE_KEY, persist) : await persist();
  });
  mutationTail = task.then(() => {}, () => {});
  return task;
}
