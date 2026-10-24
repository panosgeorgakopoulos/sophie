import { describe,it,expect,vi,afterEach } from 'vitest';
import { zipSync,strToU8 } from 'fflate';
import ExcelJS from 'exceljs';
import { parseDocument,pdfQualityIssues,validateArchive } from './parsers';
const docx=(xml:string)=>Buffer.from(zipSync({'[Content_Types].xml':strToU8('<Types/>'),'word/document.xml':strToU8(xml)}));
const pdf=Buffer.from('%PDF-1.7 fake fixture, mocked parser');
const longText='Institut français de Grèce. Informations vérifiées pour les candidats et les inscriptions aux examens. Contact examens@example.invalid';
afterEach(()=>vi.unstubAllEnvs());
describe('parser quality and isolation',()=>{
 it('requires an OS-isolated parser with a pinned image in production',async()=>{
  vi.stubEnv('NODE_ENV','production');vi.stubEnv('PARSER_CONTAINER_IMAGE','');
  await expect(parseDocument(pdf,'pdf')).rejects.toThrow('isolated parser container');
  vi.stubEnv('PARSER_CONTAINER_IMAGE','node:latest');
  await expect(parseDocument(pdf,'pdf')).rejects.toThrow('pinned image digest');
 });
 it('quarantines empty and low-text PDF pages instead of publishing empty replacement',()=>{
  expect(pdfQualityIssues([{num:1,text:''},{num:2,text:'Only eleven words here'}])).toHaveLength(2);
 });
 it('preserves PDF page and table row provenance with the extracted header context',async()=>{
  const document=await parseDocument(pdf,'pdf',{worker:async()=>({title:'Examens',pages:[{num:1,text:longText}],tables:[{num:1,tables:[[['Diplôme','Prix EUR'],['B2','100']]]}]})});
  expect(document.issues).toEqual([]);
  expect(document.blocks.find(block=>block.row===2)).toMatchObject({kind:'table_row',page:1,table:'page-1-table-1'});
  expect(document.blocks.find(block=>block.row===2)?.text).toContain('Diplôme | Prix EUR');
 });
 it('rejects unresolved PDF column layout',async()=>{
  const document=await parseDocument(pdf,'pdf',{worker:async()=>({title:'Table',pages:[{num:1,text:`${longText}\nDELF\t100\nDALF\t120\nTCF\t90`}],tables:[]})});
  expect(document.issues.some(issue=>issue.includes('unresolved columns'))).toBe(true);
 });
 it('OCR requires human verification even above confidence threshold',async()=>{
  const ocr=vi.fn(async()=>[{page:1,text:longText,confidence:0.99}]);
  const document=await parseDocument(pdf,'pdf',{worker:async()=>({title:'Scan',pages:[{num:1,text:''}],tables:[]}),ocr});
  expect(ocr).toHaveBeenCalledWith(pdf,[1],['ell','fra']);
  expect(document.issues).toEqual(['OCR output requires human verification before publication']);
 });
 it('rejects archive bomb metadata before invoking parser',async()=>{
  const bytes=docx('<document/>');const directory=bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));bytes.writeUInt32LE(50*1024*1024,directory+24);
  const worker=vi.fn();await expect(parseDocument(bytes,'docx',{worker})).rejects.toThrow('decompression');expect(worker).not.toHaveBeenCalled();
 });
 it('rejects macro/path traversal archives',()=>{
  expect(()=>validateArchive(Buffer.from(zipSync({'../bad.xml':strToU8('evil')})))).toThrow('forbidden');
  expect(()=>validateArchive(Buffer.from(zipSync({'xl/vbaProject.bin':strToU8('macro')})))).toThrow('forbidden');
 });
 it('isolated DOCX parser preserves Greek/French headings and tables without network or app credentials',async()=>{
  const xml='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Εξετάσεις / Examens</w:t></w:r></w:p><w:p><w:r><w:t>examens@example.invalid</w:t></w:r></w:p><w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p><w:r><w:t>Diplôme</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>EUR</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>100</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
  const document=await parseDocument(docx(xml),'docx',{title:'Review fixture'});
  expect(document.issues).toEqual([]);expect(document.blocks[0].headingPath).toEqual(['Εξετάσεις / Examens']);expect(document.blocks[1].text).toBe('Diplôme: B2 | EUR: 100');
 },15000);
 it('isolated DOCX parser rejects external entity declarations',async()=>{
  const xml='<!DOCTYPE document [<!ENTITY secret SYSTEM "file:///etc/passwd">]><w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>&secret;</w:t></w:r></w:p></w:body></w:document>';
  await expect(parseDocument(docx(xml),'docx')).rejects.toThrow('Isolated parser failed');
 },15000);
 it('isolated XLSX parser retains merged row context and rejects formulas',async()=>{
  const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('Examens');
  sheet.addRow(['Diplôme','EUR']);sheet.addRow(['B2','100']);sheet.mergeCells('A3:B3');sheet.getCell('A3').value='Contact examens@example.invalid';
  const document=await parseDocument(Buffer.from(await workbook.xlsx.writeBuffer()),'xlsx');
  expect(document.issues).toEqual([]);expect(document.blocks.some(b=>b.text.includes('B2')&&b.text.includes('100'))).toBe(true);
  expect(document.blocks.some(b=>b.text.includes('merged from A3'))).toBe(true);
  sheet.getCell('C1').value={formula:'1+1',result:2};
  await expect(parseDocument(Buffer.from(await workbook.xlsx.writeBuffer()),'xlsx')).rejects.toThrow('Isolated parser failed');
 },15000);
 it('parses a real PDF fixture in the restricted worker',async()=>{
  const stream='BT /F1 12 Tf 40 740 Td (Institut francais de Grece. Exam department verified information for all candidates.) Tj 0 -20 Td (Contact: examens@example.invalid for registration details and examination schedules.) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let text='%PDF-1.4\n';const offsets=[0];
  for(const [index,object] of objects.entries()){offsets.push(Buffer.byteLength(text));text+=`${index+1} 0 obj\n${object}\nendobj\n`;}
  const xref=Buffer.byteLength(text);text+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n `).join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const document=await parseDocument(Buffer.from(text),'pdf');
  expect(document.issues).toEqual([]);expect(document.blocks.some(b=>b.page===1&&b.text.includes('examens@example.invalid'))).toBe(true);
 },15000);
});
