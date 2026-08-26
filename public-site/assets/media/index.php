<?php

declare(strict_types=1);

require dirname(__DIR__, 2) . '/_nathee/news-gateway.php';

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$requestPath = (string) (parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH) ?: '');
nathee_emit_response(nathee_media_response($method, $requestPath, $_SERVER), $method);
