// Stand-in for npm:framer-api in unit tests. Tests that need Framer behaviour replace `connect` with vi.mock or spies.
export async function connect() {
  throw new Error("framer-api is stubbed in unit tests");
}
