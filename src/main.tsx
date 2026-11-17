import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "./quiet.css";
import "./components/layout/workbench-display.css";
import { desktopHost } from './integration/desktop';
import { saveGatewaySettings } from './integration/gateway';
import { RuntimeConsole } from './components/runtime/RuntimeConsole';

async function start() {
  const host = desktopHost();
  if (host) {
    const keys = ['quandeck.projects.v1', 'quandeck.configured-agents.v1', 'quandeck.preferences.v1'];
    const values = await host.bootstrap(Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])));
    // A successful desktop bootstrap has imported legacy browser data into the
    // authoritative backend. Never mirror the whole project archive in each window.
    for (const [key, value] of Object.entries(values)) {
      if (key === 'quandeck.projects.v1' || value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
    saveGatewaySettings(await host.getConnection());
    host.onStorageError(message => window.dispatchEvent(new CustomEvent('quandeck:storage-error', { detail: message })));
  }
  const run = new URLSearchParams(location.search).get('run');
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{run && host ? <RuntimeConsole runId={run} /> : <App />}</React.StrictMode>);
}
void start().catch(error => {
  const root = document.getElementById('root')!;
  const message = document.createElement('p'); message.setAttribute('role', 'alert');
  message.textContent = `QuanDeck 无法打开本地数据：${error instanceof Error ? error.message : '请重新启动'}`;
  root.replaceChildren(message);
});
