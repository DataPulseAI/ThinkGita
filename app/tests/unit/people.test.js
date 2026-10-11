// app/src/People.jsx: searching people on file, the stored name of a new person, and the duplicate checks.
import { describe, it, expect } from "vitest";
import { searchFacilitators, displayNameFor, newPersonCheck } from "../../src/People.jsx";

const people = [
  { id: "a", name: "Kirtana (Asha Example)", initiated_name: "Kirtana", first_name: "Asha", last_name: "Example", email: "asha@example.org" },
  { id: "b", name: "Bram Sample", email: "bram@example.org" },
  { id: "c", name: "Chitra Placeholder", email: "chitra@example.org" },
  { id: "d", name: "Śrīlalitā Susevinī dd", email: "sl@example.org" },
];

describe("searchFacilitators", () => {
  it("matches names, initiated names and emails, every word, ignoring case and accents", () => {
    expect(searchFacilitators(people, "asha").map((f) => f.id)).toEqual(["a"]);
    expect(searchFacilitators(people, "KIRT ex").map((f) => f.id)).toEqual(["a"]);
    expect(searchFacilitators(people, "bram@").map((f) => f.id)).toEqual(["b"]);
    expect(searchFacilitators(people, "srilalita").map((f) => f.id)).toEqual(["d"]);
    expect(searchFacilitators(people, "nobody")).toEqual([]);
  });
  it("leaves out excluded people and puts names starting with the search first", () => {
    expect(searchFacilitators(people, "", ["b", null]).map((f) => f.id)).toEqual(["c", "a", "d"]);
    expect(searchFacilitators(people, "s").map((f) => f.id)).toEqual(["d", "b", "a"]);
  });
});

describe("displayNameFor", () => {
  it("uses the form's shape", () => {
    expect(displayNameFor({ initiated_name: "Radha", first_name: "Priya", last_name: "Sample", email: "p@x.org" })).toBe("Radha (Priya Sample)");
    expect(displayNameFor({ initiated_name: "Radha", email: "p@x.org" })).toBe("Radha (p@x.org)");
    expect(displayNameFor({ first_name: " Priya ", last_name: "", email: "p@x.org" })).toBe("Priya");
    expect(displayNameFor({ email: "p@x.org" })).toBe("p@x.org");
  });
});

describe("newPersonCheck", () => {
  it("needs a name and a valid email", () => {
    expect(Object.keys(newPersonCheck({ email: "x" }, people).problems).sort()).toEqual(["email", "first_name"]);
    expect(newPersonCheck({ first_name: "New", email: "New@Example.org" }, people)).toMatchObject({ email: "new@example.org", problems: {}, sameEmail: null, similar: [] });
  });
  it("an email already on file is refused and that person offered", () => {
    const r = newPersonCheck({ first_name: "Someone", email: " BRAM@example.org " }, people);
    expect(r.problems.email).toBe("Someone already uses this email.");
    expect(r.sameEmail.id).toBe("b");
  });
  it("flags people who look the same: same first and last name, or same initiated name", () => {
    expect(newPersonCheck({ first_name: "Asha", last_name: "Example", email: "asha2@example.org" }, people).similar.map((f) => f.id)).toEqual(["a"]);
    expect(newPersonCheck({ initiated_name: "kirtana", email: "k@example.org" }, people).similar.map((f) => f.id)).toEqual(["a"]);
    expect(newPersonCheck({ first_name: "Asha", last_name: "Other", email: "z@example.org" }, people).similar).toEqual([]);
  });
});
