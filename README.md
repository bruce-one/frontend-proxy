Frontend Proxy
==============

A HTTP2 -> HTTP caching proxy which will minify and compress Javascript and CSS
for subsequent requests (the cached results are just kept in memory).

Requests are forwarded to the upstream server and on response the content type
is checked to see whether the contents are minifiable (ie, whether it's CSS or
Javascript). If so, the request is still proxied to the client but a process is
forked to minify the response (to avoid blocking the event loop, and to work
without native modules) and then the response is gzipped as well. These steps
are done in parallel to the response being forwarded and don't affect the
current response at all. (Any request while processing is occurring is just
proxied.)

The minified and gzipped contents are then cached. Any request received where a
cached response is stored (just based on the url) will be answered from the
"gzipped" or "uncompressed" cache (based on the accept-encoding header); or a
304 as appropriate.

A single executable can be built using nexe to simplify deployment.


Use case
--------

Deploying a POC web application to a remote server but no minifying or
compressing has been configured in the POC yet -- hence the performance is very
poor. This proxy will improve the speed of the POC by reducing file sizes and
handling caching. The use of HTTP2 should also improve performance.
