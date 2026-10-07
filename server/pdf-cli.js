// Uso: npm run pdf -- documentos/originales/MiCV.html [salida.pdf]
import fs from 'node:fs';
import path from 'node:path';
import { htmlToPdf } from './pdf.js';

const [input, output] = process.argv.slice(2);
if (!input) {
  console.error('Uso: npm run pdf -- <archivo.html> [salida.pdf]');
  process.exit(1);
}
const out = output ?? path.join('documentos/pdf', path.basename(input, '.html') + '.pdf');
await htmlToPdf(fs.readFileSync(input, 'utf8'), out);
console.log('PDF creado:', out);
