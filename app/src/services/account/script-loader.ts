// Adds a <script> to the page and waits for it. Passed in so tests never touch the DOM.
export type ScriptLoader = (src: string, attrs?: Record<string, string>) => Promise<HTMLScriptElement>;

export const loadScript: ScriptLoader = (src, attrs = {}) => new Promise((res, rej) => {
  const sc = document.createElement('script');
  sc.src = src;
  for (const [k, v] of Object.entries(attrs)) sc.setAttribute(k, v);
  sc.onload = () => res(sc);
  sc.onerror = () => rej(new Error('Could not load ' + src));
  document.head.appendChild(sc);
});
