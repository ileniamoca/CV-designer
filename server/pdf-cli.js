// Usage: npm run pdf -- documents/originals/MyCV.html [output.pdf]
import fs from 'node:fs';
import path from 'node:path';
import { htmlToPdf } from './pdf.js';

const [input, output] = process.argv.slice(2);
if (!input) {
  console.error('Usage: npm run pdf -- <file.html> [output.pdf]');
  process.exit(1);
}
const out = output ?? path.join('documents/pdf', path.basename(input, '.html') + '.pdf');
await htmlToPdf(fs.readFileSync(input, 'utf8'), out);
console.log('PDF created:', out);
