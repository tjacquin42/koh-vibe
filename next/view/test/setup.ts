/**
 * The view's components are drawn to a string, where a layout effect has
 * nothing to measure: React says so at each one, which drowns what a failing
 * test has to say. That one warning is left out; every other error is shown.
 */
const shown = console.error.bind(console);
console.error = (...args: unknown[]): void => {
  if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return;
  shown(...args);
};
