<?php

declare(strict_types=1);

require dirname(__DIR__) . '/public-site/_nathee/news-gateway.php';

$assertions = 0;

function check(bool $condition, string $message): void
{
    global $assertions;
    $assertions++;
    if (!$condition) {
        throw new RuntimeException('PHP_NEWS_TEST_FAIL: ' . $message);
    }
}

/** @return array{status:int,headers:array<string,string>,body:string,transportError:?string} */
function upstream(int $status, string $body = '', array $headers = [], ?string $transportError = null): array
{
    return ['status' => $status, 'headers' => $headers, 'body' => $body, 'transportError' => $transportError];
}

function json_upstream(array $payload, int $status = 200): array
{
    return upstream($status, json_encode($payload, JSON_THROW_ON_ERROR), ['content-type' => 'application/json; charset=utf-8']);
}

function client_for(array $routes, ?array &$calls = null): callable
{
    return static function (string $path, string $accept, int $maxBytes, string $method = 'GET') use ($routes, &$calls): array {
        if ($calls !== null) {
            $calls[] = compact('path', 'accept', 'maxBytes', 'method');
        }
        return $routes[$method . ' ' . $path] ?? $routes[$path] ?? upstream(500);
    };
}

function list_item(string $slug = 'safe-news', string $robots = 'INDEX'): array
{
    return [
        'slug' => $slug,
        'title' => 'ข่าวจริงจาก NATHEE',
        'excerpt' => 'รายละเอียดที่เผยแพร่แล้วจากสัญญา Public API',
        'publishedAt' => '2026-08-27T01:00:00.000Z',
        'updatedAt' => null,
        'canonicalPath' => '/news/' . $slug . '/',
        'cover' => [
            'displayUrl' => '/assets/media/public-photo/display.jpg',
            'thumbnailUrl' => '/assets/media/public-photo/thumbnail.webp',
        ],
        'seo' => [
            'title' => 'ข่าวจริงจาก NATHEE | NATHEE GROUP 2025',
            'description' => 'คำอธิบายข่าวจริงสำหรับผลการค้นหา',
            'robots' => $robots,
        ],
    ];
}

function detail_item(string $slug = 'safe-news'): array
{
    return [
        ...list_item($slug),
        'content' => [[
            'id' => 'section-one',
            'heading' => 'รายละเอียดข่าว',
            'headingLevel' => 2,
            'body' => ['เนื้อหาที่ผ่านการเผยแพร่เท่านั้น'],
            'media' => [[
                'id' => 'public-photo',
                'altText' => 'ภาพการปฏิบัติงานที่เผยแพร่แล้ว',
                'caption' => 'ภาพประกอบข่าว',
                'variants' => [[
                    'src' => '/assets/media/public-photo/display.jpg',
                    'width' => 1200,
                    'height' => 800,
                    'format' => 'jpeg',
                    'role' => 'display',
                ]],
            ]],
        ]],
    ];
}

$emptyClient = client_for([
    NATHEE_NEWS_LIST_PATH => json_upstream(['version' => 1, 'items' => [], 'nextCursor' => null]),
]);
$empty = nathee_news_page_response('GET', '/news/', [], $emptyClient);
check($empty['status'] === 200, 'empty catalog must render 200');
check(str_contains($empty['body'], 'ยังไม่มีข่าวสารเผยแพร่'), 'empty state must be explicit');
check(!str_contains($empty['body'], 'ตัวอย่างข่าว'), 'empty state must not fabricate content');
check($empty['headers']['Cache-Control'] === NATHEE_CACHE_CONTROL, 'empty list must use bounded public cache');

$published = list_item();
$draft = list_item('draft-secret');
$draft['status'] = 'DRAFT';
$listClient = client_for([
    NATHEE_NEWS_LIST_PATH => json_upstream(['version' => 1, 'items' => [$published, $draft], 'nextCursor' => null]),
]);
$list = nathee_news_page_response('GET', '/news/', [], $listClient);
check($list['status'] === 200, 'published list must render 200');
check(str_contains($list['body'], 'ข่าวจริงจาก NATHEE'), 'published item must render');
check(!str_contains($list['body'], 'draft-secret'), 'draft item must not render');

$detailClient = client_for([
    '/api/public/v1/news/safe-news' => json_upstream(['version' => 1, 'item' => detail_item()]),
]);
$detail = nathee_news_page_response('GET', '/news/safe-news/', [], $detailClient);
check($detail['status'] === 200, 'published detail must render 200');
check(str_contains($detail['body'], 'เนื้อหาที่ผ่านการเผยแพร่เท่านั้น'), 'published detail body must render');
check(str_contains($detail['body'], '<link rel="canonical" href="https://natheegroup2025.com/news/safe-news/">'), 'detail canonical must be local public origin');
check(str_contains($detail['body'], '/assets/media/public-photo/display.jpg'), 'detail must use canonical public media path');
check(!str_contains($detail['body'], 'storageKey'), 'detail must not expose storage keys');

$unknownClient = client_for([
    '/api/public/v1/news/missing-news' => json_upstream(['version' => 1, 'error' => ['code' => 'not_found']], 404),
]);
check(nathee_news_page_response('GET', '/news/missing-news/', [], $unknownClient)['status'] === 404, 'unknown detail must be local 404');

$draftDetail = detail_item('draft-news');
$draftDetail['status'] = 'DRAFT';
$draftDetailClient = client_for([
    '/api/public/v1/news/draft-news' => json_upstream(['version' => 1, 'item' => $draftDetail]),
]);
check(nathee_news_page_response('GET', '/news/draft-news/', [], $draftDetailClient)['status'] === 404, 'draft detail must be indistinguishable from missing');

$never = static function (): array {
    throw new RuntimeException('unsafe request reached upstream');
};
check(nathee_news_page_response('GET', '/news/UPPERCASE/', [], $never)['status'] === 404, 'unsafe slug must be blocked');
check(nathee_news_page_response('GET', '/news/../../api/users/', [], $never)['status'] === 404, 'path traversal must be blocked');
check(nathee_news_page_response('POST', '/news/', [], $never)['status'] === 405, 'News mutation must be impossible');

$calls = [];
$hostProofClient = client_for([
    '/api/public/v1/news/safe-news' => json_upstream(['version' => 1, 'item' => detail_item()]),
], $calls);
$hostProof = nathee_news_page_response('GET', '/news/safe-news/', [
    'HTTP_HOST' => 'evil.example',
    'HTTP_AUTHORIZATION' => 'Bearer visitor-secret',
    'HTTP_COOKIE' => 'nathee_owner_session=visitor-secret',
    'HTTP_X_FORWARDED_HOST' => 'evil.example',
], $hostProofClient);
check($hostProof['status'] === 200, 'safe fixed-host fixture must render');
check(count($calls) === 1 && $calls[0]['path'] === '/api/public/v1/news/safe-news', 'visitor host must not influence upstream path');
check(!array_key_exists('headers', $calls[0]), 'visitor Authorization and Cookie must not be forwarded');

foreach ([401, 403, 500, 503] as $status) {
    $failure = nathee_news_page_response('GET', '/news/', [], client_for([
        NATHEE_NEWS_LIST_PATH => upstream($status, 'raw upstream error'),
    ]));
    check($failure['status'] === 503, 'upstream ' . $status . ' must fail closed');
    check(!str_contains($failure['body'], 'raw upstream error'), 'upstream error body must not leak');
    check($failure['headers']['Cache-Control'] === NATHEE_NO_STORE, 'upstream failure must not be cached');
}
$timeout = nathee_news_page_response('GET', '/news/', [], client_for([
    NATHEE_NEWS_LIST_PATH => upstream(0, '', [], 'timeout'),
]));
check($timeout['status'] === 503, 'upstream timeout must fail closed');
$malformed = nathee_news_page_response('GET', '/news/', [], client_for([
    NATHEE_NEWS_LIST_PATH => upstream(200, '{bad json', ['content-type' => 'application/json']),
]));
check($malformed['status'] === 503, 'malformed JSON must fail closed');

$mediaBody = "\xff\xd8\xfffixture";
$mediaPath = '/assets/media/public-photo/display.jpg';
$mediaClient = client_for([
    'GET ' . $mediaPath => upstream(200, $mediaBody, ['content-type' => 'image/jpeg', 'content-length' => (string) strlen($mediaBody)]),
    'HEAD ' . $mediaPath => upstream(200, '', ['content-type' => 'image/jpeg', 'content-length' => (string) strlen($mediaBody)]),
]);
$mediaGet = nathee_media_response('GET', $mediaPath, [], $mediaClient);
check($mediaGet['status'] === 200 && $mediaGet['body'] === $mediaBody, 'public media GET must pass');
check($mediaGet['headers']['Content-Type'] === 'image/jpeg', 'public media type must be allowlisted');
check($mediaGet['headers']['Cache-Control'] === NATHEE_MEDIA_CACHE_CONTROL, 'public media cache must be bounded');
$mediaHead = nathee_media_response('HEAD', $mediaPath, [], $mediaClient);
check($mediaHead['status'] === 200 && $mediaHead['body'] === '', 'public media HEAD must have no body');
foreach (['/assets/media/public-photo/original.jpg', '/api/images/private', '/assets/media/../private/display.jpg', '/assets/media/public-photo/display.svg'] as $unsafeMedia) {
    check(nathee_media_response('GET', $unsafeMedia, [], $never)['status'] === 404, 'private or malformed media path must be blocked: ' . $unsafeMedia);
}

$sitemapEmpty = nathee_sitemap_response('GET', [], $emptyClient);
check($sitemapEmpty['status'] === 200, 'empty sitemap must remain available');
check(str_contains($sitemapEmpty['body'], '<loc>https://natheegroup2025.com/services/</loc>'), 'sitemap must preserve static routes');
check(!str_contains($sitemapEmpty['body'], '/news/'), 'empty catalog must not advertise News index');

$noindex = list_item('internal-announcement', 'NOINDEX');
$sitemapClient = client_for([
    NATHEE_NEWS_LIST_PATH => json_upstream(['version' => 1, 'items' => [$published, $noindex, $draft], 'nextCursor' => null]),
]);
$sitemap = nathee_sitemap_response('GET', [], $sitemapClient);
check($sitemap['status'] === 200, 'published sitemap must render');
check(str_contains($sitemap['body'], '<loc>https://natheegroup2025.com/news/</loc>'), 'News index must appear when an indexable post exists');
check(str_contains($sitemap['body'], '<loc>https://natheegroup2025.com/news/safe-news/</loc>'), 'published indexable post must appear');
check(!str_contains($sitemap['body'], 'internal-announcement'), 'NOINDEX post must not appear in sitemap');
check(!str_contains($sitemap['body'], 'draft-secret'), 'draft post must not appear in sitemap');

$etagged = nathee_news_page_response('GET', '/news/', [], $emptyClient);
$notModified = nathee_news_page_response('HEAD', '/news/', ['HTTP_IF_NONE_MATCH' => $etagged['headers']['ETag']], $emptyClient);
check($notModified['status'] === 304 && $notModified['body'] === '', 'ETag must support 304');

fwrite(STDOUT, 'PHP_NEWS_GATEWAY_TEST_PASS assertions=' . $assertions . "\n");
