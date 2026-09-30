// Серия генераций через API ComfyUI: одна строка CSV — одно задание.
// Нужен только Node.js 18+ (он уже стоит вместе с n8n). Без npm-пакетов.
//
//   node automation/series.mjs --workflow workflows/фасад.api.json --csv варианты.csv
//
// Подробно — docs/05-автоматизация.md.

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const HELP = `
Использование:
  node automation/series.mjs --workflow <файл .api.json> --csv <файл .csv> [ключи]

Ключи:
  --server <адрес>   ComfyUI, по умолчанию http://127.0.0.1:8188
  --out <папка>      куда сохранять, по умолчанию output/series
  --timeout <мин>    предел на одно задание, по умолчанию 60
  --dry              только проверить CSV и подстановку, ничего не отправлять

CSV: первая строка — заголовки вида «ЗАГОЛОВОК УЗЛА.поле», например
  имя;ЗАПРОС.text;SEED.seed;ВИД.image
Колонка «имя» — начало имени файлов результата.
Если значение — путь к существующему файлу, он загружается в ComfyUI
(для узлов Load Image). Разделитель — «;» или «,», кодировка — UTF-8.
`;

function parseArgs(argv) {
  const a = { server: 'http://127.0.0.1:8188', out: 'output/series', timeout: 60, dry: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--dry') a.dry = true;
    else if (k === '--help' || k === '-h') a.help = true;
    else if (k.startsWith('--')) a[k.slice(2)] = argv[++i];
  }
  return a;
}

// Простой разбор CSV: кавычки, «;» или «,», BOM от Excel.
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0];
  const sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(v => v.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(v => v.trim() !== '')) rows.push(row);
  const [head, ...body] = rows;
  return body.map(r => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

function findNode(wf, title) {
  const found = Object.entries(wf).filter(([, n]) => n._meta?.title === title);
  if (found.length === 0) throw new Error(`в процессе нет узла с заголовком «${title}»`);
  if (found.length > 1) throw new Error(`узлов с заголовком «${title}» несколько — заголовки должны быть разными`);
  return found[0][1];
}

// Подставляет значения строки CSV в копию процесса. Экспортируется для узла Code в n8n.
export function applyRow(workflow, row) {
  const wf = structuredClone(workflow);
  for (const [col, value] of Object.entries(row)) {
    if (col === 'имя' || value === '') continue;
    const dot = col.lastIndexOf('.');
    if (dot < 1) throw new Error(`колонка «${col}»: нужен вид «ЗАГОЛОВОК.поле»`);
    const node = findNode(wf, col.slice(0, dot));
    const field = col.slice(dot + 1);
    if (!(field in node.inputs)) throw new Error(`у узла «${col.slice(0, dot)}» нет поля «${field}»`);
    if (Array.isArray(node.inputs[field])) throw new Error(`поле «${col}» подключено к другому узлу — его не подставить`);
    node.inputs[field] = typeof node.inputs[field] === 'number' ? Number(value) : value;
  }
  return wf;
}

async function exists(p) { try { await access(p); return true; } catch { return false; } }

async function api(server, path, init) {
  const r = await fetch(server + path, init);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${await r.text()}`);
  return r;
}

async function uploadImage(server, file) {
  const form = new FormData();
  form.append('image', new Blob([await readFile(file)]), basename(file));
  form.append('overwrite', 'true');
  const j = await (await api(server, '/upload/image', { method: 'POST', body: form })).json();
  return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
}

async function waitResult(server, id, timeoutMin) {
  const end = Date.now() + timeoutMin * 60_000;
  while (Date.now() < end) {
    const h = await (await api(server, `/history/${id}`)).json();
    const item = h[id];
    if (item?.status?.status_str === 'error') throw new Error('ComfyUI сообщил об ошибке: ' + JSON.stringify(item.status.messages?.at(-1) ?? ''));
    if (item?.status?.completed || (item?.outputs && Object.keys(item.outputs).length)) return item.outputs;
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`не дождались за ${timeoutMin} мин`);
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help || !a.workflow || !a.csv) { console.log(HELP); process.exit(a.help ? 0 : 1); }

  const workflow = JSON.parse(await readFile(a.workflow, 'utf8'));
  if (workflow.nodes && workflow.links) throw new Error('это обычный файл процесса, нужен API-формат: Workflow → Export (API)');
  const rows = parseCsv(await readFile(a.csv, 'utf8'));
  console.log(`Заданий: ${rows.length}`);

  // Проверка всех строк до отправки — чтобы серия не упала на середине.
  rows.forEach((row, i) => {
    try { applyRow(workflow, row); } catch (e) { throw new Error(`строка ${i + 2}: ${e.message}`); }
  });
  if (a.dry) { console.log('Проверка пройдена, отправка пропущена (--dry).'); return; }

  try { await api(a.server, '/system_stats'); }
  catch { throw new Error(`ComfyUI не отвечает по адресу ${a.server} — он запущен?`); }

  await mkdir(a.out, { recursive: true });
  const uploaded = new Map(); // одна картинка вида загружается один раз на серию
  const report = [['№', 'имя', 'prompt_id', 'секунд', 'файлы', 'ошибка']];
  const clientId = 'series-' + Date.now();

  for (const [i, row] of rows.entries()) {
    const name = row['имя'] || String(i + 1).padStart(3, '0');
    const started = Date.now();
    try {
      const prepared = { ...row };
      for (const [col, v] of Object.entries(row))
        if (col !== 'имя' && /\.(png|jpe?g|webp)$/i.test(v) && await exists(v)) {
          const full = resolve(v);
          if (!uploaded.has(full)) uploaded.set(full, await uploadImage(a.server, full));
          prepared[col] = uploaded.get(full);
        }

      const body = JSON.stringify({ prompt: applyRow(workflow, prepared), client_id: clientId });
      const sent = await (await fetch(a.server + '/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).json();
      if (!sent.prompt_id) throw new Error('ComfyUI не принял задание: ' + JSON.stringify(sent.node_errors ?? sent.error ?? sent));

      const outputs = await waitResult(a.server, sent.prompt_id, Number(a.timeout));
      const saved = [];
      for (const out of Object.values(outputs))
        for (const f of [...(out.images ?? []), ...(out.gifs ?? []), ...(out.videos ?? [])]) {
          if (f.type !== 'output') continue;
          const q = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder ?? '', type: f.type });
          const data = Buffer.from(await (await api(a.server, '/view?' + q)).arrayBuffer());
          const ext = f.filename.includes('.') ? f.filename.slice(f.filename.lastIndexOf('.')) : '.png';
          const file = join(a.out, `${name}${saved.length ? '_' + (saved.length + 1) : ''}${ext}`);
          await writeFile(file, data);
          saved.push(basename(file));
        }
      const sec = ((Date.now() - started) / 1000).toFixed(1);
      report.push([i + 1, name, sent.prompt_id, sec, saved.join(' '), '']);
      console.log(`[${i + 1}/${rows.length}] ${name} — ${sec} с, ${saved.join(', ') || 'файлов нет'}`);
    } catch (e) {
      report.push([i + 1, name, '', ((Date.now() - started) / 1000).toFixed(1), '', e.message]);
      console.error(`[${i + 1}/${rows.length}] ${name} — ОШИБКА: ${e.message}`);
    }
  }

  const csv = report.map(r => r.map(v => `"${String(v).replaceAll('"', '""')}"`).join(';')).join('\r\n');
  await writeFile(join(a.out, 'отчёт.csv'), '﻿' + csv);
  console.log(`Готово. Отчёт: ${join(a.out, 'отчёт.csv')}`);
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  main().catch(e => { console.error('Остановлено: ' + e.message); process.exit(1); });
}
