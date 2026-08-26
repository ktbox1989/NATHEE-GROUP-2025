<?php

declare(strict_types=1);

/*
 * NATHEE public News gateway.
 *
 * This file is included by the three narrow public entry points only. It never
 * accepts an upstream host from a request and never forwards visitor identity.
 */

const NATHEE_NEWS_UPSTREAM_ORIGIN = 'https://app.natheegroup2025.com';
const NATHEE_NEWS_LIST_PATH = '/api/public/v1/news';
const NATHEE_PUBLIC_ORIGIN = 'https://natheegroup2025.com';
const NATHEE_NEWS_JSON_MAX_BYTES = 2097152;
const NATHEE_MEDIA_MAX_BYTES = 12582912;
const NATHEE_CONNECT_TIMEOUT_MS = 3000;
const NATHEE_TOTAL_TIMEOUT_MS = 8000;
const NATHEE_NEWS_MAX_PAGES = 10;
const NATHEE_CACHE_CONTROL = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
const NATHEE_MEDIA_CACHE_CONTROL = 'public, max-age=3600, stale-while-revalidate=86400';
const NATHEE_NO_STORE = 'private, no-store';

const NATHEE_STATIC_SITEMAP_PATHS = [
    '/',
    '/about/',
    '/contact/',
    '/container-loading/',
    '/dealer-fleet/',
    '/gallery/',
    '/international/',
    '/motorcycle-transport/',
    '/quotation/',
    '/services/',
    '/storage/',
];

/** @return array{status:int,headers:array<string,string>,body:string} */
function nathee_response(int $status, string $body, string $contentType, string $cacheControl = NATHEE_NO_STORE): array
{
    return [
        'status' => $status,
        'headers' => [
            'Cache-Control' => $cacheControl,
            'Content-Type' => $contentType,
            'X-Content-Type-Options' => 'nosniff',
        ],
        'body' => $body,
    ];
}

function nathee_e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function nathee_non_empty_string(mixed $value, int $max): bool
{
    return is_string($value) && trim($value) !== '' && strlen($value) <= $max;
}

function nathee_iso_timestamp(mixed $value): bool
{
    if (!is_string($value) || $value === '' || strlen($value) > 64) {
        return false;
    }
    try {
        new DateTimeImmutable($value);
        return true;
    } catch (Throwable) {
        return false;
    }
}

function nathee_news_slug(mixed $value): bool
{
    if (!is_string($value) || strlen($value) < 1 || strlen($value) > 80) {
        return false;
    }
    if (preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/D', $value) !== 1) {
        return false;
    }
    return !in_array($value, ['page', 'feed', 'rss', 'atom', 'sitemap', 'index', 'all', 'category', 'tag'], true);
}

/** @return array{itemId:string,role:string,extension:string}|null */
function nathee_public_media_locator(mixed $value): ?array
{
    if (!is_string($value) || strlen($value) > 2048 || str_contains($value, '..') || str_contains($value, '%') || str_contains($value, '\\')) {
        return null;
    }

    $path = $value;
    if (str_starts_with($value, NATHEE_NEWS_UPSTREAM_ORIGIN)) {
        $parts = parse_url($value);
        if (!is_array($parts)
            || ($parts['scheme'] ?? '') !== 'https'
            || ($parts['host'] ?? '') !== 'app.natheegroup2025.com'
            || isset($parts['port'], $parts['user'], $parts['pass'], $parts['query'], $parts['fragment'])) {
            return null;
        }
        $path = (string) ($parts['path'] ?? '');
    } elseif (preg_match('/^[a-z][a-z0-9+.-]*:/i', $value) === 1 || str_starts_with($value, '//')) {
        return null;
    }

    if (preg_match('#^/assets/media/([a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?)/(display|thumbnail)\.(avif|webp|jpg|png)$#D', $path, $match) !== 1) {
        return null;
    }

    return ['itemId' => $match[1], 'role' => $match[2], 'extension' => $match[3]];
}

function nathee_public_media_path(mixed $value): ?string
{
    $locator = nathee_public_media_locator($value);
    return $locator === null
        ? null
        : sprintf('/assets/media/%s/%s.%s', $locator['itemId'], $locator['role'], $locator['extension']);
}

function nathee_upstream_path_allowed(string $path): bool
{
    if ($path === NATHEE_NEWS_LIST_PATH) {
        return true;
    }
    if (preg_match('#^/api/public/v1/news\?cursor=[A-Za-z0-9_-]{1,512}$#D', $path) === 1) {
        return true;
    }
    if (preg_match('#^/api/public/v1/news/[a-z0-9]+(?:-[a-z0-9]+)*$#D', $path) === 1) {
        $slug = substr($path, strlen('/api/public/v1/news/'));
        return nathee_news_slug($slug);
    }
    return nathee_public_media_path($path) === $path;
}

/**
 * Fixed-origin HTTPS client. Only fixed application routes pass the allowlist.
 * Visitor Cookie, Authorization and forwarding headers are never read here.
 *
 * @return array{status:int,headers:array<string,string>,body:string,transportError:?string}
 */
function nathee_gateway_http_request(string $path, string $accept, int $maxBytes, string $method = 'GET'): array
{
    if (!nathee_upstream_path_allowed($path) || !in_array($method, ['GET', 'HEAD'], true) || $maxBytes < 1 || $maxBytes > NATHEE_MEDIA_MAX_BYTES) {
        return ['status' => 0, 'headers' => [], 'body' => '', 'transportError' => 'blocked'];
    }
    if (!function_exists('curl_init')) {
        return ['status' => 0, 'headers' => [], 'body' => '', 'transportError' => 'curl_unavailable'];
    }

    $body = '';
    $tooLarge = false;
    $responseHeaders = [];
    $handle = curl_init(NATHEE_NEWS_UPSTREAM_ORIGIN . $path);
    if ($handle === false) {
        return ['status' => 0, 'headers' => [], 'body' => '', 'transportError' => 'transport'];
    }

    $options = [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_NOBODY => $method === 'HEAD',
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT_MS => NATHEE_CONNECT_TIMEOUT_MS,
        CURLOPT_TIMEOUT_MS => NATHEE_TOTAL_TIMEOUT_MS,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER => [
            'Accept: ' . $accept,
            'User-Agent: NATHEE-Public-Gateway/1.0',
        ],
        CURLOPT_HEADERFUNCTION => static function ($curl, string $line) use (&$responseHeaders): int {
            $length = strlen($line);
            $separator = strpos($line, ':');
            if ($separator === false) {
                return $length;
            }
            $name = strtolower(trim(substr($line, 0, $separator)));
            if (in_array($name, ['cache-control', 'content-length', 'content-type', 'etag'], true)) {
                $responseHeaders[$name] = trim(substr($line, $separator + 1));
            }
            return $length;
        },
        CURLOPT_WRITEFUNCTION => static function ($curl, string $chunk) use (&$body, &$tooLarge, $maxBytes): int {
            if (strlen($body) + strlen($chunk) > $maxBytes) {
                $tooLarge = true;
                return 0;
            }
            $body .= $chunk;
            return strlen($chunk);
        },
    ];
    if (defined('CURLOPT_PROTOCOLS') && defined('CURLPROTO_HTTPS')) {
        $options[CURLOPT_PROTOCOLS] = CURLPROTO_HTTPS;
    }
    if (defined('CURLOPT_REDIR_PROTOCOLS') && defined('CURLPROTO_HTTPS')) {
        $options[CURLOPT_REDIR_PROTOCOLS] = CURLPROTO_HTTPS;
    }
    curl_setopt_array($handle, $options);

    $ok = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $errorNumber = curl_errno($handle);
    curl_close($handle);

    if ($tooLarge) {
        return ['status' => 0, 'headers' => [], 'body' => '', 'transportError' => 'response_too_large'];
    }
    if ($ok === false) {
        $timeoutCode = defined('CURLE_OPERATION_TIMEDOUT') ? CURLE_OPERATION_TIMEDOUT : 28;
        return [
            'status' => 0,
            'headers' => [],
            'body' => '',
            'transportError' => $errorNumber === $timeoutCode ? 'timeout' : 'transport',
        ];
    }

    return ['status' => $status, 'headers' => $responseHeaders, 'body' => $body, 'transportError' => null];
}

function nathee_forbidden_internal_key(mixed $value): bool
{
    if (!is_array($value)) {
        return false;
    }
    $forbidden = ['storagekey', 'revisionid', 'requestkey', 'createdby', 'authoruserid', 'audit', 'draftid', 'previewid', 'originalurl'];
    foreach ($value as $key => $nested) {
        if (is_string($key) && in_array(strtolower($key), $forbidden, true)) {
            return true;
        }
        if (nathee_forbidden_internal_key($nested)) {
            return true;
        }
    }
    return false;
}

/** @return array<string,mixed>|null */
function nathee_validate_seo(mixed $value, string $canonicalPath): ?array
{
    if (!is_array($value)
        || !nathee_non_empty_string($value['title'] ?? null, 200)
        || !nathee_non_empty_string($value['description'] ?? null, 400)
        || ($value['canonicalPath'] ?? $canonicalPath) !== $canonicalPath
        || !in_array($value['robots'] ?? null, ['INDEX', 'NOINDEX'], true)) {
        return null;
    }
    return [
        'title' => trim($value['title']),
        'description' => trim($value['description']),
        'robots' => $value['robots'],
    ];
}

/** @return array<string,mixed>|null */
function nathee_validate_cover(mixed $value): ?array
{
    if ($value === null) {
        return [];
    }
    if (!is_array($value)) {
        return null;
    }
    $display = nathee_public_media_path($value['displayUrl'] ?? null);
    $thumbnail = nathee_public_media_path($value['thumbnailUrl'] ?? null);
    if ($display === null || $thumbnail === null) {
        return null;
    }
    return ['displayUrl' => $display, 'thumbnailUrl' => $thumbnail];
}

/** @return array<string,mixed>|null */
function nathee_validate_list_item(mixed $value): ?array
{
    if (!is_array($value) || nathee_forbidden_internal_key($value)) {
        return null;
    }
    if (array_key_exists('status', $value) && $value['status'] !== 'PUBLISHED') {
        return [];
    }
    $slug = $value['slug'] ?? null;
    if (!nathee_news_slug($slug)) {
        return null;
    }
    $canonical = '/news/' . $slug . '/';
    $seo = nathee_validate_seo($value['seo'] ?? null, $canonical);
    $cover = nathee_validate_cover($value['cover'] ?? null);
    if (!nathee_non_empty_string($value['title'] ?? null, 300)
        || !nathee_non_empty_string($value['excerpt'] ?? null, 500)
        || !nathee_iso_timestamp($value['publishedAt'] ?? null)
        || (($value['updatedAt'] ?? null) !== null && !nathee_iso_timestamp($value['updatedAt']))
        || ($value['canonicalPath'] ?? null) !== $canonical
        || $seo === null
        || $cover === null) {
        return null;
    }
    return [
        'slug' => $slug,
        'title' => trim($value['title']),
        'excerpt' => trim($value['excerpt']),
        'publishedAt' => $value['publishedAt'],
        'updatedAt' => $value['updatedAt'] ?? null,
        'canonicalPath' => $canonical,
        'cover' => $cover === [] ? null : $cover,
        'seo' => $seo,
    ];
}

/** @return array<string,mixed>|null */
function nathee_validate_media(mixed $value): ?array
{
    $captionValue = is_array($value) ? ($value['caption'] ?? null) : null;
    if (!is_array($value)
        || nathee_forbidden_internal_key($value)
        || !nathee_non_empty_string($value['id'] ?? null, 200)
        || !nathee_non_empty_string($value['altText'] ?? null, 500)
        || ($captionValue !== null && !nathee_non_empty_string($captionValue, 1000))
        || !is_array($value['variants'] ?? null)
        || count($value['variants']) < 1) {
        return null;
    }
    $variants = [];
    $hasDisplay = false;
    $extensionForFormat = ['jpeg' => 'jpg', 'webp' => 'webp', 'avif' => 'avif', 'png' => 'png'];
    foreach ($value['variants'] as $variant) {
        if (!is_array($variant)) {
            return null;
        }
        $path = nathee_public_media_path($variant['src'] ?? null);
        $locator = $path === null ? null : nathee_public_media_locator($path);
        $role = $variant['role'] ?? null;
        $format = $variant['format'] ?? null;
        $width = $variant['width'] ?? null;
        $height = $variant['height'] ?? null;
        if ($path === null
            || $locator === null
            || !in_array($role, ['display', 'thumbnail'], true)
            || !array_key_exists((string) $format, $extensionForFormat)
            || $locator['role'] !== $role
            || $locator['extension'] !== $extensionForFormat[$format]
            || !is_int($width) || $width < 1 || $width > 20000
            || !is_int($height) || $height < 1 || $height > 20000) {
            return null;
        }
        $hasDisplay = $hasDisplay || $role === 'display';
        $variants[] = compact('path', 'role', 'format', 'width', 'height');
    }
    if (!$hasDisplay) {
        return null;
    }
    return [
        'id' => $value['id'],
        'altText' => trim($value['altText']),
        'caption' => $captionValue === null ? null : trim($captionValue),
        'variants' => $variants,
    ];
}

/** @return list<array<string,mixed>>|null */
function nathee_validate_content(mixed $value): ?array
{
    if (!is_array($value)) {
        return null;
    }
    $sections = [];
    foreach ($value as $section) {
        $headingValue = is_array($section) ? ($section['heading'] ?? null) : null;
        if (!is_array($section)
            || nathee_forbidden_internal_key($section)
            || !nathee_non_empty_string($section['id'] ?? null, 200)
            || ($headingValue !== null && !nathee_non_empty_string($headingValue, 300))
            || !in_array($section['headingLevel'] ?? null, [2, 3], true)
            || ($headingValue === null && ($section['headingLevel'] ?? null) !== 2)
            || !is_array($section['body'] ?? null)
            || !is_array($section['media'] ?? null)) {
            return null;
        }
        $paragraphs = [];
        foreach ($section['body'] as $paragraph) {
            if (!nathee_non_empty_string($paragraph, 5000)) {
                return null;
            }
            $paragraphs[] = trim($paragraph);
        }
        $media = [];
        foreach ($section['media'] as $rawMedia) {
            $validated = nathee_validate_media($rawMedia);
            if ($validated === null) {
                return null;
            }
            $media[] = $validated;
        }
        $sections[] = [
            'id' => $section['id'],
            'heading' => $headingValue === null ? null : trim($headingValue),
            'headingLevel' => $section['headingLevel'],
            'body' => $paragraphs,
            'media' => $media,
        ];
    }
    return $sections;
}

/**
 * @param callable(string,string,int,string):array<string,mixed>|null $client
 * @return array{state:string,items?:list<array<string,mixed>>,nextCursor?:?string}
 */
function nathee_fetch_news_page(callable $client, string $path): array
{
    if (!nathee_upstream_path_allowed($path) || !str_starts_with($path, NATHEE_NEWS_LIST_PATH)) {
        return ['state' => 'unavailable'];
    }
    $upstream = $client($path, 'application/json', NATHEE_NEWS_JSON_MAX_BYTES, 'GET');
    if (($upstream['transportError'] ?? null) !== null || ($upstream['status'] ?? 0) !== 200) {
        return ['state' => 'unavailable'];
    }
    try {
        $payload = json_decode((string) ($upstream['body'] ?? ''), true, 64, JSON_THROW_ON_ERROR);
    } catch (Throwable) {
        return ['state' => 'unavailable'];
    }
    if (!is_array($payload) || ($payload['version'] ?? null) !== 1 || !is_array($payload['items'] ?? null)) {
        return ['state' => 'unavailable'];
    }
    $items = [];
    foreach ($payload['items'] as $rawItem) {
        $item = nathee_validate_list_item($rawItem);
        if ($item === []) {
            continue;
        }
        if ($item === null) {
            return ['state' => 'unavailable'];
        }
        $items[] = $item;
    }
    $next = $payload['nextCursor'] ?? null;
    if ($next !== null && (!is_string($next) || preg_match('/^[A-Za-z0-9_-]{1,512}$/D', $next) !== 1)) {
        return ['state' => 'unavailable'];
    }
    return ['state' => 'ok', 'items' => $items, 'nextCursor' => $next];
}

/**
 * @param callable(string,string,int,string):array<string,mixed>|null $client
 * @return array{state:string,items?:list<array<string,mixed>>}
 */
function nathee_fetch_all_news(callable $client): array
{
    $items = [];
    $path = NATHEE_NEWS_LIST_PATH;
    $seen = [];
    for ($page = 0; $page < NATHEE_NEWS_MAX_PAGES; $page++) {
        $result = nathee_fetch_news_page($client, $path);
        if ($result['state'] !== 'ok') {
            return ['state' => 'unavailable'];
        }
        array_push($items, ...$result['items']);
        $cursor = $result['nextCursor'];
        if ($cursor === null) {
            return ['state' => 'ok', 'items' => $items];
        }
        if (isset($seen[$cursor])) {
            return ['state' => 'unavailable'];
        }
        $seen[$cursor] = true;
        $path = NATHEE_NEWS_LIST_PATH . '?cursor=' . $cursor;
    }
    return ['state' => 'unavailable'];
}

/**
 * @param callable(string,string,int,string):array<string,mixed>|null $client
 * @return array{state:string,item?:array<string,mixed>}
 */
function nathee_fetch_news_detail(callable $client, string $slug): array
{
    if (!nathee_news_slug($slug)) {
        return ['state' => 'not_found'];
    }
    $upstream = $client('/api/public/v1/news/' . $slug, 'application/json', NATHEE_NEWS_JSON_MAX_BYTES, 'GET');
    $status = (int) ($upstream['status'] ?? 0);
    if (($upstream['transportError'] ?? null) !== null || in_array($status, [401, 403], true) || $status >= 500) {
        return ['state' => 'unavailable'];
    }
    if (in_array($status, [400, 404], true)) {
        return ['state' => 'not_found'];
    }
    if ($status !== 200) {
        return ['state' => 'unavailable'];
    }
    try {
        $payload = json_decode((string) ($upstream['body'] ?? ''), true, 64, JSON_THROW_ON_ERROR);
    } catch (Throwable) {
        return ['state' => 'unavailable'];
    }
    if (!is_array($payload) || ($payload['version'] ?? null) !== 1 || !is_array($payload['item'] ?? null)) {
        return ['state' => 'unavailable'];
    }
    $raw = $payload['item'];
    if (array_key_exists('status', $raw) && $raw['status'] !== 'PUBLISHED') {
        return ['state' => 'not_found'];
    }
    $item = nathee_validate_list_item($raw);
    $content = nathee_validate_content($raw['content'] ?? null);
    if ($item === null || $item === [] || $item['slug'] !== $slug || $content === null) {
        return ['state' => 'unavailable'];
    }
    $item['content'] = $content;
    return ['state' => 'ok', 'item' => $item];
}

function nathee_news_date(string $value): string
{
    try {
        return (new DateTimeImmutable($value))->setTimezone(new DateTimeZone('Asia/Bangkok'))->format('d/m/Y');
    } catch (Throwable) {
        return '';
    }
}

function nathee_media_markup(array $media): string
{
    $display = null;
    foreach ($media['variants'] as $variant) {
        if ($variant['role'] === 'display' && ($display === null || $variant['format'] === 'jpeg')) {
            $display = $variant;
        }
    }
    if ($display === null) {
        return '';
    }
    $caption = $media['caption'] === null ? '' : '<figcaption>' . nathee_e($media['caption']) . '</figcaption>';
    return '<figure class="news-media"><img src="' . nathee_e($display['path']) . '" alt="' . nathee_e($media['altText']) . '" width="' . $display['width'] . '" height="' . $display['height'] . '" loading="lazy" decoding="async">' . $caption . '</figure>';
}

function nathee_layout(string $title, string $description, string $canonicalPath, string $robots, string $main, ?string $ogImage = null): string
{
    $canonical = NATHEE_PUBLIC_ORIGIN . $canonicalPath;
    $robotsMeta = $robots === 'INDEX' ? 'index,follow,max-image-preview:large,max-snippet:-1' : 'noindex,nofollow';
    $og = $ogImage === null ? NATHEE_PUBLIC_ORIGIN . '/assets/brand/nathee-logo-display.jpg' : NATHEE_PUBLIC_ORIGIN . $ogImage;
    return '<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
        . '<title>' . nathee_e($title) . '</title><meta name="description" content="' . nathee_e($description) . '">'
        . '<meta name="robots" content="' . $robotsMeta . '"><meta name="theme-color" content="#0a1020"><meta name="referrer" content="strict-origin-when-cross-origin">'
        . '<link rel="canonical" href="' . nathee_e($canonical) . '"><link rel="alternate" hreflang="th-TH" href="' . nathee_e($canonical) . '">'
        . '<meta property="og:type" content="website"><meta property="og:locale" content="th_TH"><meta property="og:site_name" content="NATHEE GROUP 2025">'
        . '<meta property="og:title" content="' . nathee_e($title) . '"><meta property="og:description" content="' . nathee_e($description) . '"><meta property="og:url" content="' . nathee_e($canonical) . '"><meta property="og:image" content="' . nathee_e($og) . '">'
        . '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="' . nathee_e($title) . '"><meta name="twitter:description" content="' . nathee_e($description) . '"><meta name="twitter:image" content="' . nathee_e($og) . '">'
        . '<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="manifest" href="/site.webmanifest"><link rel="apple-touch-icon" sizes="180x180" href="/assets/brand/apple-touch-icon-180.png"><link rel="stylesheet" href="/assets/site.css"></head><body>'
        . '<a class="skip-link" href="#main">ข้ามไปยังเนื้อหาหลัก</a><header class="site-header" data-header><div class="shell header-inner"><a class="brand" href="/" aria-label="NATHEE GROUP 2025 หน้าแรก"><span class="brand-mark" aria-hidden="true">N</span><span><strong>NATHEE GROUP 2025</strong><small>Motorcycle Logistics</small></span></a><button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-nav" data-menu-toggle><span class="sr-only">เปิดเมนู</span><span></span><span></span><span></span></button><nav class="site-nav" id="site-nav" aria-label="เมนูหลัก" data-menu><a href="/services/">บริการ</a><a href="/gallery/">ผลงาน</a><a href="/news/" aria-current="page">ข่าวสาร</a><a href="/about/">เกี่ยวกับเรา</a><a href="/contact/">ติดต่อ</a><a href="/login/">เข้าสู่ระบบ</a><a class="button button-small" href="/quotation/">ขอใบเสนอราคา</a></nav></div></header>'
        . '<main id="main">' . $main . '</main><footer class="site-footer"><div class="shell footer-layout"><div><a class="brand footer-brand" href="/"><span class="brand-mark" aria-hidden="true">N</span><span><strong>NATHEE GROUP 2025</strong><small>Motorcycle Logistics</small></span></a><p>บริษัท นทีกรุ๊ป2025 จำกัด</p></div><div class="footer-links"><a href="/services/">บริการ</a><a href="/gallery/">ผลงาน</a><a href="/news/">ข่าวสาร</a><a href="/about/">เกี่ยวกับเรา</a><a href="/contact/">ติดต่อ</a></div><div class="footer-contact"><a href="tel:0631941191">063-194-1191</a><a href="tel:0856802082">085-680-2082</a><a href="/contact/#line">LINE: สแกน QR</a></div></div><div class="shell footer-bottom"><span>© 2026 บริษัท นทีกรุ๊ป2025 จำกัด</span><a href="/login/">ระบบลูกค้า</a></div></footer><script src="/assets/site.js" defer></script></body></html>';
}

/** @return array{status:int,headers:array<string,string>,body:string} */
function nathee_error_response(int $status): array
{
    $notFound = $status === 404;
    $title = $notFound ? 'ไม่พบข่าวที่ค้นหา | NATHEE GROUP 2025' : 'ข่าวสารไม่พร้อมใช้งานชั่วคราว | NATHEE GROUP 2025';
    $heading = $notFound ? 'ไม่พบข่าวที่ค้นหา' : 'ข่าวสารไม่พร้อมใช้งานชั่วคราว';
    $copy = $notFound ? 'บทความนี้ไม่มีอยู่หรือไม่ได้เผยแพร่แล้ว' : 'กรุณาลองใหม่อีกครั้งในภายหลัง';
    $main = '<section class="page-hero"><div class="shell"><nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">หน้าแรก</a><span>/</span><a href="/news/">ข่าวสาร</a></nav><p class="eyebrow"><span></span> NEWS</p><h1>' . $heading . '</h1><p>' . $copy . '</p></div></section><section class="section"><div class="shell"><div class="empty-state"><strong>' . $heading . '</strong><a class="text-link" href="/news/">กลับไปหน้าข่าวสาร <span aria-hidden="true">→</span></a></div></div></section>';
    return nathee_response($status, nathee_layout($title, $copy, '/news/', 'NOINDEX', $main), 'text/html; charset=utf-8');
}

function nathee_with_etag(array $response, array $server): array
{
    if ($response['status'] !== 200) {
        return $response;
    }
    $etag = '"' . hash('sha256', $response['body']) . '"';
    $response['headers']['ETag'] = $etag;
    if (($server['HTTP_IF_NONE_MATCH'] ?? null) === $etag) {
        $response['status'] = 304;
        $response['body'] = '';
        unset($response['headers']['Content-Type']);
    }
    return $response;
}

/**
 * @param callable(string,string,int,string):array<string,mixed>|null $client
 * @return array{status:int,headers:array<string,string>,body:string}
 */
function nathee_news_page_response(string $method, string $requestPath, array $server = [], ?callable $client = null): array
{
    if (!in_array($method, ['GET', 'HEAD'], true)) {
        $response = nathee_response(405, 'Method Not Allowed', 'text/plain; charset=utf-8');
        $response['headers']['Allow'] = 'GET, HEAD';
        return $response;
    }
    $client ??= 'nathee_gateway_http_request';
    $path = rawurldecode($requestPath);
    if ($path === '/news' || $path === '/news/') {
        $result = nathee_fetch_all_news($client);
        if ($result['state'] !== 'ok') {
            return nathee_error_response(503);
        }
        $items = $result['items'];
        $cards = '';
        foreach ($items as $item) {
            $image = $item['cover'] === null ? '' : '<img src="' . nathee_e($item['cover']['thumbnailUrl']) . '" alt="ภาพประกอบ: ' . nathee_e($item['title']) . '" loading="lazy" decoding="async">';
            $cards .= '<article class="news-card"><a class="news-card-media" href="' . nathee_e($item['canonicalPath']) . '">' . $image . '</a><div class="news-card-copy"><time datetime="' . nathee_e($item['publishedAt']) . '">' . nathee_news_date($item['publishedAt']) . '</time><h2><a href="' . nathee_e($item['canonicalPath']) . '">' . nathee_e($item['title']) . '</a></h2><p>' . nathee_e($item['excerpt']) . '</p><a class="text-link" href="' . nathee_e($item['canonicalPath']) . '">อ่านบทความ <span aria-hidden="true">→</span></a></div></article>';
        }
        if ($cards === '') {
            $cards = '<div class="empty-state"><strong>ยังไม่มีข่าวสารเผยแพร่</strong><p>เมื่อมีประกาศหรือความคืบหน้าใหม่ จะแสดงที่หน้านี้</p><a class="text-link" href="/services/">ดูบริการทั้งหมด <span aria-hidden="true">→</span></a></div>';
        }
        $main = '<section class="page-hero"><div class="shell"><nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">หน้าแรก</a><span aria-hidden="true">/</span><span>ข่าวสาร</span></nav><p class="eyebrow"><span></span> NEWS &amp; UPDATES</p><h1>ข่าวสารและบทความ</h1><p>ประกาศ ความรู้ และความคืบหน้าที่เผยแพร่โดย NATHEE GROUP 2025</p></div></section><section class="section"><div class="shell"><div class="news-grid">' . $cards . '</div></div></section>';
        $response = nathee_response(200, nathee_layout('ข่าวสารและบทความ | NATHEE GROUP 2025', 'ข่าวสาร ประกาศ และบทความจาก NATHEE GROUP 2025', '/news/', 'INDEX', $main), 'text/html; charset=utf-8', NATHEE_CACHE_CONTROL);
        return nathee_with_etag($response, $server);
    }

    if (preg_match('#^/news/([^/]+)/?$#D', $path, $match) !== 1 || !nathee_news_slug($match[1])) {
        return nathee_error_response(404);
    }
    $result = nathee_fetch_news_detail($client, $match[1]);
    if ($result['state'] === 'not_found') {
        return nathee_error_response(404);
    }
    if ($result['state'] !== 'ok') {
        return nathee_error_response(503);
    }
    $item = $result['item'];
    $cover = $item['cover'] === null ? '' : '<figure class="news-cover"><img src="' . nathee_e($item['cover']['displayUrl']) . '" alt="ภาพประกอบ: ' . nathee_e($item['title']) . '" loading="eager" decoding="async"></figure>';
    $sections = '';
    foreach ($item['content'] as $section) {
        $heading = $section['heading'] === null ? '' : '<h' . $section['headingLevel'] . '>' . nathee_e($section['heading']) . '</h' . $section['headingLevel'] . '>';
        $paragraphs = implode('', array_map(static fn (string $paragraph): string => '<p>' . nathee_e($paragraph) . '</p>', $section['body']));
        $media = implode('', array_map('nathee_media_markup', $section['media']));
        $sections .= '<section class="news-section" id="' . nathee_e($section['id']) . '">' . $heading . $paragraphs . $media . '</section>';
    }
    $main = '<article class="news-article"><header class="page-hero"><div class="shell"><nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">หน้าแรก</a><span>/</span><a href="/news/">ข่าวสาร</a><span>/</span><span>' . nathee_e($item['title']) . '</span></nav><p class="eyebrow"><span></span> NATHEE NEWS</p><h1>' . nathee_e($item['title']) . '</h1><p>' . nathee_e($item['excerpt']) . '</p><time datetime="' . nathee_e($item['publishedAt']) . '">เผยแพร่ ' . nathee_news_date($item['publishedAt']) . '</time></div></header><div class="shell news-article-body">' . $cover . $sections . '</div></article>';
    $ogImage = $item['cover']['displayUrl'] ?? null;
    $response = nathee_response(200, nathee_layout($item['seo']['title'], $item['seo']['description'], $item['canonicalPath'], $item['seo']['robots'], $main, $ogImage), 'text/html; charset=utf-8', NATHEE_CACHE_CONTROL);
    return nathee_with_etag($response, $server);
}

/**
 * @param callable(string,string,int,string):array<string,mixed>|null $client
 * @return array{status:int,headers:array<string,string>,body:string}
 */
function nathee_sitemap_response(string $method, array $server = [], ?callable $client = null): array
{
    if (!in_array($method, ['GET', 'HEAD'], true)) {
        $response = nathee_response(405, 'Method Not Allowed', 'text/plain; charset=utf-8');
        $response['headers']['Allow'] = 'GET, HEAD';
        return $response;
    }
    $client ??= 'nathee_gateway_http_request';
    $result = nathee_fetch_all_news($client);
    if ($result['state'] !== 'ok') {
        return nathee_response(503, 'Service temporarily unavailable', 'text/plain; charset=utf-8');
    }
    $paths = NATHEE_STATIC_SITEMAP_PATHS;
    $published = 0;
    foreach ($result['items'] as $item) {
        if ($item['seo']['robots'] !== 'INDEX') {
            continue;
        }
        $paths[] = $item['canonicalPath'];
        $published++;
    }
    if ($published > 0) {
        $paths[] = '/news/';
    }
    $paths = array_values(array_unique($paths));
    sort($paths, SORT_STRING);
    $rows = array_map(static fn (string $path): string => '  <url><loc>' . nathee_e(NATHEE_PUBLIC_ORIGIN . $path) . '</loc></url>', $paths);
    $xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n" . implode("\n", $rows) . "\n</urlset>\n";
    return nathee_with_etag(nathee_response(200, $xml, 'application/xml; charset=utf-8', NATHEE_CACHE_CONTROL), $server);
}

/**
 * @param callable(string,string,int,string):array<string,mixed>|null $client
 * @return array{status:int,headers:array<string,string>,body:string}
 */
function nathee_media_response(string $method, string $requestPath, array $server = [], ?callable $client = null): array
{
    if (!in_array($method, ['GET', 'HEAD'], true)) {
        $response = nathee_response(405, 'Method Not Allowed', 'text/plain; charset=utf-8');
        $response['headers']['Allow'] = 'GET, HEAD';
        return $response;
    }
    $path = nathee_public_media_path(rawurldecode($requestPath));
    if ($path === null || $path !== rawurldecode($requestPath)) {
        return nathee_response(404, 'Not found', 'text/plain; charset=utf-8');
    }
    $client ??= 'nathee_gateway_http_request';
    $upstream = $client($path, 'image/avif,image/webp,image/jpeg,image/png', NATHEE_MEDIA_MAX_BYTES, $method);
    $status = (int) ($upstream['status'] ?? 0);
    if (($upstream['transportError'] ?? null) !== null || in_array($status, [401, 403], true) || $status >= 500) {
        return nathee_response(503, 'Service temporarily unavailable', 'text/plain; charset=utf-8');
    }
    if ($status === 404) {
        return nathee_response(404, 'Not found', 'text/plain; charset=utf-8');
    }
    $contentType = strtolower(trim(explode(';', (string) (($upstream['headers']['content-type'] ?? '')))[0]));
    $allowedTypes = ['image/avif', 'image/webp', 'image/jpeg', 'image/png'];
    if ($status !== 200 || !in_array($contentType, $allowedTypes, true)) {
        return nathee_response(503, 'Service temporarily unavailable', 'text/plain; charset=utf-8');
    }
    $body = $method === 'HEAD' ? '' : (string) ($upstream['body'] ?? '');
    if ($method === 'GET' && ($body === '' || strlen($body) > NATHEE_MEDIA_MAX_BYTES)) {
        return nathee_response(503, 'Service temporarily unavailable', 'text/plain; charset=utf-8');
    }
    $response = nathee_response(200, $body, $contentType, NATHEE_MEDIA_CACHE_CONTROL);
    if ($method === 'GET') {
        $response['headers']['Content-Length'] = (string) strlen($body);
        $response['headers']['ETag'] = '"' . hash('sha256', $body) . '"';
    } elseif (preg_match('/^[1-9][0-9]{0,8}$/D', (string) ($upstream['headers']['content-length'] ?? '')) === 1) {
        $response['headers']['Content-Length'] = (string) $upstream['headers']['content-length'];
    }
    return $response;
}

function nathee_emit_response(array $response, string $requestMethod): never
{
    http_response_code($response['status']);
    foreach ($response['headers'] as $name => $value) {
        header($name . ': ' . $value, true);
    }
    if ($requestMethod !== 'HEAD' && $response['status'] !== 304) {
        echo $response['body'];
    }
    exit;
}
