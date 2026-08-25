import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The Owner signs in to a production CMS with a six-digit PIN and nothing else.
// That makes this screen the whole authentication surface, and every way it can
// go wrong is quiet:
//
//   - a field name that is not the one the route reads, so a correct PIN is
//     posted as nothing and reads as a wrong PIN;
//   - an email field, which would let the browser nominate whose account is
//     being opened — the exact claim a fixed-identity login exists to remove;
//   - a PIN attribute that lets a seventh character, a Thai digit or a visible
//     value through;
//   - a returnTo taken straight from the URL, which is an open redirect wearing
//     a login page;
//   - a PIN, or anything shaped like one, committed into the UI;
//   - a refusal rendered as a success.
//
// None of the rules below is a style preference.

const root = process.env.OWNER_PIN_UI_ROOT
  ? resolve(process.env.OWNER_PIN_UI_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
// .ts and .tsx are unpinned in .gitattributes, so a Windows checkout is CRLF.
const read = async (path) => (await readFile(join(root, path), "utf8")).split("\r\n").join("\n");
const failures = [];
const require = (condition, message) => { if (!condition) failures.push(message); };

const LOGIN_PAGE = "app/login/page.tsx";
const LOGIN_LIB = "lib/owner-pin-login.ts";
const STYLESHEET = "app/globals.css";

const [page, lib, stylesheet] = await Promise.all([LOGIN_PAGE, LOGIN_LIB, STYLESHEET].map(read));

const constant = (source, name) => source.match(new RegExp(`${name} = "([^"]*)"`))?.[1] ?? null;

const OWNER_EMAIL = "kaikt143@gmail.com";
const LOGIN_ACTION = "/api/auth/owner-pin/login";
const DEFAULT_RETURN_TO = "/app/website";
const ERROR_CODES = [
  "config",
  "invalid_input",
  "invalid_credentials",
  "not_authorized",
  "too_many_attempts",
  "unavailable",
];

// 1. The route, written as a literal in the page.
//
//    A constant would read better and would be invisible to
//    test-response-security-headers.mjs, which proves form-action 'self' is
//    intact by reading every form target straight out of the source. So the
//    literal stays, and the constant is checked against it here instead.
require(
  page.includes(`action="${LOGIN_ACTION}"`) && page.includes('method="post"'),
  `${LOGIN_PAGE}: must post to ${LOGIN_ACTION}, as a literal the header gate can read`,
);
require(
  constant(lib, "OWNER_PIN_LOGIN_ACTION") === LOGIN_ACTION,
  `${LOGIN_LIB}: OWNER_PIN_LOGIN_ACTION does not name ${LOGIN_ACTION}`,
);
require(
  !page.includes('action="/api/auth/login"'),
  `${LOGIN_PAGE}: still posts to the password login route, which does not read a PIN`,
);

// 2. Two fields, and only two. The route reads `pin` and `returnTo`; anything
//    else is either dropped in silence or is an authority claim.
const submitted = [...page.matchAll(/\bname="([^"]*)"/g)].map((match) => match[1]).sort();
require(
  JSON.stringify(submitted) === JSON.stringify(["pin", "returnTo"]),
  `${LOGIN_PAGE}: submits [${submitted.join(", ")}]; the contract is exactly pin and returnTo`,
);
for (const forbidden of ['name="email"', 'type="email"', 'name="password"', 'autoComplete="username"']) {
  require(
    !page.includes(forbidden),
    `${LOGIN_PAGE}: carries ${forbidden}; the Owner identity is fixed server-side and must not travel from the browser`,
  );
}

// 3. The PIN field, attribute by attribute. Each one is load-bearing:
//    type=password so it is never on screen or in a screenshot, inputMode so a
//    phone opens the number pad, pattern and maxLength so six ASCII digits is
//    what the browser will let through, autoComplete so a password manager
//    fills the right thing.
const PIN_ATTRIBUTES = [
  'id="pin"',
  'name="pin"',
  'type="password"',
  'inputMode="numeric"',
  "pattern={OWNER_PIN_PATTERN}",
  "maxLength={OWNER_PIN_LENGTH}",
  "minLength={OWNER_PIN_LENGTH}",
  'autoComplete="current-password"',
  "required",
];
for (const attribute of PIN_ATTRIBUTES) {
  require(page.includes(attribute), `${LOGIN_PAGE}: the PIN field is missing ${attribute}`);
}
require(
  constant(lib, "OWNER_PIN_PATTERN") === "[0-9]{6}",
  `${LOGIN_LIB}: OWNER_PIN_PATTERN must be [0-9]{6}; \\d would admit Thai and Arabic-Indic digits no PIN comparison recognises`,
);
require(
  lib.includes("OWNER_PIN_LENGTH = 6"),
  `${LOGIN_LIB}: OWNER_PIN_LENGTH must be 6`,
);

// 4. Nothing puts a PIN back on the page. A value or defaultValue would survive
//    a re-render after a failed attempt and sit in the DOM in clear.
const pinField = page.slice(page.indexOf('id="pin"'), page.indexOf('id="pin-hint"'));
for (const forbidden of ["value=", "defaultValue=", "type=\"text\""]) {
  require(
    !pinField.includes(forbidden),
    `${LOGIN_PAGE}: the PIN field carries ${forbidden}, which puts the PIN back on the page`,
  );
}

// 5. The Owner address is shown and is not an input. It comes from the one
//    constant so the page and the server cannot drift to two different Owners.
require(
  constant(lib, "OWNER_LOGIN_EMAIL") === OWNER_EMAIL,
  `${LOGIN_LIB}: OWNER_LOGIN_EMAIL must be ${OWNER_EMAIL}`,
);
require(
  page.includes("OWNER_LOGIN_EMAIL") && page.includes("{OWNER_LOGIN_EMAIL}"),
  `${LOGIN_PAGE}: must render the fixed Owner address from the shared constant`,
);
require(
  !page.includes(OWNER_EMAIL),
  `${LOGIN_PAGE}: hardcodes the Owner address instead of importing it; two copies drift`,
);
const identityBlock = page.slice(page.indexOf('className="owner-identity"'), page.indexOf("</div>", page.indexOf('className="owner-identity"')));
require(
  identityBlock.includes("{OWNER_LOGIN_EMAIL}") && !identityBlock.includes("<input"),
  `${LOGIN_PAGE}: the Owner address must be text, not a field the browser could submit or a user could edit`,
);

// 6. No Supabase anywhere in this screen. The PIN session is not a Supabase
//    session, and a config check here would gate the Owner out of their own CMS
//    on the strength of an unrelated integration.
for (const [path, source] of [[LOGIN_PAGE, page], [LOGIN_LIB, lib]]) {
  require(
    !/supabase/i.test(source),
    `${path}: still depends on Supabase; the PIN login must not be gated by an unrelated provider's configuration`,
  );
  require(
    !source.includes("isSupabaseConfigured") && !source.includes("disabled={"),
    `${path}: still disables its own controls on a configuration check`,
  );
}

// 7. returnTo is sanitised here, not merely on the way back. It arrives in a URL
//    anyone can write, and it is rendered straight into a hidden field.
require(
  page.includes("ownerLoginReturnTo(params.returnTo)"),
  `${LOGIN_PAGE}: returnTo must go through ownerLoginReturnTo before it reaches the form`,
);
require(
  !page.includes("value={params.returnTo}"),
  `${LOGIN_PAGE}: renders the raw returnTo into the form, which is an open redirect`,
);
require(
  constant(lib, "OWNER_PIN_DEFAULT_RETURN_TO") === DEFAULT_RETURN_TO,
  `${LOGIN_LIB}: a direct login must default to ${DEFAULT_RETURN_TO}`,
);
require(
  lib.includes("safeReturnTo("),
  `${LOGIN_LIB}: same-origin is decided by safeReturnTo, not by a second copy of its rules`,
);

// 8. Every refusal the route can answer with has a sentence, and no refusal is
//    rendered as a success. A code with no copy is a blank card after a failed
//    login, which reads as "nothing happened".
for (const code of ERROR_CODES) {
  require(
    new RegExp(`^\\s*(?:"${code}"|${code}):`, "m").test(lib),
    `${LOGIN_LIB}: the error code ${code} has no Thai message`,
  );
}
require(
  page.includes('className="form-message error" role="alert"'),
  `${LOGIN_PAGE}: a refusal must be announced as an alert`,
);
require(
  page.includes("{error && ") && page.includes("{status && "),
  `${LOGIN_PAGE}: refusals and statuses must be separate; a refusal rendered in the success slot is a fake success`,
);
require(
  !page.includes('className="form-message success" role="alert"'),
  `${LOGIN_PAGE}: a refusal is being styled as a success`,
);
require(
  lib.includes("logged_out:"),
  `${LOGIN_LIB}: logging out must be confirmed, or the Owner cannot tell it worked`,
);

// 9. The sign-in screen stays out of the index, exactly as the static release's
//    /login/ page does.
require(
  page.includes("robots: { index: false, follow: false }"),
  `${LOGIN_PAGE}: the login page must stay noindex`,
);

// 10. No PIN, and nothing shaped like one, in the UI half. The PIN is held
//     server-side; a literal or an env read here would be a committed secret.
for (const [path, source] of [[LOGIN_PAGE, page], [LOGIN_LIB, lib]]) {
  require(
    !/[0-9]{6,}/.test(source),
    `${path}: contains a literal run of six or more digits, which is the shape of the PIN itself`,
  );
  require(
    !source.includes("process.env"),
    `${path}: reads the environment; the PIN and its configuration are the server's, not this screen's`,
  );
}

// 11. Password recovery is not offered as the Owner's path, because there is
//     none: a PIN cannot be mailed or reset from here, and a link that implies
//     otherwise sends the Owner somewhere that cannot help them.
require(
  !page.includes("/forgot-password"),
  `${LOGIN_PAGE}: offers password recovery, which is not the Owner's path and cannot reset a PIN`,
);
require(
  page.includes("ลืม PIN?"),
  `${LOGIN_PAGE}: must say plainly what a forgotten PIN means, rather than leaving it unanswered`,
);

// 12. Keyboard and screen-reader access. The PIN field is the only control that
//     matters here, and an unlabelled one is unusable without sight.
require(
  page.includes('htmlFor="pin"') && page.includes('id="pin"'),
  `${LOGIN_PAGE}: the PIN field must be associated with its label`,
);
require(
  page.includes('aria-describedby="pin-hint"') && page.includes('id="pin-hint"'),
  `${LOGIN_PAGE}: the PIN rule must be announced with the field, not only shown beside it`,
);
require(
  page.includes("aria-invalid={pinRejected"),
  `${LOGIN_PAGE}: a refused PIN must be marked on the field itself`,
);

// 13. The card is used from a phone. At 320px the six tracked characters are
//     what would push the input past the card's edge.
// The opening brace is part of every selector below: `.owner-pin-input` alone
// is a substring of `.owner-pin-input-wide`, so a renamed rule would still
// satisfy a bare `includes` and the check would pass over a missing style.
for (const rule of [".owner-identity", ".owner-pin-input", ".field-hint", ".login-footnote"]) {
  require(stylesheet.includes(`${rule} {`), `${STYLESHEET}: ${rule} has no styling at all`);
}
const smallScreen = stylesheet.slice(stylesheet.indexOf("@media (max-width: 520px)"));
require(
  smallScreen.includes(".owner-pin-input {"),
  `${STYLESHEET}: .owner-pin-input does not shrink its tracking on a small screen`,
);
require(
  stylesheet.includes(".owner-identity-value { min-width: 0; overflow-wrap: anywhere;"),
  `${STYLESHEET}: a long Owner address must wrap inside the card rather than widen it`,
);

if (failures.length > 0) {
  for (const failure of failures) console.error(`OWNER_PIN_UI_FAIL ${failure}`);
  process.exit(1);
}

console.log(
  `OWNER_PIN_UI_PASS action=${LOGIN_ACTION} fields=pin,returnTo ownerEmail=fixed-server-side pinDigits=6 clientEmail=0 supabase=0 defaultReturnTo=${DEFAULT_RETURN_TO} errorCodes=${ERROR_CODES.length} noindex=yes secrets=0`,
);
