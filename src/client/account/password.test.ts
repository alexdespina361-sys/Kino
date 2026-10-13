import { describe, expect, it } from "vitest";
import { weakness } from "./password";

describe("what a new password is worth", () => {
  it("is 'none' when there is none, whoever the name is", () => {
    expect(weakness("robert", "")).toBe("none");
    expect(weakness("", "")).toBe("none");
  });

  it("is weak when it is short, even for something that is not a word", () => {
    for (const password of ["1", "a", "  ", "12345", "x7!Qz", "🙂🙂🙂"]) expect(weakness("robert", password), password).toBe("weak");
  });

  it("is weak when it is the name (whatever the capitals), one character over and over, or one of the first guesses", () => {
    expect(weakness("Robert Smith", "robert smith")).toBe("weak");
    expect(weakness("  robert smith ", "ROBERT SMITH")).toBe("weak");
    expect(weakness("robert", "aaaaaaaa")).toBe("weak");
    expect(weakness("robert", "111111")).toBe("weak");
    for (const password of ["123456", "Password", "QWERTY123", "iloveyou", "parola123"]) expect(weakness("robert", password), password).toBe("weak");
  });

  it("is nothing to say for a password that is long enough and none of those", () => {
    for (const password of ["kino-test-pass", "correct horse battery", "Tr0ub4dor&3", "sixsix", "🙂🙂🙂🙂🙂x"]) expect(weakness("robert", password), password).toBeNull();
  });

  it("does not take a password for the name just because the name contains it", () => {
    expect(weakness("robert-the-great", "robert")).toBeNull(); // six letters: long enough, and not the name
  });
});
