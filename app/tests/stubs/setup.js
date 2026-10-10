// Test setup: a fake Deno global so edge function files can be imported in Node, and fixed env values.
// Like the real Deno.env.get, an unset variable reads as undefined (so `?? default` fallbacks apply).
const env = {
  SUPABASE_URL: "http://localhost:54321", SUPABASE_SERVICE_ROLE_KEY: "test-service-role", FRAMER_API_KEY: "test-framer",
  VITE_SUPABASE_URL: "http://localhost:54321", VITE_SUPABASE_ANON_KEY: "test-anon",
};
globalThis.Deno ??= { env: { get: (k) => env[k] }, serve: () => ({ shutdown() {} }) };

// No real network in unit tests: any fetch a test has not stubbed (vi.stubGlobal("fetch", ...)) fails loudly.
globalThis.fetch = async (url) => { throw new Error(`Network is blocked in unit tests (fetch ${url})`); };
