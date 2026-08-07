# Deploy — radio.veris.ovh (Contabo + Dokploy)

Static SPA. The build produces plain files served by nginx; there is no
backend, no database and no environment variables. The Radio Browser API
is called straight from the browser.

## What is in the repo for this

| File | Purpose |
|---|---|
| `Dockerfile` | Two stages: Node 22 builds, nginx serves |
| `nginx.conf` | gzip, cache headers, SPA fallback |
| `.dockerignore` | Keeps `node_modules` and `dist` out of the build context |

The image listens on **port 80**.

## 1. DNS

Point the subdomain at the Contabo server before deploying, or
Let's Encrypt will fail to issue a certificate.

```
A    radio.veris.ovh    <contabo-server-ip>
```

Check it has propagated:

```sh
dig +short radio.veris.ovh
```

Ports 80 and 443 must be open on the server — Traefik needs 80 for the
ACME HTTP challenge.

## 2. Dokploy

1. **Projects → Create Project** — name it `radio-earth`.
2. **Create Service → Application**.
3. **Provider** — pick the Git provider holding this repo, then choose
   the repository and branch (`main`).
4. **Build Type → Dockerfile**. Path: `./Dockerfile`. Leave the build
   context as the repo root.
5. **Domains → Add Domain**:
   - Host: `radio.veris.ovh`
   - Container port: `80`
   - HTTPS: on
   - Certificate provider: Let's Encrypt
6. **Deploy**, then watch the build log.

## 3. Verify

```sh
curl -I https://radio.veris.ovh
```

Expect `200`, and `content-encoding: gzip` on the JS asset:

```sh
curl -sI -H 'Accept-Encoding: gzip' https://radio.veris.ovh/assets/index-*.js | grep -i content-encoding
```

In the browser, confirm:

- stations appear within ~1-2s, counter reads "… · loading more…"
- the counter climbs to roughly 7,900 and the suffix disappears
- Ctrl/Cmd+K, type something obscure — results should come from the
  server, not just the loaded pool
- clicking a station plays audio

## Notes

- **Rebuild on push**: enable Auto Deploy in Dokploy and add the webhook
  to the Git provider.
- **`index.html` is served with `no-cache` on purpose.** Its asset
  filenames change every build; caching it strands clients on files that
  no longer exist.
- **Do not add `crossorigin` to the `<audio>` tag.** It forces a CORS
  check that radio servers do not answer, which blocks playback.
- The app requires HTTPS stream URLs. That is deliberate: on an HTTPS
  origin the browser blocks plain-HTTP streams as mixed content.
