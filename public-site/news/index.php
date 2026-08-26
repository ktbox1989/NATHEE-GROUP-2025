<?php

declare(strict_types=1);

require dirname(__DIR__) . '/_nathee/news-gateway.php';

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$requestPath = (string) (parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/news/'), PHP_URL_PATH) ?: '/news/');
nathee_emit_response(nathee_news_page_response($method, $requestPath, $_SERVER), $method);
