<?php

declare(strict_types=1);

require __DIR__ . '/_nathee/news-gateway.php';

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$requestPath = (string) (parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH) ?: '');
if ($requestPath !== '/sitemap.xml') {
    nathee_emit_response(nathee_response(404, 'Not found', 'text/plain; charset=utf-8'), $method);
}
nathee_emit_response(nathee_sitemap_response($method, $_SERVER), $method);
