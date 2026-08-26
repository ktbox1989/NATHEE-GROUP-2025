# Public News read API v1

The public News data contract is read-only and application-anonymous:

- `GET`/`HEAD /api/public/v1/news`
- `GET`/`HEAD /api/public/v1/news/<slug>`

It is separate from the authenticated `/api/posts` editor surface. Cookies and
Authorization headers are ignored for data selection and cannot reveal drafts,
preview revisions, hidden posts, private media, audit records, storage keys, or
internal post/revision identities. Mutation methods are not route handlers and
the contract boundary returns `405 Allow: GET, HEAD` if invoked directly.

The list defaults to 20 records and accepts at most 50. Its opaque cursor
continues the stable order `publishedAt DESC, slug ASC`. Eligibility comes from
the most recent publication lifecycle event: only a latest `PUBLISH` is live.
The dynamic sitemap consumes the same selection loader.

Successful representations use:

`Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=300`

They also carry an ETag. Publish or Revert is therefore revalidated by the
shared cache after 60 seconds; an already cached response may be served stale
while it revalidates for at most another 300 seconds. Error responses are
`private, no-store` and contain only a stable code.

Media is resolved only through the public media store and uses
`/assets/media/<itemId>/<display|thumbnail>.<format>`. The store selects only
`PUBLISHED` + `PUBLIC` items. Content blocks are mapped and validated by the
existing public CMS contract; raw revision JSON is never returned.

## Current hosting gate

The Sites project remains `CUSTOM_OWNER_ONLY`. The endpoints are anonymous at
the application layer but are not anonymously reachable through the current
Sites edge policy. A future PHP public-apex consumer therefore requires a
separate Owner-approved Sites public-access change. This local change does not
alter that policy, authentication, D1 schema, migrations, or Production.
