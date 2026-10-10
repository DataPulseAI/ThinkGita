// Extra Deno env values for one test file. Call before the edge function is imported (use a dynamic import).
export function withDenoEnv(extra) {
  const orig = globalThis.Deno.env.get;
  globalThis.Deno.env.get = (k) => (k in extra ? extra[k] : orig(k));
  return () => { globalThis.Deno.env.get = orig; };
}
