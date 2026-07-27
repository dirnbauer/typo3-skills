# Web server hardening (Apache and Nginx)

Server-level rules that complement TYPO3's own configuration. Apply them at **one** layer only —
duplicating headers across Apache, Nginx, a proxy and TYPO3's CSP API produces conflicting policies
that are hard to debug. Where the site runs behind a reverse proxy or CDN, the outermost layer that
still knows the request wins; check for headers already set upstream before adding them here.

`.htaccess` does not control Nginx. Verify which server actually serves the site before editing.

## Apache — `public/.htaccess`

```apache
# Block access to hidden files
<FilesMatch "^\.">
    Require all denied
</FilesMatch>

# Block access to sensitive file types
<FilesMatch "\.(sql|sqlite|bak|backup|log|sh)$">
    Require all denied
</FilesMatch>

# Block PHP execution in upload directories
<Directory "fileadmin">
    <FilesMatch "\.php$">
        Require all denied
    </FilesMatch>
</Directory>

# Security headers
<IfModule mod_headers.c>
    Header always set X-Content-Type-Options "nosniff"
    Header always set X-Frame-Options "SAMEORIGIN"
    Header always set Referrer-Policy "strict-origin-when-cross-origin"
    Header always set Permissions-Policy "geolocation=(), microphone=(), camera=()"
</IfModule>
```

## Nginx

```nginx
# Block hidden files
location ~ /\. {
    deny all;
}

# Block sensitive directories
location ~ ^/(config|var|vendor)/ {
    deny all;
}

# Block PHP in upload directories
location ~ ^/fileadmin/.*\.php$ {
    deny all;
}

# Security headers
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
```

## Verifying

Check what the server actually sends, rather than what the config says it should:

```bash
curl -sI https://example.ddev.site | grep -iE 'x-content-type|x-frame|referrer|permissions|strict-transport'
```

A header appearing twice means two layers are setting it — remove one. `X-Frame-Options` and a CSP
`frame-ancestors` directive overlap; where both are present, modern browsers honour `frame-ancestors`,
so keep the CSP directive and treat `X-Frame-Options` as the legacy fallback.

HSTS (`Strict-Transport-Security`) belongs only on production hosts served exclusively over HTTPS —
sending it from a local or mixed-scheme environment pins browsers to HTTPS for that hostname and is
awkward to undo.
