// Fake Framer project: one "Course" collection held in memory, with call logs.
const clone = (v) => structuredClone(v);

export function createFakeFramer({ items = [], collectionId = "xsdOXNmfm" } = {}) {
  const state = { items: clone(items), addCalls: [], publishCalls: 0, deployCalls: [], disconnected: 0, publishErrors: [], addErrors: [], onAdd: null };
  let n = 1;
  const col = {
    id: collectionId,
    getItems: async () => clone(state.items),
    getFields: async () => [{ id: "jwZTR596c", name: "MainTitle" }, { id: "jAVGSOlAT", name: "AuthorName" }],
    addItems: async (inputs) => {
      state.addCalls.push(clone(inputs));
      state.onAdd?.(inputs);
      const err = state.addErrors.shift();
      if (err) throw new Error(err);
      for (const input of inputs) {
        const ex = input.id ? state.items.find((x) => x.id === input.id) : null;
        if (ex) {
          if (typeof input.draft === "boolean") ex.draft = input.draft;
          if (input.fieldData) ex.fieldData = { ...ex.fieldData, ...clone(input.fieldData) };
        } else {
          state.items.push({ id: input.id ?? `new-${n++}`, slug: input.slug, draft: input.draft ?? false, fieldData: clone(input.fieldData ?? {}) });
        }
      }
    },
  };
  const framer = {
    getCollections: async () => [col],
    publish: async () => {
      state.publishCalls++;
      const err = state.publishErrors.shift();
      if (err) throw new Error(err);
      return { deployment: { id: `dep-${state.publishCalls}` } };
    },
    deploy: async (id) => { state.deployCalls.push(id); },
    disconnect: async () => { state.disconnected++; },
  };
  return { state, col, framer };
}
