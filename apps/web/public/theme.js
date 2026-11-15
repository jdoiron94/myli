// Applies the saved theme before the first paint, so a dark page doesn't flash light while the
// app loads. It's a file, not an inline script, so the Content Security Policy can forbid inline
// scripts. Once the app runs, src/theme.ts takes over: keep the key and classes in step with it.
(() => {
  let choice = null;
  try {
    choice = localStorage.getItem('myli-theme');
  } catch {
    // Storage can be blocked. Follow the device then.
  }
  const dark =
    choice === 'dark' || (choice !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.add(dark ? 'dark' : 'light');
})();
