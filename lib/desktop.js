export const isDesktop = !!window.__TAURI__?.core;
export async function native(command, args = {}) {
  if (!isDesktop) throw new Error('此功能需要桌面版 HORIZON。');
  return window.__TAURI__.core.invoke(command, args);
}
