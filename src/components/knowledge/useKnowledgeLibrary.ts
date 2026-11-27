import { useEffect, useState } from 'react';
import { emptyKnowledge } from '../../data/knowledgeNotes';
import { onKnowledgeChange, readKnowledge } from '../../data/knowledgeStore';

export function useKnowledgeLibrary() {
  const [library, setLibrary] = useState(emptyKnowledge);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let sequence = 0, current = true;
    const load = async () => {
      const ticket = ++sequence;
      try {
        const next = await readKnowledge();
        if (current && sequence === ticket) { setLibrary(next); setError(''); setReady(true); }
      } catch (error) {
        if (current && sequence === ticket) { setLibrary(emptyKnowledge()); setError(error instanceof Error ? error.message : '暂时无法加载资料'); setReady(true); }
      }
    };
    const unsubscribe = onKnowledgeChange(() => void load());
    void load();
    return () => { current = false; unsubscribe(); };
  }, []);
  return { library, error, ready };
}
