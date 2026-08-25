import assert from "node:assert/strict";
import test from "node:test";
import {
  OWNER_LOGIN_EMAIL,
  OWNER_PIN_DEFAULT_RETURN_TO,
  OWNER_PIN_ERROR_CODES,
  OWNER_PIN_FIELD,
  OWNER_PIN_LENGTH,
  OWNER_PIN_FIELD_REFUSALS,
  OWNER_PIN_LOGIN_ACTION,
  OWNER_PIN_PATTERN,
  OWNER_RETURN_TO_FIELD,
  isOwnerPinErrorCode,
  isPinFieldRefusal,
  ownerLoginReturnTo,
  ownerPinLoginError,
  ownerPinLoginStatus,
} from "../lib/owner-pin-login.ts";

// --- the fixed identity ------------------------------------------------------

test("the Owner identity is one fixed address the browser never gets to choose", () => {
  assert.equal(OWNER_LOGIN_EMAIL, "kaikt143@gmail.com");
});

test("the login posts two fields to the one route", () => {
  assert.equal(OWNER_PIN_LOGIN_ACTION, "/api/auth/owner-pin/login");
  assert.equal(OWNER_PIN_FIELD, "pin");
  assert.equal(OWNER_RETURN_TO_FIELD, "returnTo");
});

// --- the PIN shape -----------------------------------------------------------

// The HTML `pattern` attribute is anchored by the browser; a bare `RegExp.test`
// is not, so it is anchored here or every assertion below would pass on a
// substring match and prove nothing.
const pin = new RegExp(`^(?:${OWNER_PIN_PATTERN})$`, "u");

test("the PIN is exactly six characters", () => {
  assert.equal(OWNER_PIN_LENGTH, 6);
  assert.ok(pin.test("000000"));
  assert.ok(pin.test("481902"));
  assert.ok(!pin.test("12345"), "five digits is not a PIN");
  assert.ok(!pin.test("1234567"), "seven digits is not a PIN");
  assert.ok(!pin.test(""), "an empty field is not a PIN");
});

test("the PIN is ASCII digits, and nothing a Unicode digit class would let through", () => {
  // \d in an HTML pattern is Unicode-aware. A Thai or Arabic-Indic six would be
  // accepted by the field and then recognised by no comparison on the server,
  // so the Owner would be told a correct PIN was wrong.
  assert.ok(!pin.test("๑๒๓๔๕๖"), "Thai digits must not be accepted");
  assert.ok(!pin.test("١٢٣٤٥٦"), "Arabic-Indic digits must not be accepted");
  assert.ok(!pin.test("１２３４５６"), "fullwidth digits must not be accepted");
  assert.ok(!pin.test("12 345"), "a space is not a digit");
  assert.ok(!pin.test("12345a"), "a letter is not a digit");
  assert.ok(!pin.test("+12345"), "a sign is not a digit");
  assert.ok(!pin.test("123456\n"), "a trailing newline must not smuggle a seventh character in");
});

// --- returnTo ----------------------------------------------------------------

test("a direct login lands in the website workspace", () => {
  assert.equal(OWNER_PIN_DEFAULT_RETURN_TO, "/app/website");
  assert.equal(ownerLoginReturnTo(undefined), "/app/website");
  assert.equal(ownerLoginReturnTo(null), "/app/website");
  assert.equal(ownerLoginReturnTo(""), "/app/website");
});

test("the path a protected route was asking for survives the round trip", () => {
  // Without this the Owner is dropped on the same landing page after every
  // session expiry, however deep in the CMS they were.
  assert.equal(ownerLoginReturnTo("/app/site-content"), "/app/site-content");
  assert.equal(ownerLoginReturnTo("/app/posts/new-depot?draft=1"), "/app/posts/new-depot?draft=1");
  assert.equal(ownerLoginReturnTo("/app/gallery/order#c-2"), "/app/gallery/order#c-2");
  assert.equal(ownerLoginReturnTo("/app"), "/app");
  assert.equal(ownerLoginReturnTo("/app/website"), "/app/website");
});

test("a returnTo that would leave this origin is refused rather than followed", () => {
  // It arrives in a URL anyone can write and is rendered straight into a hidden
  // field, so a login page that honoured it would be an open redirect.
  for (const hostile of [
    "https://evil.test/app",
    "//evil.test/app",
    "http://evil.test",
    "\\\\evil.test/app",
    "/\\evil.test",
    "javascript:alert(1)",
    "app/website",
    " /app/website",
    "%2F%2Fevil.test",
  ]) {
    assert.equal(
      ownerLoginReturnTo(hostile),
      "/app/website",
      `${hostile} must not become a destination`,
    );
  }
});

test("every accepted returnTo is a same-origin path", () => {
  for (const candidate of ["/app", "/app/website", "https://evil.test", "//evil.test", "/x?y=//evil.test"]) {
    const resolved = ownerLoginReturnTo(candidate);
    assert.ok(resolved.startsWith("/"), `${candidate} produced ${resolved}`);
    assert.ok(!resolved.startsWith("//"), `${candidate} produced ${resolved}`);
  }
});

// --- what the Owner is told --------------------------------------------------

test("every refusal the route can answer with has a sentence", () => {
  // A code with no copy renders a blank card after a failed login, which reads
  // as "nothing happened" and invites the Owner to type the PIN again.
  // Read off the routes that redirect here, not invented for this screen:
  // app/api/auth/owner-pin/login/route.ts, lib/current-actor.ts,
  // app/api/auth/login/route.ts and app/auth/callback/route.ts.
  assert.deepEqual([...OWNER_PIN_ERROR_CODES].sort(), [
    "config",
    "invalid_credentials",
    "invalid_input",
    "invalid_pin",
    "not_authorized",
    "origin",
    "owner_conflict",
    "pin_format",
    "too_many_attempts",
    "unavailable",
  ]);
  for (const code of OWNER_PIN_ERROR_CODES) {
    const message = ownerPinLoginError(code);
    assert.ok(message && message.length > 10, `${code} has no usable message`);
  }
});

test("a code this screen does not know renders nothing rather than a guess", () => {
  assert.equal(ownerPinLoginError(undefined), null);
  assert.equal(ownerPinLoginError("something_else"), null);
  assert.equal(ownerPinLoginError(""), null);
  assert.equal(isOwnerPinErrorCode("invalid_credentials"), true);
  assert.equal(isOwnerPinErrorCode("nonsense"), false);
});

test("a lockout says how long, and says so honestly when it cannot", () => {
  assert.match(ownerPinLoginError("too_many_attempts", "900") ?? "", /15 นาที/);
  assert.match(ownerPinLoginError("too_many_attempts", "1") ?? "", /1 นาที/);
  // The wait arrives in a query parameter, so an unparseable or absurd one
  // renders no number at all rather than an attacker-chosen figure.
  for (const bogus of [undefined, "", "soon", "-60", "99999999", "9e9", "1.5"]) {
    const message = ownerPinLoginError("too_many_attempts", bogus) ?? "";
    assert.match(message, /รอสักครู่/, `retryAfter=${bogus} should render no number`);
    assert.ok(!/[0-9]/.test(message), `retryAfter=${bogus} rendered a number: ${message}`);
  }
});

test("only a lockout carries a wait; nothing else invents one", () => {
  for (const code of OWNER_PIN_ERROR_CODES) {
    if (code === "too_many_attempts") continue;
    assert.equal(ownerPinLoginError(code, "900"), ownerPinLoginError(code));
  }
});

test("no refusal offers a recovery path that does not exist", () => {
  // A PIN is held server-side. It cannot be mailed, and it cannot be reset from
  // this screen, so no message may point at a flow that would do either.
  for (const code of OWNER_PIN_ERROR_CODES) {
    const message = ownerPinLoginError(code, "900") ?? "";
    assert.ok(!message.includes("/forgot-password"), `${code} links to password recovery`);
    assert.ok(!message.includes(OWNER_LOGIN_EMAIL), `${code} echoes the Owner address back`);
  }
});

test("a wrong PIN is reported as a wrong PIN, not as a broken system", () => {
  // The route answers invalid_pin for a PIN that was compared and did not
  // match, and pin_format for one that was never worth comparing.
  assert.match(ownerPinLoginError("invalid_pin") ?? "", /PIN/);
  assert.match(ownerPinLoginError("pin_format") ?? "", /6 หลัก/);
  // config is the server's fault and says so; telling the Owner to try again
  // would send them round a loop that cannot end.
  assert.match(ownerPinLoginError("config") ?? "", /เซิร์ฟเวอร์/);
  // owner_conflict is the server's too, and no number of retries clears it: the
  // bootstrap refuses rather than rebinds, so only the database can.
  assert.match(ownerPinLoginError("owner_conflict") ?? "", /ฐานข้อมูล/);
});

test("the password door's codes still have sentences, and none of them blames the PIN", () => {
  // POST /api/auth/login is no longer the Owner's path and its form is not on
  // this screen, but the route is mounted and still redirects here. A code with
  // no copy renders an empty card; a code worded as a PIN refusal would tell
  // the Owner their PIN was wrong when no PIN was ever involved.
  for (const code of ["invalid_input", "invalid_credentials", "origin"] as const) {
    const message = ownerPinLoginError(code) ?? "";
    assert.ok(message.length > 10, `${code} has no usable message`);
    assert.ok(!message.includes("PIN"), `${code} blames the PIN`);
  }
});

test("only what was typed into the PIN field marks the PIN field", () => {
  // aria-invalid on the input is a claim about the value in it. unavailable,
  // owner_conflict and not_authorized never compared a PIN at all, so marking
  // the field for them would announce something untrue to a screen reader.
  assert.deepEqual([...OWNER_PIN_FIELD_REFUSALS], ["pin_format", "invalid_pin"]);
  for (const code of OWNER_PIN_ERROR_CODES) {
    const expected = code === "pin_format" || code === "invalid_pin";
    assert.equal(isPinFieldRefusal(code), expected, `${code} marks the field: ${!expected}`);
  }
  assert.equal(isPinFieldRefusal(undefined), false);
  assert.equal(isPinFieldRefusal("nonsense"), false);
});

test("logging out is confirmed, and an unknown status is not", () => {
  assert.equal(ownerPinLoginStatus("logged_out"), "ออกจากระบบเรียบร้อยแล้ว");
  assert.ok(ownerPinLoginStatus("password_updated"));
  assert.equal(ownerPinLoginStatus("signed_in"), null);
  assert.equal(ownerPinLoginStatus(undefined), null);
  // A refusal must never resolve as a status, or it would render in the
  // success slot as a green card after a failed login.
  for (const code of OWNER_PIN_ERROR_CODES) {
    assert.equal(ownerPinLoginStatus(code), null, `${code} resolves as a success message`);
  }
});
