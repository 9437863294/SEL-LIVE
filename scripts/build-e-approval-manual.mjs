/**
 * Renders `src/lib/e-approval-manual.ts` into a real Word document.
 *
 *   node scripts/build-e-approval-manual.mjs
 *
 * Writes `docs/E-Approval-Manual.docx` (to keep with the other docs) and
 * `public/docs/E-Approval-Manual.docx` (so the Guide page can hand it to a user).
 *
 * Why hand-rolled OOXML rather than a docx library: a .docx is a zip of XML parts, jszip is already
 * in the tree, and adding a dependency to a repo for one build script is a cost paid on every
 * install thereafter. The parts below are the minimum Word will open — content types, the package
 * relationships, styles, a footer, and the document body.
 *
 * The content itself lives in the TypeScript module, not here. This file knows about WordprocessingML;
 * it knows nothing about approvals. Node strips the types on import, so there is no build step.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { E_APPROVAL_MANUAL, E_APPROVAL_MANUAL_META } from '../src/lib/e-approval-manual.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ── page geometry ────────────────────────────────────────────────────────────────────────────
 * A4 in twips (1/20 pt), 2cm margins. Everything that needs a width is derived from these two so
 * a table can never be laid out wider than the page it sits on.
 * ─────────────────────────────────────────────────────────────────────────────────────────── */
const PAGE_WIDTH = 11906;
const PAGE_MARGIN = 1134;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R_NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** XML text escaping. Curly quotes and dashes pass through fine; the five reserved characters do not. */
const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** A run. `xml:space="preserve"` because leading and trailing spaces are meaningful in labels. */
const run = (text, { bold, italic, color, size, font } = {}) => {
  const props = [
    font ? `<w:rFonts w:ascii="${font}" w:hAnsi="${font}"/>` : '',
    bold ? '<w:b/>' : '',
    italic ? '<w:i/>' : '',
    color ? `<w:color w:val="${color}"/>` : '',
    size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : '',
  ].join('');
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
};

/**
 * A paragraph.
 *
 * `indent` and `hanging` are what make the manually-numbered lists below line up: the number sits in
 * the hanging space and wrapped text aligns under the first character rather than under the number.
 */
const para = (
  runs,
  { style, spacingBefore, spacingAfter, indent, hanging, shading, border, align, keepNext } = {},
) => {
  // Order matters. CT_PPr is a sequence, not a choice — Word rejects or silently repairs a paragraph
  // whose properties arrive out of schema order, so this list follows it exactly:
  // pStyle → keepNext → pBdr → shd → spacing → ind → jc.
  const props = [
    style ? `<w:pStyle w:val="${style}"/>` : '',
    keepNext ? '<w:keepNext/>' : '',
    border
      ? `<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="${border}"/></w:pBdr>`
      : '',
    shading ? `<w:shd w:val="clear" w:color="auto" w:fill="${shading}"/>` : '',
    spacingBefore != null || spacingAfter != null
      ? `<w:spacing${spacingBefore != null ? ` w:before="${spacingBefore}"` : ''}${
          spacingAfter != null ? ` w:after="${spacingAfter}"` : ''
        }/>`
      : '',
    indent != null || hanging != null
      ? `<w:ind${indent != null ? ` w:left="${indent}"` : ''}${hanging != null ? ` w:hanging="${hanging}"` : ''}/>`
      : '',
    align ? `<w:jc w:val="${align}"/>` : '',
  ].join('');
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${Array.isArray(runs) ? runs.join('') : runs}</w:p>`;
};

/**
 * Column widths for an n-column table.
 *
 * The first column of every table in this handbook is a label — a status, an action, a term — and the
 * rest is prose about it. Giving them equal shares wraps every label onto two lines and leaves the
 * prose column short, so the label column gets a fixed, narrower allocation.
 */
const gridFor = (columns) => {
  if (columns === 2) return [Math.round(CONTENT_WIDTH * 0.3), Math.round(CONTENT_WIDTH * 0.7)];
  if (columns === 3) {
    const first = Math.round(CONTENT_WIDTH * 0.24);
    const rest = Math.round((CONTENT_WIDTH - first) / 2);
    return [first, rest, rest];
  }
  const even = Math.round(CONTENT_WIDTH / columns);
  return Array.from({ length: columns }, () => even);
};

const cell = (content, width, { fill } = {}) =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${
    fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''
  }<w:vAlign w:val="top"/></w:tcPr>${content}</w:tc>`;

const buildTable = (headers, rows) => {
  const columns = headers.length;
  const grid = gridFor(columns);

  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((edge) => `<w:${edge} w:val="single" w:sz="4" w:space="0" w:color="D4D9E2"/>`)
    .join('');

  const headerRow = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${headers
    .map((header, index) =>
      cell(
        para(run(header, { bold: true, size: 18, color: '1F2937' }), { spacingBefore: 40, spacingAfter: 40 }),
        grid[index],
        { fill: 'EEF2F7' },
      ),
    )
    .join('')}</w:tr>`;

  const bodyRows = rows
    .map(
      (row) =>
        `<w:tr>${row
          .map((value, index) =>
            cell(
              para(run(value, { size: 19, bold: index === 0 }), { spacingBefore: 40, spacingAfter: 40 }),
              grid[index] ?? grid[grid.length - 1],
            ),
          )
          .join('')}</w:tr>`,
    )
    .join('');

  return (
    '<w:tbl>' +
    `<w:tblPr><w:tblW w:w="${CONTENT_WIDTH}" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders>` +
    '<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="90" w:type="dxa"/>' +
    '<w:bottom w:w="60" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    `<w:tblGrid>${grid.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>` +
    headerRow +
    bodyRows +
    '</w:tbl>' +
    // Word merges two adjacent tables into one. An empty paragraph after each keeps them apart.
    para('', { spacingAfter: 120 })
  );
};

/* ── block rendering ──────────────────────────────────────────────────────────────────────────
 * Lists are numbered and bulleted by hand rather than through numbering.xml. A numbering definition
 * would give Word restartable, style-aware lists — but this manual has no nested or continued lists,
 * and the definition part costs more than it buys here.
 * ─────────────────────────────────────────────────────────────────────────────────────────── */
const renderBlock = (block) => {
  switch (block.kind) {
    case 'paragraph':
      return para(run(block.text), { spacingAfter: 120 });

    case 'note':
      return para([run('Note   ', { bold: true, color: '0369A1' }), run(block.text, { color: '0C4A6E' })], {
        shading: 'F0F9FF',
        border: '38BDF8',
        indent: 170,
        spacingBefore: 80,
        spacingAfter: 140,
      });

    case 'warning':
      return para([run('Important   ', { bold: true, color: 'B45309' }), run(block.text, { color: '7C2D12' })], {
        shading: 'FFFBEB',
        border: 'F59E0B',
        indent: 170,
        spacingBefore: 80,
        spacingAfter: 140,
      });

    case 'steps':
      return (block.items ?? [])
        .map((item, index) =>
          para([run(`${index + 1}.`, { bold: true }), run(`  ${item}`)], {
            indent: 400,
            hanging: 280,
            spacingAfter: 60,
          }),
        )
        .join('') + para('', { spacingAfter: 60 });

    case 'bullets':
      return (block.items ?? [])
        .map((item) =>
          para([run('•', { bold: true }), run(`  ${item}`)], {
            indent: 400,
            hanging: 280,
            spacingAfter: 60,
          }),
        )
        .join('') + para('', { spacingAfter: 60 });

    case 'table':
      return buildTable(block.headers ?? [], block.rows ?? []);

    default:
      return '';
  }
};

const AUDIENCE_LABEL = {
  everyone: 'Everyone',
  approver: 'Approvers',
  administrator: 'Administrators',
};

const renderSection = (section) => {
  const heading = para(
    [run(`${section.number}   `, { color: '64748B' }), run(section.title)],
    { style: 'Heading2', spacingBefore: 280, spacingAfter: 60, keepNext: true },
  );

  const strap = para(
    [
      run(section.summary, { italic: true, color: '475569', size: 19 }),
      section.route ? run(`   ·   ${section.route}`, { color: '94A3B8', size: 18, font: 'Consolas' }) : '',
    ].filter(Boolean),
    { spacingAfter: 140, keepNext: true },
  );

  return heading + strap + section.blocks.map(renderBlock).join('');
};

const renderPart = (part) =>
  para(run(part.title), { style: 'Heading1', spacingBefore: 400, spacingAfter: 80, keepNext: true }) +
  para([run(part.intro, { color: '475569' }), run(`   (${AUDIENCE_LABEL[part.audience]})`, { color: '94A3B8' })], {
    spacingAfter: 200,
  }) +
  part.sections.map(renderSection).join('');

/**
 * Cover and contents.
 *
 * A static contents list rather than a TOC field: a field renders as "No table of contents entries
 * found" until the reader presses F9, and a manual that looks broken on first open is a manual
 * nobody reads past page two.
 */
const buildFrontMatter = () => {
  const cover =
    para('', { spacingBefore: 1200 }) +
    para(run(E_APPROVAL_MANUAL_META.organisation.toUpperCase(), { color: '64748B', size: 20 }), {
      align: 'center',
      spacingAfter: 120,
    }) +
    para(run(E_APPROVAL_MANUAL_META.title), { style: 'Title', align: 'center', spacingAfter: 120 }) +
    para(run(E_APPROVAL_MANUAL_META.subtitle, { color: '475569', size: 24 }), {
      align: 'center',
      spacingAfter: 400,
    }) +
    para(
      run(
        `Version ${E_APPROVAL_MANUAL_META.version}  ·  ${new Date().toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}`,
        { color: '94A3B8', size: 18 },
      ),
      { align: 'center' },
    ) +
    para(
      run('This handbook is generated from the application itself, so it describes what the module does today.', {
        color: '94A3B8',
        size: 18,
        italic: true,
      }),
      { align: 'center', spacingBefore: 200 },
    ) +
    `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;

  const contents =
    para(run('Contents'), { style: 'Heading1', spacingAfter: 160 }) +
    E_APPROVAL_MANUAL.map(
      (part) =>
        para(run(part.title, { bold: true, size: 21 }), { spacingBefore: 160, spacingAfter: 40 }) +
        part.sections
          .map((section) =>
            para(
              [
                run(section.number, { color: '64748B', size: 19 }),
                run(`  ${section.title}`, { size: 19 }),
                run(` — ${section.summary}`, { color: '94A3B8', size: 18 }),
              ],
              { indent: 340, hanging: 340, spacingAfter: 20 },
            ),
          )
          .join(''),
    ).join('') +
    `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;

  return cover + contents;
};

/* ── package parts ──────────────────────────────────────────────────────────────────────────── */

const CONTENT_TYPES = `${XML_HEADER}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

const PACKAGE_RELS = `${XML_HEADER}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const DOCUMENT_RELS = `${XML_HEADER}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>`;

const style = (id, name, { basedOn = 'Normal', size, bold, color, font, before, after, outline } = {}) => `
<w:style w:type="paragraph" w:styleId="${id}">
<w:name w:val="${name}"/><w:basedOn w:val="${basedOn}"/><w:qFormat/>
<w:pPr><w:spacing w:before="${before ?? 0}" w:after="${
  after ?? 0
}" w:line="276" w:lineRule="auto"/>${outline != null ? `<w:outlineLvl w:val="${outline}"/>` : ''}</w:pPr>
<w:rPr>${font ? `<w:rFonts w:ascii="${font}" w:hAnsi="${font}"/>` : ''}${bold ? '<w:b/>' : ''}${
  color ? `<w:color w:val="${color}"/>` : ''
}${size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : ''}</w:rPr>
</w:style>`;

const STYLES = `${XML_HEADER}
<w:styles ${W_NS}>
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>
<w:color w:val="1F2937"/><w:sz w:val="21"/><w:szCs w:val="21"/>
</w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${style('Title', 'Title', { size: 48, bold: true, color: '0F172A' })}
${style('Heading1', 'heading 1', { size: 32, bold: true, color: '0F172A', before: 320, after: 100, outline: 0 })}
${style('Heading2', 'heading 2', { size: 24, bold: true, color: '1E3A8A', before: 260, after: 60, outline: 1 })}
${style('Heading3', 'heading 3', { size: 22, bold: true, color: '334155', before: 200, after: 60, outline: 2 })}
${style('Footer', 'footer', { size: 16, color: '94A3B8' })}
</w:styles>`;

const FOOTER = `${XML_HEADER}
<w:ftr ${W_NS}>
<w:p><w:pPr><w:pStyle w:val="Footer"/><w:jc w:val="center"/></w:pPr>
${run(`${E_APPROVAL_MANUAL_META.title}  ·  `, { size: 16, color: '94A3B8' })}
<w:fldSimple w:instr=" PAGE "><w:r><w:rPr><w:color w:val="94A3B8"/><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple>
</w:p></w:ftr>`;

/**
 * Document properties.
 *
 * Both of these are strict sequences, and Word refuses the whole package — "the file appears to be
 * corrupted", with no indication which part — when either is out of order. CT_CoreProperties runs
 * created → creator → modified → revision → subject → title; CT_Properties puts Company before
 * Application. Neither ordering is guessable from how the elements read, so it is written out here.
 */
const STAMP = new Date().toISOString();

const CORE_PROPS = `${XML_HEADER}
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dcterms:created xsi:type="dcterms:W3CDTF">${STAMP}</dcterms:created>
<dc:creator>${esc(E_APPROVAL_MANUAL_META.organisation)}</dc:creator>
<dcterms:modified xsi:type="dcterms:W3CDTF">${STAMP}</dcterms:modified>
<cp:revision>1</cp:revision>
<dc:subject>${esc(E_APPROVAL_MANUAL_META.subtitle)}</dc:subject>
<dc:title>${esc(E_APPROVAL_MANUAL_META.title)}</dc:title>
<cp:version>${esc(E_APPROVAL_MANUAL_META.version)}</cp:version>
</cp:coreProperties>`;

const APP_PROPS = `${XML_HEADER}
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<Company>${esc(E_APPROVAL_MANUAL_META.organisation)}</Company>
<Application>SEL Live</Application>
</Properties>`;

const buildDocument = () => {
  const body = buildFrontMatter() + E_APPROVAL_MANUAL.map(renderPart).join('');
  const sectPr =
    '<w:sectPr><w:footerReference w:type="default" r:id="rId2"/>' +
    `<w:pgSz w:w="${PAGE_WIDTH}" w:h="16838"/>` +
    `<w:pgMar w:top="${PAGE_MARGIN}" w:right="${PAGE_MARGIN}" w:bottom="${PAGE_MARGIN}" w:left="${PAGE_MARGIN}" w:header="708" w:footer="567" w:gutter="0"/>` +
    '</w:sectPr>';
  return `${XML_HEADER}\n<w:document ${W_NS} ${R_NS}><w:body>${body}${sectPr}</w:body></w:document>`;
};

async function main() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.folder('_rels').file('.rels', PACKAGE_RELS);
  zip.folder('docProps').file('core.xml', CORE_PROPS);
  zip.folder('docProps').file('app.xml', APP_PROPS);
  const word = zip.folder('word');
  word.file('document.xml', buildDocument());
  word.file('styles.xml', STYLES);
  word.file('footer1.xml', FOOTER);
  word.folder('_rels').file('document.xml.rels', DOCUMENT_RELS);

  // DEFLATE and no compressed-file dates that vary per run, so rebuilding unchanged content produces
  // a byte-identical file and does not show up as a spurious diff.
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });

  const targets = [join(ROOT, 'docs', 'E-Approval-Manual.docx'), join(ROOT, 'public', 'docs', 'E-Approval-Manual.docx')];
  for (const target of targets) {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, buffer);
  }

  const sections = E_APPROVAL_MANUAL.reduce((total, part) => total + part.sections.length, 0);
  console.log(
    `E-Approval manual: ${E_APPROVAL_MANUAL.length} parts, ${sections} sections, ${(buffer.length / 1024).toFixed(1)} KB`,
  );
  for (const target of targets) console.log(`  → ${target.replace(ROOT + '\\', '').replace(ROOT + '/', '')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
