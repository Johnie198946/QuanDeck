// A delivery may include a verbatim completion manifest. Keep prose and evidence
// available independently, including on receipts written by older agents.
const field = /^\s*(?:[-*]\s+)?(?:\*\*|`)?(?:task_id|status|branch|worktree|head\/local_commit|local_commit|remote_sha|server_before|server_after|health_check|functional_check|rollback_point|manifest|remaining_risks)(?:\*\*|`)?\s*[:：]/i;
const heading = /^\s*(?:#{1,6}\s*)?(?:\*\*)?(?:任务记录|执行记录|交付记录|完成记录|completion manifest)(?:\*\*)?\s*[:：]?\s*$/i;
const reportLink = /^\s*[-*]?\s*\[[^\]]+\]\([^\n]*\bchange-manifests\/[^\n]*\)\s*$/i;

export function receiptNarrative(text: string) {
  const lines = text.split(/\r?\n/);
  const prose: string[] = [];
  const evidence: string[] = [];
  let fence = '';
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker.startsWith(fence)) fence = '';
      prose.push(lines[index++]);
      continue;
    }
    if (!fence && (heading.test(line) || field.test(line) || reportLink.test(line))) {
      let end = index;
      let fields = 0;
      while (end < lines.length) {
        const candidate = lines[end];
        if (field.test(candidate)) fields++;
        else if (!(heading.test(candidate) || reportLink.test(candidate) || !candidate.trim())) break;
        end++;
      }
      // A solitary "status:" in ordinary writing is not a manifest.
      if (fields >= 2 || reportLink.test(line) || (fields && heading.test(line))) {
        evidence.push(lines.slice(index, end).join('\n').trim());
        index = end;
        continue;
      }
    }
    prose.push(lines[index++]);
  }
  return { body: evidence.length ? prose.join('\n').trim() : text, evidence: evidence.join('\n\n') };
}
