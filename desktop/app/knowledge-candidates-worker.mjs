import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { candidateGroups } from "./knowledge-reasoning.mjs";

// A short-lived worker keeps even a dense first index off Electron's main thread.
// The structured clone contains only the current analysis and leaves with the worker.
if (!isMainThread && workerData?.job === "knowledge-candidates") {
  parentPort.postMessage(candidateGroups(...workerData.arguments));
}

export function retrieveCandidates(atoms, quotes, findings, focusIds, round, signal) {
  signal?.throwIfAborted();
  if (!focusIds.size || atoms.length < 2) return Promise.resolve([]);
  const links = findings.map(({ evidence }) => ({ evidence }));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: {
        job: "knowledge-candidates",
        arguments: [atoms, quotes, links, focusIds, round],
      },
      execArgv: [],
    });
    const abort = () => {
      void worker.terminate().catch(reject);
      reject(signal.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
    let replied = false;
    worker.once("message", (groups) => {
      replied = true;
      resolve(groups);
    });
    worker.once("error", reject);
    worker.once("exit", () => {
      signal?.removeEventListener("abort", abort);
      if (!replied && !signal?.aborted) reject(new Error("知识检索提前结束，请重试。"));
    });
  });
}
