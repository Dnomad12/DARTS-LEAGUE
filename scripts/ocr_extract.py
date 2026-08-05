#!/usr/bin/env python3
"""
OCR extractor enhanced for database ingestion.

Behavior:
- Processes all images in docs/uploads that have not been processed before (tracked in SQLite uploads table).
- Runs Tesseract OCR, extracts raw text, attempts to find a date in the screenshot, and parses table-like player rows.
- Inserts/updates an SQLite DB at docs/data/standings.db with these tables:
  - players (id, name)
  - matches (id, date, gameType, sourceImage)
  - legs, visits, darts (created for schema completeness but not populated by OCR)
  - uploads (id, filename, uploaded_at, processed_at, ocr_raw, parse_status)
  - ocr_parsed_rows (history of parsed rows per upload)
- Also writes docs/data/standings.json as a convenience JSON export for the site.

Notes:
- This script uses pytesseract + Pillow + python-dateutil. The workflow installs tesseract-ocr system package and the Python deps from scripts/requirements.txt.
- Date extraction uses dateutil.parser.parse with fuzzy matching to locate likely date strings; result normalized to YYYY-MM-DD when possible.

"""

import os
import re
import json
import sys
import sqlite3
from datetime import datetime
from pathlib import Path
from PIL import Image, ImageOps
import pytesseract
from dateutil import parser as dateparser

ROOT = Path(__file__).resolve().parents[1]
UPLOADS = ROOT / 'docs' / 'uploads'
DB_PATH = ROOT / 'docs' / 'data' / 'standings.db'
JSON_PATH = ROOT / 'docs' / 'data' / 'standings.json'
OCR_RAW_DIR = ROOT / 'docs' / 'data'

IGNORES = {'.gitkeep', 'README.md'}
IMG_EXTS = {'.png', '.jpg', '.jpeg', '.tiff', '.bmp'}


def list_images():
    files = []
    if not UPLOADS.exists():
        return files
    for name in sorted(os.listdir(UPLOADS)):
        if name in IGNORES:
            continue
        lower = name.lower()
        ext = os.path.splitext(lower)[1]
        if ext in IMG_EXTS:
            files.append(name)
    return files


def preprocess(img: Image.Image) -> Image.Image:
    img = img.convert('L')
    img = ImageOps.autocontrast(img)
    w, h = img.size
    if max(w, h) < 1000:
        scale = 1000 / max(w, h)
        img = img.resize((int(w*scale), int(h*scale)), Image.BICUBIC)
    return img


def ocr_image(path: str) -> str:
    img = Image.open(path)
    img = preprocess(img)
    # psm 6 - single uniform block of text
    text = pytesseract.image_to_string(img, config='--psm 6')
    return text


# Date extraction heuristics
DATE_RE_PATTERNS = [
    r"\b(\d{4}-\d{1,2}-\d{1,2})\b",          # 2026-08-05
    r"\b(\d{1,2}/\d{1,2}/\d{2,4})\b",      # 08/05/2026 or 8/5/26
    r"\b(\d{1,2}[-\.]\d{1,2}[-\.]\d{2,4})\b", # 05.08.2026
    r"\b(January|February|March|April|May|June|July|August|September|October|November|December)\b.*?\b(\d{1,2})\b.*?(\d{4})", # Month name day year
    r"\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s*(\d{4})\b",
]


def extract_date(text: str):
    # Try regex first to get candidate substrings
    for pat in DATE_RE_PATTERNS:
        m = re.search(pat, text, flags=re.IGNORECASE)
        if m:
            # use the full match
            s = m.group(0)
            try:
                dt = dateparser.parse(s, fuzzy=True, dayfirst=False)
                return dt.date().isoformat()
            except Exception:
                continue
    # fallback: try to parse any substring that looks like a date using dateutil fuzzy
    try:
        dt = dateparser.parse(text, fuzzy=True, default=datetime.now())
        # ensure that a parsed year is reasonable (e.g., between 2000 and 2100)
        if 2000 <= dt.year <= 2100:
            return dt.date().isoformat()
    except Exception:
        pass
    return None


# Parsing player rows (heuristics similar to earlier script)
def parse_players_from_text(text: str):
    players = []
    for idx, line in enumerate(text.splitlines()):
        line = line.strip()
        if not line:
            continue
        line = re.sub(r'[\t\u00A0]+', ' ', line)
        line = re.sub(r' {2,}', ' ', line)
        tokens = line.split(' ')
        # look for trailing numeric sequences: prefer 7 numbers, then 6
        for num_count in (7, 6):
            if len(tokens) < num_count + 1:
                continue
            trailing = tokens[-num_count:]
            if all(re.fullmatch(r'-?\d+', t) for t in trailing):
                prefix = tokens[:-num_count]
                if prefix and re.fullmatch(r'\d{1,2}', prefix[0]):
                    prefix = prefix[1:]
                name = ' '.join(prefix).strip()
                if not name:
                    break
                nums = list(map(int, trailing))
                if num_count == 7:
                    matchesPlayed, wins, losses, legsFor, legsAgainst, diff, points = nums
                else:
                    matchesPlayed, wins, losses, legsFor, legsAgainst, points = nums
                    diff = legsFor - legsAgainst
                player = {
                    'row_index': idx,
                    'name': name,
                    'matchesPlayed': int(matchesPlayed),
                    'wins': int(wins),
                    'losses': int(losses),
                    'legsFor': int(legsFor),
                    'legsAgainst': int(legsAgainst),
                    'diff': int(diff),
                    'points': int(points)
                }
                players.append(player)
                break
    # dedupe
    seen = set(); out = []
    for p in players:
        k = p['name'].lower()
        if k in seen: continue
        seen.add(k); out.append(p)
    return out


def ensure_schema(conn: sqlite3.Connection):
    c = conn.cursor()
    c.executescript(r"""
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY,
      date TEXT,
      gameType TEXT,
      sourceImage TEXT
    );

    CREATE TABLE IF NOT EXISTS legs (
      id INTEGER PRIMARY KEY,
      matchId INTEGER REFERENCES matches(id)
    );

    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY,
      legId INTEGER REFERENCES legs(id),
      playerId INTEGER REFERENCES players(id),
      round INTEGER,
      score INTEGER,
      remaining INTEGER
    );

    CREATE TABLE IF NOT EXISTS darts (
      id INTEGER PRIMARY KEY,
      visitId INTEGER REFERENCES visits(id),
      dartNumber INTEGER,
      multiplier INTEGER,
      segment INTEGER
    );

    CREATE TABLE IF NOT EXISTS uploads (
      id INTEGER PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      uploaded_at TEXT,
      processed_at TEXT,
      ocr_raw TEXT,
      parse_status TEXT
    );

    CREATE TABLE IF NOT EXISTS ocr_parsed_rows (
      id INTEGER PRIMARY KEY,
      upload_id INTEGER REFERENCES uploads(id) ON DELETE CASCADE,
      row_index INTEGER,
      raw_text TEXT,
      name TEXT,
      matchesPlayed INTEGER,
      wins INTEGER,
      losses INTEGER,
      legsFor INTEGER,
      legsAgainst INTEGER,
      diff INTEGER,
      points INTEGER,
      parsed_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    """)
    conn.commit()


def processed_filenames(conn: sqlite3.Connection):
    c = conn.cursor()
    c.execute('SELECT filename FROM uploads')
    return {row[0] for row in c.fetchall()}


def file_mtime_iso(path: Path):
    try:
        ts = path.stat().st_mtime
        return datetime.utcfromtimestamp(ts).isoformat() + 'Z'
    except Exception:
        return datetime.utcnow().isoformat() + 'Z'


def upsert_player(conn: sqlite3.Connection, name: str):
    c = conn.cursor()
    c.execute('SELECT id FROM players WHERE name = ?', (name,))
    row = c.fetchone()
    if row:
        return row[0]
    c.execute('INSERT INTO players (name) VALUES (?)', (name,))
    conn.commit()
    return c.lastrowid


def process_image(conn: sqlite3.Connection, filename: str):
    path = UPLOADS / filename
    print('Processing', filename)
    text = ocr_image(str(path))
    # save raw OCR to a file for debugging (one per upload)
    OCR_RAW_DIR.mkdir(parents=True, exist_ok=True)
    raw_file = OCR_RAW_DIR / f'ocr_raw_{filename}.txt'
    with open(raw_file, 'w', encoding='utf-8') as f:
        f.write(text)
    # attempt to extract date
    date_iso = extract_date(text)
    parse_status = 'ok' if date_iso else 'no_date'
    # parse players
    players = parse_players_from_text(text)

    c = conn.cursor()
    uploaded_at = file_mtime_iso(path)
    processed_at = datetime.utcnow().isoformat() + 'Z'
    c.execute('INSERT OR IGNORE INTO uploads (filename, uploaded_at, processed_at, ocr_raw, parse_status) VALUES (?,?,?,?,?)', (
        filename, uploaded_at, processed_at, text, parse_status
    ))
    conn.commit()
    c.execute('SELECT id FROM uploads WHERE filename = ?', (filename,))
    upload_id = c.fetchone()[0]

    # insert a match record representing this screenshot (date may be null)
    c.execute('INSERT INTO matches (date, gameType, sourceImage) VALUES (?,?,?)', (date_iso, None, 'docs/uploads/' + filename))
    conn.commit()
    match_id = c.lastrowid

    # record parsed rows
    for p in players:
        # insert player if not exists
        player_id = None
        try:
            player_id = upsert_player(conn, p['name'])
        except Exception as e:
            print('Player upsert failed for', p['name'], e)
        c.execute('''INSERT INTO ocr_parsed_rows (upload_id, row_index, raw_text, name, matchesPlayed, wins, losses, legsFor, legsAgainst, diff, points)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?)''', (
            upload_id, p.get('row_index'), None, p['name'], p.get('matchesPlayed'), p.get('wins'), p.get('losses'), p.get('legsFor'), p.get('legsAgainst'), p.get('diff'), p.get('points')
        ))
    conn.commit()

    # write a convenience JSON summary for the upload
    j = {
        'sourceImage': 'docs/uploads/' + filename,
        'date': date_iso,
        'parse_status': parse_status,
        'players': players
    }
    with open(JSON_PATH, 'w', encoding='utf-8') as f:
        json.dump(j, f, indent=2)
    print('Processed', filename, '->', len(players), 'players; date=', date_iso)


def main():
    images = list_images()
    if not images:
        print('No images found in', UPLOADS)
        sys.exit(0)

    OCR_RAW_DIR.mkdir(parents=True, exist_ok=True)
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(DB_PATH))
    ensure_schema(conn)

    processed = processed_filenames(conn)
    to_process = [img for img in images if img not in processed]
    if not to_process:
        print('No new images to process')
        conn.close()
        sys.exit(0)

    for img in to_process:
        try:
            process_image(conn, img)
        except Exception as e:
            print('Failed to process', img, e)
    conn.close()
    print('Done')


if __name__ == '__main__':
    main()
