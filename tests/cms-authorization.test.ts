import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CUSTOMER_USER_ROLES, INTERNAL_USER_ROLES, USER_ROLES } from "../db/schema.ts";
import { can, type Actor, type Permission } from "../lib/authorization.ts";

// Who may change the public website, decided server-side.
//
// Two halves. The capability check itself must deny everyone who was not
// granted the capability, including an ADMIN - "ADMIN" is not a synonym for
// OWNER here, it is a role that holds exactly the permissions it was given. And
// every route that writes or publishes website content must actually ask,
// naming the right capability: a rename that asked for `site:write` would let
// an editor move a published URL, which is a publication decision.

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path: string) => readFile(join(root, path), "utf8");

function actor(role: (typeof USER_ROLES)[number], permissions: Permission[] = [], companyId: string | null = null): Actor {
  return { userId: "user-1", role, companyId, permissions };
}

const WEBSITE_CAPABILITIES: Permission[] = ["site:read", "site:write", "site:publish", "gallery:publish"];

test("only the Owner holds website capability without being granted it", () => {
  for (const role of USER_ROLES) {
    for (const capability of WEBSITE_CAPABILITIES) {
      const granted = can(actor(role), capability);
      assert.equal(
        granted,
        role === "OWNER",
        `${role} ${granted ? "holds" : "does not hold"} ${capability} with no grant`,
      );
    }
  }
});

// The case the mission names: an ADMIN is denied unless granted the CMS
// capability, and holding one does not imply the next one up.
test("an ADMIN holds exactly the website capability it was granted", () => {
  const readOnly = actor("ADMIN", ["site:read"]);
  assert.equal(can(readOnly, "site:read"), true);
  assert.equal(can(readOnly, "site:write"), false);
  assert.equal(can(readOnly, "site:publish"), false);

  const editor = actor("ADMIN", ["site:read", "site:write"]);
  assert.equal(can(editor, "site:write"), true);
  assert.equal(can(editor, "site:publish"), false, "writing a draft must not imply publishing it");

  const publisher = actor("ADMIN", ["site:read", "site:write", "site:publish"]);
  assert.equal(can(publisher, "site:publish"), true);
  assert.equal(can(publisher, "gallery:publish"), false, "publishing pages must not imply publishing photographs");
});

test("every operational role is denied website capability unless granted", () => {
  for (const role of INTERNAL_USER_ROLES) {
    if (role === "OWNER") continue;
    for (const capability of WEBSITE_CAPABILITIES) {
      assert.equal(can(actor(role), capability), false, `${role} holds ${capability}`);
      // Naming a company must not be a way in: website content has no company.
      assert.equal(can(actor(role, [], "company-a"), capability, "company-a"), false);
    }
  }
});

test("a customer can never reach website content, for any company", () => {
  for (const role of CUSTOMER_USER_ROLES) {
    for (const capability of WEBSITE_CAPABILITIES) {
      const customer = actor(role, [], "company-a");
      assert.equal(can(customer, capability), false, `${role} holds ${capability}`);
      assert.equal(can(customer, capability, "company-a"), false, `${role} holds ${capability} for its own company`);
      assert.equal(can(customer, capability, "company-b"), false);
      // A permission row must not promote a customer, whatever put it there.
      assert.equal(can(actor(role, [capability], "company-a"), capability, "company-a"), false);
    }
  }
});

/**
 * The capability each website route requires.
 *
 * Pinned as data so a downgrade is a failing test rather than a diff nobody
 * reads. Saving a draft is `site:write`; anything that changes what the public
 * site serves - publishing, hiding, and moving a post to a new URL - is
 * `site:publish`.
 */
const WEBSITE_ROUTES: Array<{ path: string; capability: Permission }> = [
  { path: "app/api/site-content/[slug]/revisions/route.ts", capability: "site:write" },
  { path: "app/api/site-content/[slug]/publish/route.ts", capability: "site:publish" },
  { path: "app/api/site-settings/revisions/route.ts", capability: "site:write" },
  { path: "app/api/site-settings/publish/route.ts", capability: "site:publish" },
  { path: "app/api/posts/route.ts", capability: "site:write" },
  { path: "app/api/posts/[slug]/revisions/route.ts", capability: "site:write" },
  { path: "app/api/posts/[slug]/publish/route.ts", capability: "site:publish" },
  { path: "app/api/posts/[slug]/rename/route.ts", capability: "site:publish" },
];

test("every website route asks for its capability, server-side, on a same-origin request", async () => {
  for (const route of WEBSITE_ROUTES) {
    const source = await read(route.path);
    assert.match(source, /getCurrentActor\s*\(/, `${route.path} never resolves an actor`);
    assert.ok(
      source.includes(`can(actor, "${route.capability}")`),
      `${route.path} does not require ${route.capability}`,
    );
    assert.match(source, /isSameOrigin\s*\(\s*request\s*\)/, `${route.path} does not check same-origin`);
    // The order matters: a body parsed before the check is work done for an
    // unauthorized caller, and a redirect answered after it is a decision made
    // too late.
    assert.ok(
      source.indexOf("can(actor,") < source.indexOf("request.formData()"),
      `${route.path} reads the request body before deciding`,
    );
  }
});

// A rename changes which URLs the public site answers. Requiring only the draft
// capability for it would let an editor move a published post without holding
// the capability to publish one.
test("renaming a post is a publication decision, not an edit", async () => {
  const rename = await read("app/api/posts/[slug]/rename/route.ts");
  assert.ok(rename.includes('can(actor, "site:publish")'));
  assert.equal(rename.includes('can(actor, "site:write")'), false);
});

// The public media route is the one website surface with no session at all, so
// what stands in its place is asserted rather than assumed.
test("public media delivery decides from the stored row and never from a session", async () => {
  const media = await read("app/assets/media/[itemId]/[variant]/route.ts");
  assert.ok(media.includes('eq(galleryItems.status, "PUBLISHED")'));
  assert.ok(media.includes('eq(galleryItems.visibility, "PUBLIC")'));
  assert.equal(media.includes("getCurrentActor"), false, "a cacheable response must not vary by viewer");
  assert.equal(media.includes("requireActor"), false);
  assert.equal(media.includes('"ORIGINAL"'), false, "the untouched upload must have no public path");
});
