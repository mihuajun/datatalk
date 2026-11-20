import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { composeWebReportSrcDoc, inlineWebReportScriptAssets } from '@/lib/report-web';
import { readWebFiles } from '@/lib/server/report-web-assets';

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'datatalk-script-assets-'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const asset = 'assets/generated/test.png';
  const url = `data:image/png;base64,${png.toString('base64')}`;
  const script = [
    'document.body.innerHTML += `<img src="datatalk-asset://assets/generated/test.png">`;',
    'document.body.innerHTML += "<img src=assets/generated/test.png>";',
    'const img = new Image(); img.src = `./assets/generated/test.png?v=2`; document.body.append(img);',
    'setTimeout(() => { const i = new Image(); i.setAttribute("src", "/assets/generated/test.png"); document.body.append(i); }, 10);',
    'const hero = document.createElement("div"); hero.style.backgroundImage = \'url("assets/generated/test.png")\'; document.body.append(hero);',
  ].join('\n');
  try {
    await fs.mkdir(path.join(root, 'assets/generated'), { recursive: true });
    await fs.writeFile(path.join(root, asset), png);
    await fs.writeFile(path.join(root, 'page.html'), '<!doctype html><html><head></head><body></body></html>');
    await fs.writeFile(path.join(root, 'app.js'), script);
    const files = await readWebFiles(root);
    assert.equal(files.assets?.[asset], url, 'JS-only references must be loaded from the report workspace');
    const rewritten = inlineWebReportScriptAssets(script, files.assets);
    new Function(rewritten);
    assert.equal(rewritten.split(url).length - 1, 5);
    assert.doesNotMatch(rewritten, /datatalk-asset:\/\//);
    assert.equal(inlineWebReportScriptAssets('const u="https://example.com/assets/generated/test.png";', files.assets), 'const u="https://example.com/assets/generated/test.png";');
    assert.equal(inlineWebReportScriptAssets('const u="assets/missing.png";', files.assets), 'const u="assets/missing.png";');
    await fs.symlink('/etc/hosts', path.join(root, 'assets/generated/escape.png'));
    await fs.appendFile(path.join(root, 'app.js'), '\nconst escape="assets/generated/escape.png";');
    assert.equal((await readWebFiles(root)).assets?.['assets/generated/escape.png'], undefined, 'symlinks must not escape report root');
    const srcdoc = composeWebReportSrcDoc(files).replace('</body>', `<script>setTimeout(async()=>{await Promise.all(Array.from(document.images).map(i=>i.decode().catch(()=>{})));parent.postMessage({test:true,loaded:Array.from(document.images).filter(i=>i.naturalWidth>0).length,total:document.images.length,csp:document.querySelector('meta[http-equiv]').content},'*');},100);</script></body>`);
    const escaped = srcdoc.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
    const output = process.env.ASSET_BROWSER_FIXTURE;
    if (output) await fs.writeFile(output, `<html><body><pre id="result">pending</pre><script>addEventListener('message',e=>{if(e.data.test)document.querySelector('#result').textContent=JSON.stringify(e.data)})</script><iframe sandbox="allow-scripts" srcdoc="${escaped}"></iframe></body></html>`);
    console.log('PASS: JS-only discovery, template HTML, unquoted HTML, img.src, setAttribute, delayed creation, CSS strings, external URL preservation, missing files, symlink isolation');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
