import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Same-origin, pinned assets. No user images or recognition output are written here.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'public/onboarding-ocr/v1');
fs.mkdirSync(target, { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules/tesseract.js/dist/worker.min.js'), path.join(target, 'worker.min.js'));
const core = path.join(root, 'node_modules/tesseract.js-core');
for (const file of fs.readdirSync(core).filter(name => name.endsWith('.wasm.js'))) {
  fs.copyFileSync(path.join(core, file), path.join(target, file));
}
for (const lang of ['kor', 'eng']) {
  fs.copyFileSync(path.join(root, `node_modules/@tesseract.js-data/${lang}/4.0.0/${lang}.traineddata.gz`), path.join(target, `${lang}.traineddata.gz`));
}
console.log('Local balance OCR assets prepared (worker, WASM, Korean/English models).');
