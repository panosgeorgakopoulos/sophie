// This process receives document bytes on stdin and no application credentials.
// Spawned with Node permissions: no network, child processes or writable files.
import { PDFParse } from 'pdf-parse';
import { unzipSync } from 'fflate';
import * as cheerio from 'cheerio';
import ExcelJS from 'exceljs';

const chunks = [];
let size = 0;
for await (const chunk of process.stdin) {
  size += chunk.length;
  if (size > 28 * 1024 * 1024) throw new Error('Parser input exceeds limit');
  chunks.push(chunk);
}
const { format, data } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const bytes = Buffer.from(data, 'base64');
if (bytes.length > 20 * 1024 * 1024) throw new Error('Document exceeds limit');
let result;
if (format === 'pdf') {
  const parser = new PDFParse({ data: bytes, isEvalSupported: false, useSystemFonts: false, disableFontFace: true });
  try {
    const info = await parser.getInfo();
    if (info.total < 1 || info.total > 100) throw new Error('PDF page limit exceeded');
    const text = await parser.getText({ parseHyperlinks: true, lineEnforce: true, cellSeparator: '\t', pageJoiner: '' });
    const tables = await parser.getTable();
    result = { title: info.info?.Title || '', pages: text.pages, tables: tables.pages };
  } finally { await parser.destroy(); }
} else if (format === 'docx') {
  const archive = unzipSync(bytes, { filter: (entry) => ['word/document.xml', 'word/styles.xml'].includes(entry.name) });
  const main = archive['word/document.xml'];
  if (!main) throw new Error('Missing DOCX document XML');
  const xml = Buffer.from(main).toString('utf8');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DOCX XML entities forbidden');
  const $ = cheerio.load(xml, { xmlMode: true });
  const warnings = [];
  if ($('w\\:drawing, w\\:object, w\\:altChunk, w\\:instrText, w\\:fldSimple, w\\:del, w\\:ins').length) warnings.push('error');
  $('w\\:del').remove();
  const escape = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const text = (el) => $(el).find('w\\:t, w\\:tab, w\\:br').map((_, node) => node.name === 'w:tab' ? ' | ' : node.name === 'w:br' ? '\n' : $(node).text()).get().join('');
  const paragraph = (el) => {
    const style = $(el).find('w\\:pStyle').attr('w:val') || '';
    const heading = /^(?:Heading|Titre)([1-6])$/i.exec(style);
    const tag = heading ? `h${heading[1]}` : 'p';
    return `<${tag}>${escape(text(el))}</${tag}>`;
  };
  let html = '';
  $('w\\:body').children().each((_, el) => {
    if (el.name === 'w:p') html += paragraph(el);
    else if (el.name === 'w:tbl') {
      html += '<table>';
      $(el).children('w\\:tr').each((_, row) => {
        html += '<tr>';
        const header = $(row).find('w\\:tblHeader').length > 0;
        $(row).children('w\\:tc').each((_, cell) => {
          const span = Number($(cell).find('w\\:gridSpan').first().attr('w:val') || 1);
          if (span < 1 || span > 100 || !Number.isInteger(span)) throw new Error('DOCX column span invalid');
          if ($(cell).find('w\\:vMerge').length) warnings.push('error');
          const tag = header ? 'th' : 'td';
          const content = $(cell).children('w\\:p').map((_, p) => text(p)).get().join('\n');
          html += `<${tag} colspan="${span}">${escape(content)}</${tag}>`;
        });
        html += '</tr>';
      });
      html += '</table>';
    }
  });
  result = { html, warnings };
} else if (format === 'xlsx') {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const sheets = [];
  if (workbook.worksheets.length > 50) throw new Error('Workbook sheet limit exceeded');
  let totalCells = 0;
  for (const sheet of workbook.worksheets) {
    if (sheet.state !== 'visible') continue;
    if (sheet.rowCount > 10000 || sheet.columnCount > 200) throw new Error('Worksheet dimensions exceed limit');
    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row, index) => {
      const cells = [];
      for (let column = 1; column <= sheet.columnCount; column++) {
        if (++totalCells > 100000) throw new Error('Workbook cell limit exceeded');
        const cell = row.getCell(column);
        // ExcelJS never executes formulas. Cached results can be stale, so formulas
        // require a reviewed static export rather than silently becoming evidence.
        if (cell.type === ExcelJS.ValueType.Formula) throw new Error('Formula cells require a reviewed values-only export');
        cells.push({ column, text: cell.text, merged: cell.isMerged, master: cell.isMerged ? cell.master.address : null });
      }
      rows.push({ index, cells });
    });
    sheets.push({ name: sheet.name, rows });
  }
  result = { sheets };
} else throw new Error('Unsupported parser format');
process.stdout.write(JSON.stringify(result));
