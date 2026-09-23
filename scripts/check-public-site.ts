import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const origin = "https://olpd.vercel.app";
const remote = process.env.SITE_URL;
async function get(file: string, mime: string) {
  if (!remote) return readFile("dist/" + file);
  const response = await fetch(new URL(file, remote.endsWith("/") ? remote : remote + "/"));
  assert.equal(response.status, 200, file + " HTTP status");
  assert.ok(response.headers.get("content-type")?.includes(mime), file + " content type");
  assert.ok(!/noindex|none/i.test(response.headers.get("x-robots-tag") ?? ""), file + " blocked by response header");
  return Buffer.from(await response.arrayBuffer());
}
const html = (await get("index.html", "text/html")).toString();
function meta(key: string) {
  const tags = html.match(/<meta\s[^>]+>/gi) ?? [];
  const matches = tags.filter(tag => tag.includes('name="' + key + '"') || tag.includes('property="' + key + '"'));
  assert.equal(matches.length, 1, key + " must occur once in the initial HTML");
  return matches[0].match(/content="([^"]*)"/)?.[1];
}
assert.equal(meta("naver-site-verification"), "6d3208fb4bab966a6805b1852e4bc2e44ae7377a");
assert.equal(meta("google-site-verification"), "YrP6a4GSewvHaif-9CGokegbtJMysU_bsVERahsg5GY");
assert.match(meta("robots")!, /^index,follow/);
assert.ok(!/noindex|none/.test(meta("robots")!));
assert.ok(html.includes('rel="canonical" href="' + origin + '/"'));
assert.match(meta("description")!, /던전 퍼즐/);
assert.equal(meta("og:url"), origin + "/");
assert.equal(meta("og:image"), origin + "/og/one-line-per-death.png");
assert.equal(meta("twitter:image"), meta("og:image"));
assert.equal(meta("twitter:card"), "summary_large_image");
assert.equal(meta("og:image:width"), "1200");
assert.equal(meta("og:image:height"), "630");
const schema = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
assert.equal(schema["@type"], "VideoGame");
assert.equal(schema.url, origin + "/");
const robots = (await get("robots.txt", "text/plain")).toString();
assert.ok(!/^Disallow:\s*\/\s*$/m.test(robots), "robots must not block the entire site");
assert.ok(robots.includes("Disallow: /api/"));
assert.ok(robots.includes("Sitemap: " + origin + "/sitemap.xml"));
const sitemap = (await get("sitemap.xml", "xml")).toString();
assert.deepEqual([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]), [origin + "/"]);
const image = await get("og/one-line-per-death.png", "image/png");
assert.equal(image.subarray(1, 4).toString(), "PNG");
assert.equal(image.readUInt32BE(16), 1200);
assert.equal(image.readUInt32BE(20), 630);
assert.ok(image.length < 1024 * 1024, "share image should stay under 1 MiB");
if (remote) {
  const root = await fetch(remote);
  assert.equal(root.status, 200);
  assert.ok(!/noindex|none/i.test(root.headers.get("x-robots-tag") ?? ""), "root blocked by response header");
  assert.ok((await root.text()).includes('name="naver-site-verification"'));
}
console.log("PASS " + (remote ?? "dist") + ": initial HTML verification/meta/canonical/JSON-LD, crawl access, sitemap, 1200x630 share image");
