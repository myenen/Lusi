import { listen } from '@tauri-apps/api/event';

export type DesktopMenuAction = 'inbox' | 'compose' | 'settings';

export const onDesktopMenuAction = (handler: (action: DesktopMenuAction) => void) =>
  listen<DesktopMenuAction>('desktop:menu-action', ({ payload }) => handler(payload), { target: 'main' });
