import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText } from '../src/html-text.js';

test('drops script, style, noscript, template, svg, iframe, comments and head (except title)', () => {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/elsewhere">
    <title>Doc Title</title><style>body { color: red }</style><script>var a = "<p>not text</p>";</script>
    <link rel=stylesheet href=/a.css><base href="https://base.example/"></head>
    <body><!-- comment <p>hidden</p> --><p>Hello</p><SCRIPT type="module">console.log('<b>x</b>')</SCRIPT>
    <noscript><p>Enable JS</p></noscript><template><p>tpl</p></template>
    <svg><title>icon</title><text>svgtext</text><a href="/svg-link">s</a></svg><iframe src="x">fallback</iframe><style>.x{}</style></body></html>`;
  const result = htmlToText(html);
  assert.equal(result.title, 'Doc Title');
  assert.equal(result.text, 'Hello');
  assert.deepEqual(result.links, []);
  assert.equal(result.truncated, false);
});

test('title falls back to the first h1 (plain text, links stripped)', () => {
  assert.equal(htmlToText('<h1>Main <em>Heading</em></h1><p>x</p>').title, 'Main Heading');
  assert.equal(htmlToText('<h1><a href="/">Site</a></h1><h1>Second</h1>').title, 'Site');
  assert.equal(htmlToText('<h1>  </h1><h1>Real</h1>').title, 'Real');
  assert.equal(htmlToText('<p>no title anywhere</p>').title, '');
  assert.equal(htmlToText('<title> Spaced &amp; entity </title><h1>H</h1>').title, 'Spaced & entity');
});

test('headings become #-prefixed lines', () => {
  const result = htmlToText('<h1>One</h1><h2>Two</h2><h3>Three</h3><H6>Six</H6><p>body</p>');
  assert.equal(result.text, '# One\n\n## Two\n\n### Three\n\n###### Six\n\nbody');
});

test('lists become "- " items, nested lists indent', () => {
  const result = htmlToText('<ul><li>One</li><li>Two<ul><li>Nested</li></ul></li></ul><ol><li>First</li><li>Second</li></ol>');
  assert.equal(result.text, '- One\n- Two\n  - Nested\n\n- First\n- Second');
});

test('links resolve against baseUrl, skip javascript:/data:/empty hrefs, dedupe by href', () => {
  const html = '<p><a href="/docs/intro">Intro</a> and <a href="https://x.com/a?b=1&amp;c=2">Ext</a> <a href="javascript:void(0)">JS</a>'
    + ' <a href="data:text/plain,hi">D</a> <a href="">E</a> <a href="#top">Top</a> <a href="/docs/intro"> Intro again </a> <a href="/img"><img src="x.png"></a></p>';
  const result = htmlToText(html, { baseUrl: 'https://example.com/guide/' });
  assert.equal(result.text, '[Intro](https://example.com/docs/intro) and [Ext](https://x.com/a?b=1&c=2) JS D E [Top](https://example.com/guide/#top) [Intro again](https://example.com/docs/intro)');
  assert.deepEqual(result.links, [
    { text: 'Intro', href: 'https://example.com/docs/intro' },
    { text: 'Ext', href: 'https://x.com/a?b=1&c=2' },
    { text: 'Top', href: 'https://example.com/guide/#top' },
  ]);
  const relative = htmlToText('<a href="docs/intro">Intro</a>');
  assert.equal(relative.text, '[Intro](docs/intro)');
  assert.deepEqual(relative.links, [{ text: 'Intro', href: 'docs/intro' }]);
});

test('<base href> in head rebases relative links', () => {
  const result = htmlToText('<head><base href="https://cdn.example/root/"></head><body><a href="page">P</a></body>');
  assert.deepEqual(result.links, [{ text: 'P', href: 'https://cdn.example/root/page' }]);
});

test('a link spanning block elements stays plain in the text but is still collected', () => {
  const result = htmlToText('<a href="/x"><div>Block</div>Link</a>', { baseUrl: 'https://e.com' });
  assert.equal(result.text, 'Block\nLink');
  assert.deepEqual(result.links, [{ text: 'Block Link', href: 'https://e.com/x' }]);
});

test('decodes common and numeric entities, leaves unknown ones alone', () => {
  const result = htmlToText('<p>Tom &amp; Jerry &lt;3&gt; &quot;hi&quot; it&#39;s &#65;&#x42;&#x1F600; &nbsp; done &unknown; &amp &#0; &mdash;</p>');
  assert.equal(result.text, 'Tom & Jerry <3> "hi" it\'s AB\u{1F600} done &unknown; &amp &#0; —');
});

test('collapses whitespace runs and limits blank lines to one; table cells are space separated', () => {
  const result = htmlToText('<div>  a \n\t\n  b </div>\n\n\n<div>c</div><p></p><p>  </p><p></p><div>d</div><span> e </span><b>f</b>');
  assert.equal(result.text, 'a b\nc\n\nd\ne f');
  assert.ok(!result.text.includes('\n\n\n'));
  assert.equal(htmlToText('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>').text, 'A B\n1 2');
  assert.equal(htmlToText('a < b and c > d').text, 'a < b and c > d');
});

test('pre keeps internal whitespace and drops the leading newline', () => {
  const result = htmlToText('<p>before</p><pre>\nline 1\n    indented   x\n\nlast</pre><p>after</p><pre><code>a &lt; b</code></pre>');
  assert.equal(result.text, 'before\n\nline 1\n    indented   x\n\nlast\n\nafter\n\na < b');
});

test('handles nested unclosed tags gracefully', () => {
  const result = htmlToText('<div><p>One<p>Two<div>Three<ul><li>A<li>B</ul><span>tail<b>bold<i>italic');
  assert.equal(result.text, 'One\n\nTwo\nThree\n\n- A\n- B\n\ntailbolditalic');
  assert.equal(htmlToText('<div class="x').text, '');
  assert.equal(htmlToText('<script>never closed<p>x</p>').text, '');
  assert.equal(htmlToText('<head><title>T</title><p>body without head close</p>').text, 'body without head close');
});

test('uppercase tag names and unquoted attribute values', () => {
  const result = htmlToText('<DIV><A HREF=/path Title=x>Link</A><BR>next<IMG SRC=x.png alt=pic><HR/>after<P CLASS = "c">para</P></DIV>', { baseUrl: 'https://e.com' });
  assert.equal(result.text, '[Link](https://e.com/path)\nnext\n\nafter\n\npara');
  assert.deepEqual(result.links, [{ text: 'Link', href: 'https://e.com/path' }]);
});

test('maxChars truncates at a line boundary and reports truncated', () => {
  const line = 'x'.repeat(30), html = Array.from({ length: 10 }, () => `<p>${line}</p>`).join('');
  const result = htmlToText(html, { maxChars: 100 });
  assert.equal(result.truncated, true);
  assert.ok(result.text.length <= 100);
  assert.equal(result.text, [line, line, line].join('\n\n'));
  assert.equal(htmlToText(html).truncated, false);
  assert.equal(htmlToText(html).text.length, 10 * 30 + 9 * 2);
  const hard = htmlToText('<p>' + 'y'.repeat(500) + '</p>', { maxChars: 100 });
  assert.equal(hard.truncated, true);
  assert.equal(hard.text, 'y'.repeat(100));
});

test('caps links at 200, dedupes by href, trims link text to 200 chars', () => {
  const anchors = Array.from({ length: 250 }, (_, i) => `<a href="/p/${i}">Page ${i}</a> <a href="/p/${i}">dup ${i}</a>`).join(' ');
  const result = htmlToText('<p>' + anchors + '</p>', { baseUrl: 'https://e.com' });
  assert.equal(result.links.length, 200);
  assert.equal(result.links.filter(link => link.href === 'https://e.com/p/3').length, 1);
  assert.deepEqual(result.links[199], { text: 'Page 199', href: 'https://e.com/p/199' });
  const long = htmlToText(`<a href="/l">  ${'t'.repeat(300)}  </a>`);
  assert.equal(long.links[0]?.text.length, 200);
});

test('plain text input passes through normalized', () => {
  const result = htmlToText('Just   some text\n\nsecond   para\n\n\n\nthird\r\n');
  assert.equal(result.text, 'Just some text\n\nsecond para\n\nthird');
  assert.equal(result.title, '');
  assert.deepEqual(result.links, []);
  assert.equal(result.truncated, false);
  assert.equal(htmlToText('').text, '');
});

const DOCS_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Configuration · Nibbi Daemon Docs</title>
  <link rel="stylesheet" href="/assets/docs.css">
  <script async src="https://analytics.example/track.js" data-site="ANALYTICS_SITE_ID"></script>
  <script>window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);} gtag('js', new Date());</script>
  <style>.sidebar { width: 240px } .sidebar a { color: #05d371 }</style>
</head>
<body class="docs">
  <header class="site-header">
    <a class="logo" href="/"><img src="/logo.svg" alt="Nibbi"></a>
    <nav class="top-nav">
      <ul>
        <li><a href="/docs/">Docs</a></li>
        <li><a href="/docs/api/">API</a></li>
        <li><a href="https://github.com/example/nibbi">GitHub</a></li>
      </ul>
      <script>document.querySelectorAll('.top-nav a').forEach(a => a.addEventListener('click', () => NAV_TRACK(a.href)));</script>
    </nav>
  </header>
  <aside class="sidebar">
    <ul>
      <li><a href="/docs/getting-started">Getting started</a></li>
      <li><a href="/docs/configuration" aria-current="page">Configuration</a></li>
      <li><a href="/docs/scheduling">Scheduling</a></li>
    </ul>
  </aside>
  <main>
    <article>
      <h1>Configuration</h1>
      <p>The daemon reads <code>config.yaml</code> from the state directory. Every key is optional; unset keys fall back to the defaults listed below.</p>
      <h2 id="location">File location</h2>
      <p>Set <code>NIBBI_STATE_DIR</code> to move the state directory. See <a href="/docs/getting-started#state-dir">the state directory guide</a> for details.</p>
      <pre><code>daemon:
  port: 7480
  bind: 127.0.0.1
providers:
  - name: claude
    model: claude-opus-4</code></pre>
      <h2 id="keys">Keys</h2>
      <table>
        <tr><th>key</th><th>default</th><th>notes</th></tr>
        <tr><td>daemon.port</td><td>7480</td><td>HTTP &amp; SSE listener</td></tr>
        <tr><td>daemon.bind</td><td>127.0.0.1</td><td>use 0.0.0.0 to expose on the LAN</td></tr>
      </table>
      <blockquote><p>Changing <code>bind</code> without auth enabled is unsafe &mdash; see <a href="/docs/security">Security</a>.</p></blockquote>
      <figure><img src="/img/config.png" alt="config diagram"><figcaption>Where the file lives</figcaption></figure>
    </article>
  </main>
  <footer><p>&copy; 2026 Example &middot; <a href="/privacy">Privacy</a></p></footer>
  <script type="module">import { hydrate } from '/assets/app.js'; hydrate(document.querySelector('article'));</script>
</body>
</html>`;

test('realistic docs page: article body is extracted, nav script and styles are not', () => {
  assert.ok(DOCS_PAGE.length > 2000 && DOCS_PAGE.length < 4000, `fixture is ${DOCS_PAGE.length} chars`);
  const result = htmlToText(DOCS_PAGE, { baseUrl: 'https://docs.example.com/docs/configuration' });
  assert.equal(result.title, 'Configuration · Nibbi Daemon Docs');
  assert.equal(result.truncated, false);
  const { text } = result;
  assert.ok(text.includes('# Configuration\n\nThe daemon reads config.yaml from the state directory.'));
  assert.ok(text.includes('## File location'));
  assert.ok(text.includes('See [the state directory guide](https://docs.example.com/docs/getting-started#state-dir) for details.'));
  assert.ok(text.includes('daemon:\n  port: 7480\n  bind: 127.0.0.1\nproviders:\n  - name: claude\n    model: claude-opus-4'));
  assert.ok(text.includes('key default notes\ndaemon.port 7480 HTTP & SSE listener'));
  assert.ok(text.includes('Changing bind without auth enabled is unsafe — see [Security](https://docs.example.com/docs/security).'));
  assert.ok(text.includes('Where the file lives'));
  assert.ok(text.includes('© 2026 Example · [Privacy](https://docs.example.com/privacy)'));
  assert.ok(text.includes('- [Docs](https://docs.example.com/docs/)\n- [API](https://docs.example.com/docs/api/)'));
  for (const leaked of ['NAV_TRACK', 'dataLayer', 'analytics.example', 'ANALYTICS_SITE_ID', 'hydrate', '.sidebar', '#05d371', 'width=device-width', 'aria-current'])
    assert.ok(!text.includes(leaked), `leaked: ${leaked}`);
  assert.ok(!text.includes('\n\n\n'));
  const hrefs = result.links.map(link => link.href);
  assert.ok(hrefs.includes('https://github.com/example/nibbi'));
  assert.ok(hrefs.includes('https://docs.example.com/docs/security'));
  assert.ok(!hrefs.includes('https://docs.example.com/'), 'image-only logo link has no text and is not collected');
  assert.equal(new Set(hrefs).size, hrefs.length);
});
