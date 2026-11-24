import assert from 'node:assert/strict';
import type { Snapshot } from '../src/data/types';
import { discussionMemory } from '../src/data/discussionMemory';

export function verifyDiscussionMemory(original: Snapshot, sessionId: string, planId: string, first: string, followUp: string) {
  const snapshot = structuredClone(original);
  const session = snapshot.sessions[sessionId], ledger = snapshot.collaboration!;
  const selected = (through?: string) => discussionMemory(snapshot, sessionId, planId, 'root', through);
  assert.deepEqual(selected().map(row => row.note.id), [first]);
  const note = ledger.memoryNotes!.find(note => note.id === followUp)!;
  const pin = { id: note.id, revision:note.revision, hash:note.hash, sourceArtifactId:note.source.artifactId };
  const firstAccepted = Date.parse(session.runtime!.acceptedAt!);
  const time = (offset: number) => new Date(firstAccepted + offset).toISOString();
  const at = time(2000), sentAt = time(4000);
  const receipt = { status:'sent' as const, at, sentAt, fingerprint:'receipt-fingerprint', memoryLessons:[pin] };
  const sent = session.runtime!.controlDeliveries = { 'direction:asked': receipt };
  const received = selected();
  assert.deepEqual(received.map(row => row.note.id), [first, followUp]);
  assert.equal(received[0].followUpAt, undefined);
  assert.equal(received[1].followUpAt, sentAt);
  assert.equal(received[1].source?.id, pin.sourceArtifactId);
  assert.deepEqual(selected(time(-1)), [], 'before the first admission nothing is provably delivered');
  assert.deepEqual(selected('13:35'), [], 'legacy display time lacks a date');
  assert.deepEqual(selected(time(1000)).map(row => row.note.id), [first], 'earlier reply never shows the next question’s lesson');
  assert.deepEqual(selected(time(3000)).map(row => row.note.id), [first], 'a turn that started but was not yet acknowledged is excluded');
  assert.deepEqual(selected(sentAt).map(row => row.note.id), [first, followUp]);
  session.runtime!.controlDeliveries['direction:asked'] = { ...receipt, sentAt:undefined };
  assert.deepEqual(selected(time(9000)).map(row => row.note.id), [first], 'do not guess an acknowledgement time for historical records');
  assert.deepEqual(selected().map(row => row.note.id), [first, followUp], 'the legacy receipt remains part of whole-session history');
  session.runtime!.controlDeliveries['direction:asked'] = receipt;
  Object.assign(sent, { 'direction:again': receipt });
  assert.equal(selected().length, 2, 'show an unchanged lesson revision only once per session');
  delete session.runtime!.controlDeliveries['direction:again'];
  for (const status of ['failed','unknown','sending'] as const) {
    session.runtime!.controlDeliveries['direction:asked'] = { ...receipt, status };
    assert.deepEqual(selected().map(row => row.note.id), [first]);
  }
  session.runtime!.controlDeliveries['direction:asked'] = receipt;
  assert.deepEqual(discussionMemory(snapshot, sessionId, planId, 'a-section'), []);
  assert.deepEqual(discussionMemory(snapshot, sessionId, 'a-different-plan', 'root'), []);
  const stable = ledger.memoryNotes!.find(n => n.id === first)!;
  ledger.memoryNotes!.push({ ...stable, id:stable.noteId + ':v99', revision:99, status:'withdrawn' });
  assert.equal(selected()[0].note.id, first, 'history describes the exact version originally provided');
  stable.action = 'corrupt immutable revision';
  assert.deepEqual(selected().map(row => row.note.id), [followUp]);
  session.dispatchPhase = 'rejected';
  assert.deepEqual(selected(), []);
  session.dispatchPhase = 'acknowledged';
  const run = ledger.runs[session.runtime!.collaboration!.runId];
  run.sessionId = 'other-session';
  assert.deepEqual(selected(), []);
  run.sessionId = sessionId;
  snapshot.project.id = 'other-project';
  assert.deepEqual(selected(), []);
}
