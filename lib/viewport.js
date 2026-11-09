// WebKitGTK's fractional system scaling can make vw/vh disagree with the
// webview's logical viewport. Keep the desktop layout in logical CSS pixels.
export function initializeViewport(isDesktop) {
  if (!isDesktop) return;
  const update = () => {
    document.documentElement.style.setProperty('--app-vw', `${innerWidth / 100}px`);
    document.documentElement.style.setProperty('--app-vh', `${innerHeight / 100}px`);
  };
  update();
  window.addEventListener('resize', update, { passive: true });
}
