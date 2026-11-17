import type { WorkdeckDataSource } from './repository';
import { BUSINESS_COMMANDS } from './commands';
import type { DesktopHost } from '../integration/desktop';

export function createDesktopDataSource(host: DesktopHost): WorkdeckDataSource {
  return {
    mode: 'live',
    subscribe: listener => host.onSnapshot(listener),
    ...(host.onProjectChanges ? { subscribeProjectChanges: (listener: (change: { activeProjectId: string }) => void) => host.onProjectChanges!(listener) } : {}),
    ...Object.fromEntries(BUSINESS_COMMANDS.map(name => [name, (...args: unknown[]) => host.command(name, args)])),
  } as WorkdeckDataSource;
}
