#!/usr/bin/env node
// ══════════════════════════════════════════════════
//  Genera photos.json a partir del contenido real
//  de la carpeta /fotos. Sustituye al array manual
//  que antes había que editar a mano en index.html.
//
//  Orden de prioridad para la fecha de cada foto:
//   1. Fecha en el nombre del archivo (YYYYMMDD_HHMMSS,
//      típico de capturas de WhatsApp/Android).
//   2. EXIF DateTimeOriginal / CreateDate de la imagen.
//   3. Fecha de creación del archivo en git (primer commit
//      que lo añadió). Fallback final si no hay EXIF.
//
//  Uso:  node scripts/generate-photos.mjs
// ══════════════════════════════════════════════════

import { readdir, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import exifr from "exifr";

const ROOT = path.resolve(import.meta.dirname, "..");
const FOTOS_DIR = path.join(ROOT, "fotos");
const OUTPUT = path.join(ROOT, "photos.json");

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic"]);

const FILENAME_DATE_RE = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/;

function dateFromFilename(name) {
  const m = name.match(FILENAME_DATE_RE);
  if (!m) return null;
  const [, y, mo, d] = m;
  const iso = `${y}-${mo}-${d}`;
  // sanity check: descarta si no es una fecha real (p.ej. mes 00)
  const asDate = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(asDate.getTime())) return null;
  return iso;
}

async function dateFromExif(filePath) {
  try {
    const exif = await exifr.parse(filePath, [
      "DateTimeOriginal",
      "CreateDate",
      "ModifyDate",
    ]);
    const raw = exif?.DateTimeOriginal || exif?.CreateDate || exif?.ModifyDate;
    if (!raw) return null;
    const d = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function dateFromGitFirstCommit(relPath) {
  try {
    const out = execSync(
      `git log --diff-filter=A --follow --format=%aI -- "${relPath}"`,
      { cwd: ROOT, encoding: "utf8" }
    ).trim();
    const firstLine = out.split("\n").filter(Boolean).pop(); // el más antiguo
    if (!firstLine) return null;
    return firstLine.slice(0, 10);
  } catch {
    return null;
  }
}

async function main() {
  const entries = await readdir(FOTOS_DIR, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort();

  const photos = [];
  const warnings = [];

  for (const name of files) {
    const relSrc = `fotos/${name}`;
    const absPath = path.join(FOTOS_DIR, name);

    let date = dateFromFilename(name);
    let source = "filename";

    if (!date) {
      date = await dateFromExif(absPath);
      source = "exif";
    }
    if (!date) {
      date = dateFromGitFirstCommit(relSrc);
      source = "git";
    }
    if (!date) {
      date = new Date().toISOString().slice(0, 10);
      source = "fallback-today";
      warnings.push(name);
    }

    photos.push({ src: relSrc, date, _source: source });
  }

  photos.sort((a, b) => a.date.localeCompare(b.date));

  // El campo _source es solo informativo para depurar; no hace falta
  // en producción, así que se elimina antes de escribir el JSON final.
  const clean = photos.map(({ src, date }) => ({ src, date }));

  await writeFile(OUTPUT, JSON.stringify(clean, null, 2) + "\n", "utf8");

  console.log(`✔ photos.json generado con ${clean.length} fotos.`);
  if (warnings.length) {
    console.log(
      `⚠ ${warnings.length} foto(s) sin fecha detectable (se usó la fecha de hoy):`
    );
    for (const w of warnings) console.log(`   - ${w}`);
  }
}

main().catch((err) => {
  console.error("Error generando photos.json:", err);
  process.exit(1);
});
