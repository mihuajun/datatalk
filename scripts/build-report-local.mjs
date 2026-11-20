import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await build({entryPoints:[path.join(root,'scripts/studio-report-local.ts')],outfile:path.join(root,'public/studio-runtime/studio-report-local.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',minify:false,logLevel:'info',define:{'import.meta.url':'"file:///__bundled_helper_not_entry__.mjs"'},tsconfig:path.join(root,'tsconfig.json')});
