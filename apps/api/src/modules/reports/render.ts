/** Renders a ReportModel as an e-mail-safe HTML page and as an A4 PDF (pdfkit, pure JS). */
import PDFDocument from 'pdfkit';
import type { ReportModel, Section, Table } from './model';

const C = {
  text: '#1b2430',
  muted: '#6b7686',
  border: '#e2e6ec',
  surface: '#ffffff',
  page: '#f4f6f9',
  bar: '#2a78d6', // --series-1 (validated palette); one series, so no legend
  track: '#eef1f5',
  good: '#1f7a3f',
  bad: '#b42318',
};

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/**
 * Bars as table cells: e-mail clients (Gmail, Outlook) drop inline SVG, so the bar is a
 * coloured cell whose width is the value's share of the largest value.
 */
function htmlBars(bars: NonNullable<Section['bars']>) {
  const max = Math.max(...bars.map((b) => b.value), 0) || 1;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0 12px">${bars
    .map((b) => {
      const w = Math.max(1, Math.round((b.value / max) * 100));
      return `<tr>
<td style="padding:3px 8px 3px 0;width:32%;font-size:12px;color:${C.text};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(b.label)}</td>
<td style="padding:3px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="${w}%" style="background:${C.bar};height:12px;border-radius:0 4px 4px 0;font-size:0;line-height:0">&nbsp;</td>
${w < 100 ? `<td width="${100 - w}%" style="font-size:0;line-height:0">&nbsp;</td>` : ''}</tr></table></td>
<td style="padding:3px 0 3px 8px;width:22%;font-size:12px;color:${C.muted};text-align:right;white-space:nowrap">${esc(b.display)}</td></tr>`;
    })
    .join('')}</table>`;
}

function htmlTable(t: Table) {
  const num = new Set(t.numeric ?? []);
  const th = t.columns.map((c, i) => `<th style="text-align:${num.has(i) ? 'right' : 'left'};padding:6px 8px;border-bottom:1px solid ${C.border};font-size:11px;color:${C.muted};font-weight:600">${esc(c)}</th>`).join('');
  const rows = t.rows
    .map((r) => `<tr>${r.map((v, i) => `<td style="text-align:${num.has(i) ? 'right' : 'left'};padding:5px 8px;border-bottom:1px solid ${C.border};font-size:12px;color:${C.text}">${esc(v ?? '—')}</td>`).join('')}</tr>`)
    .join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0 12px"><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table>`;
}

export function renderHtml(m: ReportModel, links: { app: string; manage?: string }): string {
  const kpis = m.kpis
    .map(
      (k) => `<td style="width:50%;padding:8px 10px;border:1px solid ${C.border};vertical-align:top">
<div style="font-size:11px;color:${C.muted}">${esc(k.label)}</div>
<div style="font-size:18px;font-weight:600;color:${C.text};margin-top:2px">${esc(k.value)}</div>
${k.change ? `<div style="font-size:11px;color:${k.change.good == null ? C.muted : k.change.good ? C.good : C.bad}">${k.change.text.startsWith('+') ? '▲ ' : k.change.text.startsWith('-') ? '▼ ' : ''}${esc(k.change.text)}</div>` : ''}</td>`,
    )
    .reduce<string[]>((rows, cell, i) => (i % 2 ? (rows[rows.length - 1] += cell) : rows.push(cell), rows), [])
    .map((r) => `<tr>${r}</tr>`)
    .join('');
  const sections = m.sections
    .map((s) => {
      const has = (s.bars?.length ?? 0) > 0 || (s.table?.rows.length ?? 0) > 0;
      return `<h2 style="font-size:14px;color:${C.text};margin:20px 0 6px">${esc(s.title)}</h2>${
        has ? `${s.bars?.length ? htmlBars(s.bars) : ''}${s.table?.rows.length ? htmlTable(s.table) : ''}` : `<p style="font-size:12px;color:${C.muted}">${esc(s.empty ?? 'No data.')}</p>`
      }`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(m.title)} · ${esc(m.periodLabel)}</title></head>
<body style="margin:0;background:${C.page};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:${C.surface};border:1px solid ${C.border};border-radius:8px">
<tr><td style="padding:20px 20px 8px">
<div style="font-size:12px;color:${C.muted}">${esc(m.company)} · ${esc(m.scope)}</div>
<h1 style="font-size:20px;color:${C.text};margin:4px 0 2px">${esc(m.title)}</h1>
<div style="font-size:13px;color:${C.muted}">${esc(m.periodLabel)}</div>
</td></tr>
<tr><td style="padding:8px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${kpis}</table></td></tr>
<tr><td style="padding:0 20px 8px">${sections}
${m.notes.map((n) => `<p style="font-size:11px;color:${C.muted};margin:6px 0">${esc(n)}</p>`).join('')}
<p style="font-size:12px;margin:16px 0 8px"><a href="${esc(links.app)}" style="color:${C.bar}">Open Fleet Management</a>${links.manage ? ` · <a href="${esc(links.manage)}" style="color:${C.bar}">Report subscriptions</a>` : ''}</p>
<p style="font-size:11px;color:${C.muted}">The PDF and CSV files attached hold the same figures.</p>
</td></tr></table></td></tr></table></body></html>`;
}

/** Plain-text alternative for e-mail. */
export function renderText(m: ReportModel): string {
  return [`${m.title} — ${m.periodLabel}`, `${m.company} · ${m.scope}`, '', ...m.kpis.map((k) => `${k.label}: ${k.value}${k.change ? ` (${k.change.text})` : ''}`), '', ...m.notes].join('\n');
}

/** Helvetica covers Latin text; other scripts are replaced so the PDF never breaks. */
const latin = (s: unknown) => String(s ?? '—').replace(/[^ -ÿ–—‘’“”•€▲▼]/g, '?');

export function renderPdf(m: ReportModel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `${m.title} ${m.periodLabel}`, Author: 'Fleet Management' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const W = doc.page.width - 80;
    const left = 40;
    const bottom = () => doc.page.height - 50;
    const room = (h: number) => {
      if (doc.y + h > bottom()) doc.addPage();
    };

    doc.fillColor(C.muted).fontSize(9).text(latin(`${m.company} · ${m.scope}`), left, 40);
    doc.fillColor(C.text).font('Helvetica-Bold').fontSize(18).text(latin(m.title));
    doc.font('Helvetica').fillColor(C.muted).fontSize(11).text(latin(m.periodLabel));
    doc.moveDown(0.8);

    // KPI grid, two columns
    const colW = W / 2;
    for (let i = 0; i < m.kpis.length; i += 2) {
      room(46);
      const y = doc.y;
      for (const [j, k] of m.kpis.slice(i, i + 2).entries()) {
        const x = left + j * colW;
        doc.rect(x, y, colW - 6, 40).strokeColor(C.border).lineWidth(0.8).stroke();
        doc.fillColor(C.muted).fontSize(8).text(latin(k.label), x + 8, y + 6, { width: colW - 22 });
        doc.fillColor(C.text).font('Helvetica-Bold').fontSize(12).text(latin(k.value), x + 8, y + 16, { width: colW - 22 });
        doc.font('Helvetica');
        if (k.change) doc.fillColor(k.change.good == null ? C.muted : k.change.good ? C.good : C.bad).fontSize(7.5).text(latin(k.change.text), x + 8, y + 30, { width: colW - 22 });
      }
      doc.y = y + 46;
    }

    for (const s of m.sections) {
      room(60);
      doc.x = left;
      doc.moveDown(0.6);
      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(12).text(latin(s.title), left);
      doc.font('Helvetica').moveDown(0.3);
      const has = (s.bars?.length ?? 0) > 0 || (s.table?.rows.length ?? 0) > 0;
      if (!has) {
        doc.fillColor(C.muted).fontSize(9).text(latin(s.empty ?? 'No data.'), left);
        continue;
      }
      if (s.bars?.length) {
        const max = Math.max(...s.bars.map((b) => b.value), 0) || 1;
        const labelW = W * 0.3;
        const valueW = W * 0.2;
        const barW = W - labelW - valueW - 12;
        for (const b of s.bars) {
          room(16);
          const y = doc.y;
          doc.fillColor(C.text).fontSize(8.5).text(latin(b.label), left, y + 1, { width: labelW - 6, lineBreak: false, ellipsis: true });
          const w = Math.max(1, (b.value / max) * barW);
          doc.roundedRect(left + labelW, y + 1, w, 9, 2).fill(C.bar);
          doc.fillColor(C.muted).fontSize(8.5).text(latin(b.display), left + labelW + barW + 6, y + 1, { width: valueW, align: 'right', lineBreak: false });
          doc.y = y + 15;
        }
        doc.moveDown(0.4);
      }
      if (s.table?.rows.length) {
        const t = s.table;
        const num = new Set(t.numeric ?? []);
        const cw = W / t.columns.length;
        const row = (cells: unknown[], head: boolean) => {
          room(16);
          const y = doc.y;
          cells.forEach((v, i) =>
            doc
              .fillColor(head ? C.muted : C.text)
              .font(head ? 'Helvetica-Bold' : 'Helvetica')
              .fontSize(7.5)
              .text(latin(v), left + i * cw + 2, y + 3, { width: cw - 4, align: num.has(i) ? 'right' : 'left', lineBreak: false, ellipsis: true }),
          );
          doc.moveTo(left, y + 14).lineTo(left + W, y + 14).strokeColor(C.border).lineWidth(0.5).stroke();
          doc.y = y + 15;
        };
        row(t.columns, true);
        for (const r of t.rows) row(r, false);
        doc.font('Helvetica');
      }
    }
    doc.moveDown(0.8);
    for (const n of m.notes) {
      room(24);
      doc.fillColor(C.muted).fontSize(8).text(latin(n), left, doc.y, { width: W });
    }
    doc.end();
  });
}
