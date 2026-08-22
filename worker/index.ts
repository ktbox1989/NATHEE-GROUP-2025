/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  FILES: R2Bucket;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  // One exit, so no response can leave without the headers below. The image
  // optimizer used to return before them, and was the single response served
  // without any.
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return applySecurityHeaders(request, await route(request, env, ctx));
  },
};

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/_vinext/image") {
    const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
    return handleImageOptimization(request, {
      fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
      transformImage: async (body, { width, format, quality }) => {
        const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
        return result.response();
      },
    }, allowedWidths);
  }

  return handler.fetch(request, env, ctx);
}

/**
 * Directives that cannot change how the application loads its own scripts,
 * styles or images, and therefore cannot break a render — but that do close the
 * ways an injected fragment turns into an account compromise.
 *
 * `form-action` keeps an injected form from posting a password off-site.
 * `base-uri` keeps an injected <base> from rewriting every relative URL in the
 * page, which is the quiet way to redirect all of them at once. `object-src`
 * removes plugin embedding. `frame-ancestors` is the modern statement of the
 * X-Frame-Options below, which is kept for older agents.
 *
 * A script-src/style-src policy is deliberately not asserted here: the RSC
 * runtime inlines its own payload, so a correct one needs nonce propagation
 * through the framework and real browser acceptance. That stays a separate,
 * reviewed change rather than a guess that breaks Production.
 */
const CONTENT_SECURITY_POLICY =
  "base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'";

function applySecurityHeaders(request: Request, response: Response): Response {
  response.headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  // Nothing this application serves is meant to be read by another site.
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Permissions-Policy", "camera=(self), geolocation=(), microphone=()");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (new URL(request.url).protocol === "https:") {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
  return response;
}

export default worker;
