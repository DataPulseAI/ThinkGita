// app/src/Profile.jsx: the facilitator's own details form (rules match update_my_profile in the database).
import { describe, it, expect } from "vitest";
import { profileProblems, profileForm, profileChanged, profileError } from "../../src/Profile.jsx";

describe("profile form", () => {
  it("starts from the name on record when first and last name are empty", () => {
    expect(profileForm({ name: "Esha Specimen" })).toMatchObject({ first_name: "Esha", last_name: "Specimen", phone: "", photo_url: "" });
    expect(profileForm({ name: "Narada (Nick Ewan)", initiated_name: "Narada" })).toMatchObject({ initiated_name: "Narada", first_name: "Nick", last_name: "Ewan" });
    expect(profileForm({ name: "Abhimanyu" })).toMatchObject({ first_name: "Abhimanyu", last_name: "" });
    expect(profileForm({ name: "someone@example.org", email: "someone@example.org" })).toMatchObject({ first_name: "", last_name: "" });
    expect(profileForm({ name: "X Y", first_name: "Kept", last_name: null })).toMatchObject({ first_name: "Kept", last_name: "" });
  });
  it("needs a first or initiated name, short names and a plausible phone", () => {
    expect(profileProblems({ first_name: "Esha" })).toEqual({});
    expect(profileProblems({ initiated_name: "Isvari" })).toEqual({});
    expect(Object.keys(profileProblems({ first_name: " ", initiated_name: "" }))).toEqual(["first_name"]);
    expect(Object.keys(profileProblems({ first_name: "x".repeat(81) }))).toEqual(["first_name"]);
    expect(profileProblems({ first_name: "A", phone: "+44 (0)7700-900.123" })).toEqual({});
    expect(Object.keys(profileProblems({ first_name: "A", phone: "call me" }))).toEqual(["phone"]);
    expect(Object.keys(profileProblems({ first_name: "A", phone: "+44" }))).toEqual(["phone"]);
  });
  it("only counts real changes, ignoring spaces and empty versus null", () => {
    const fac = { first_name: "Esha", last_name: null, phone: "+44 1", photo_url: null, initiated_name: null };
    expect(profileChanged(fac, { first_name: " Esha ", last_name: "", phone: "+44 1", photo_url: "", initiated_name: "" })).toBe(false);
    expect(profileChanged(fac, { first_name: "Esha", last_name: "", phone: "+44 2", photo_url: "", initiated_name: "" })).toBe(true);
  });
  it("turns database errors into plain sentences", () => {
    expect(profileError({ message: "invalid_profile: upload the photo from this page" })).toBe("Upload the photo from this page.");
    expect(profileError({ message: "not_a_facilitator: no facilitator profile" })).toMatch(/couldn't find a facilitator profile/);
    expect(profileError({ message: "network down" })).toMatch(/Couldn't save your details/);
  });
});
