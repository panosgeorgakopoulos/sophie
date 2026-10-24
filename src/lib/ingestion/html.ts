import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import type { StructuredBlock } from '../chunking';
import type { ParsedDocument } from './types';

const clean = (text: string) => text.replace(/[\t \u00a0]+/gu, ' ').replace(/ *\n */gu, '\n').trim();
export const containsContact = (text: string) => /[\w.+-]+@[\w.-]+\.[\p{L}]{2,}|(?:\+\d[\d ()-]{7,}\d)|(?:\b210[\d ()-]{6,})/u.test(text);
export function decodeCloudflareEmail(value: string): string | undefined {
  if (!/^(?:[0-9a-f]{2}){3,320}$/i.test(value)) return undefined;
  const bytes = Buffer.from(value, 'hex');
  const decoded = Buffer.from([...bytes.subarray(1)].map((byte) => byte ^ bytes[0])).toString('utf8');
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/u.test(decoded) ? decoded : undefined;
}
export interface ExtractedHtml extends ParsedDocument { links: string[]; dynamicTargets: string[] }
export function extractHtml(html: string, fallbackTitle: string): ExtractedHtml {
  const $ = cheerio.load(html);
  const title = clean($('title').first().text() || $('h1').first().text() || fallbackTitle);
  const language = $('html').attr('lang')?.split('-')[0];
  const issues: string[] = [];
  const links = new Set<string>();
  $('a[href], link[rel="alternate"][href]').each((_, el) => {
    const link = $(el).attr('href');
    if (link) links.add(link);
  });
  const dynamicTargets: string[] = [];
  $('[data-src], [data-url], [data-ajax-url]').each((_, el) => {
    if (!$(el).is('[role="tab"], [role="tabpanel"], .tab-pane, .tab-content, .accordion-body')) return;
    const link = $(el).attr('data-src') || $(el).attr('data-url') || $(el).attr('data-ajax-url');
    if (link) { links.add(link); dynamicTargets.push(link); }
  });
  $('[role="tab"][aria-controls], a[data-toggle="tab"], a[data-bs-toggle="tab"]').each((_, el) => {
    const target = $(el).attr('aria-controls') || $(el).attr('href')?.replace(/^#/, '');
    const panel = target ? $('[id]').filter((_, candidate) => $(candidate).attr('id') === target).first() : undefined;
    if (!panel?.length || !clean(panel.text())) issues.push('Unresolved dynamic tab content requires reviewed rendering');
  });
  $('[data-cfemail]').each((_, el) => {
    const email = decodeCloudflareEmail($(el).attr('data-cfemail') ?? '');
    if (email) $(el).text(email);
    else issues.push('Invalid Cloudflare email encoding');
  });
  $('a[href]').each((_, el) => {
    const raw = $(el).attr('href') ?? '';
    const encoded = /\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/i.exec(raw)?.[1];
    let contact = encoded ? decodeCloudflareEmail(encoded) : undefined;
    if (/^(mailto:|tel:)/i.test(raw)) {
      try { contact = decodeURIComponent(raw.replace(/^(mailto:|tel:)/i, '').split('?')[0]); }
      catch { issues.push('Invalid encoded contact link'); }
    }
    if (contact && !$(el).text().includes(contact)) $(el).append(` (${contact})`);
  });
  $('nav, header, footer, script, style, noscript, iframe, form, [role="navigation"]').remove();
  if (/\[email\s*protected\]/i.test($.text())) issues.push('Unresolved protected email requires review');
  const blocks: StructuredBlock[] = [];
  let headingPath: string[] = [];
  let currentTab: string | undefined;
  let tableIndex = 0;
  const push = (text: string, kind?: StructuredBlock['kind'], extra: Partial<StructuredBlock> = {}) => {
    const normalized = clean(text);
    if (!normalized) return;
    blocks.push({ text: normalized, kind: kind ?? (containsContact(normalized) ? 'contact' : 'paragraph'), headingPath: headingPath.filter(Boolean), ...(currentTab ? { tabId: currentTab } : {}), ...extra });
  };
  function table(el: Element) {
    const rows: string[][] = [];
    const headerRows: number[] = [];
    $(el).find('tr').each((index, tr) => {
      if (index >= 5000) throw new Error('HTML table row limit exceeded');
      rows[index] ??= [];
      let col = 0;
      $(tr).children('th,td').each((_, cell) => {
        while (rows[index][col] !== undefined) col++;
        const span = Number($(cell).attr('colspan') || 1);
        const down = Number($(cell).attr('rowspan') || 1);
        if (!Number.isInteger(span) || !Number.isInteger(down) || span < 1 || down < 1 || span > 100 || down > 100 || col + span > 200) throw new Error('Invalid or oversized HTML table span');
        const value = clean($(cell).text());
        for (let r = index; r < index + down; r++) {
          rows[r] ??= [];
          for (let c = col; c < col + span; c++) rows[r][c] = value;
        }
        col += span;
      });
      if ($(tr).children('th').length && !$(tr).children('td').length) headerRows.push(index);
    });
    const tableId = `table-${++tableIndex}`;
    const caption = clean($(el).children('caption').text());
    const headers: string[] = [];
    for (const row of headerRows) rows[row].forEach((cell, col) => { headers[col] = [headers[col], cell].filter(Boolean).join(' / '); });
    rows.forEach((row, index) => {
      if (headerRows.includes(index)) return;
      const serialized = row.map((value, col) => `${headers[col] || `Column ${col + 1}`}: ${value}`).join(' | ');
      push(`${caption ? `${caption}\n` : ''}${serialized}`, 'table_row', { table: tableId, row: index + 1 });
    });
  }
  const inline = (node: AnyNode) => node.type === 'text' || ('name' in node && /^(a|span|strong|em|b|i|u|small|sup|sub|br|code|abbr)$/i.test(node.name));
  function walk(node: AnyNode) {
    if (node.type === 'text') { push(node.data); return; }
    if (!('name' in node)) return;
    const el = node as Element;
    if (/^h[1-6]$/i.test(el.name)) {
      const level = Number(el.name[1]);
      headingPath = headingPath.slice(0, level - 1);
      headingPath[level - 1] = clean($(el).text());
      return;
    }
    if (el.name === 'table') { table(el); return; }
    if (['p', 'blockquote', 'pre'].includes(el.name) || (el.name === 'li' && !$(el).find('li,p,table').length)) { push($(el).text()); return; }
    const savedHeading = [...headingPath];
    const savedTab = currentTab;
    const panel = $(el).attr('role') === 'tabpanel' || $(el).is('.tab-pane, .accordion-body');
    if (panel) {
      currentTab = $(el).attr('id');
      const labelId = $(el).attr('aria-labelledby');
      const label = labelId ? $('[id]').filter((_, item) => $(item).attr('id') === labelId).first().text() : '';
      if (clean(label)) headingPath = [...headingPath, clean(label)];
      if (!clean($(el).text())) issues.push('Empty tab/accordion panel requires reviewed rendering');
    }
    let text = '';
    for (const child of el.children ?? []) {
      if (inline(child)) text += child.type === 'text' ? child.data : ($(child).is('br') ? '\n' : $(child).text());
      else { push(text); text = ''; walk(child); }
    }
    push(text);
    if (panel) { headingPath = savedHeading; currentTab = savedTab; }
  }
  const main = $('main').first();
  const article = $('article').first();
  const root = (main.length ? main : article.length ? article : $('body')).get(0);
  if (root) walk(root);
  if (!blocks.length) issues.push('Empty document extraction');
  return { title, language, blocks, links: [...links], dynamicTargets, issues: [...new Set(issues)] };
}

export function extractMarkdown(text: string, title: string): ParsedDocument {
  const blocks: StructuredBlock[] = [];
  let headings: string[] = [];
  let buffer: string[] = [];
  const flush = () => {
    const value = buffer.join('\n').trim();
    if (value) blocks.push({ text: value, kind: containsContact(value) ? 'contact' : 'paragraph', headingPath: headings.filter(Boolean) });
    buffer = [];
  };
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { flush(); headings = headings.slice(0, heading[1].length - 1); headings[heading[1].length - 1] = heading[2]; }
    else if (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] ?? '')) {
      flush();
      const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
      const headers = cells(line); index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        blocks.push({ kind: 'table_row', headingPath: headings.filter(Boolean), table: `table-line-${index}`, row: index + 1, text: cells(lines[index]).map((cell, col) => `${headers[col] || `Column ${col + 1}`}: ${cell}`).join(' | ') }); index++;
      }
      index--;
    } else if (!line.trim()) flush(); else buffer.push(line);
  }
  flush();
  return { title, blocks, issues: blocks.length ? [] : ['Empty document extraction'] };
}
