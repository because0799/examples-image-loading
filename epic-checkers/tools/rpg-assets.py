#!/usr/bin/env python3
"""«Валькирии доски» asset pipeline: source art / voice -> shipped files in web/static/rpg/.

    python3 tools/rpg-assets.py                 # build everything (heroes, bg, keyart, voice) + manifest
    python3 tools/rpg-assets.py --only voice    # just re-copy voice mp3s and refresh the manifest
    python3 tools/rpg-assets.py --sheet out.png # also render a contact sheet (tokens + cards) to check crops
    python3 tools/rpg-assets.py --debug-sheet out.png   # splashes with face / token / card rectangles
    python3 tools/rpg-assets.py --check         # validate crops.json + sources, write nothing
    python3 tools/rpg-assets.py --prune         # also delete shipped files that have no source any more
    python3 tools/rpg-assets.py --stamp liora   # after re-checking a changed image: record its new hash
    python3 tools/rpg-assets.py --voice-kbps 0  # ship the voice mp3s as they are (only tags stripped)

Sources (assets/rpg/, see docs/RPG-ARCHITECTURE.md):
    heroes/<id>.png              1280x720 hero art (one per hero)
    bg/<bg-id>.png               1280x720 battle backgrounds (bg-dawn, bg-ash, bg-sky)
    keyart/valkyries-keyart.png  1280x720 mode key art (optional, not committed)
    voice/<heroId>-<event>.mp3   Japanese voice lines (events: summon, skill, ultimate, victory)
    crops.json                   per hero: face centre + token size + card rectangle (source px)

Outputs (web/static/rpg/, copied into dist/www/rpg/ by tools/build-web.mjs):
    splash/<id>.webp  1280x720   the whole frame
    card/<id>.webp    480x640    3:4 portrait crop (crops.json "card" rectangle, head to thigh)
    token/<id>.webp   256x256    square face crop centred on crops.json "face" (circle mask at render time)
    bg/<bg-id>.webp   1280x720
    keyart.webp       1280x720   only when the source exists
    voice/<heroId>-<event>.mp3   the voice files that exist (others are simply absent), re-encoded to
                      64 kbps mono MP3 with ffmpeg when it is installed (speech stays clean, half the
                      size of the 128 kbps sources) and normalised to -16 LUFS (the generated lines
                      range from -32 to -14 LUFS); without ffmpeg (or --voice-kbps 0) the audio
                      frames are copied byte for byte and only the ID3 tags are dropped

It also regenerates the block between the @generated markers in src/rpg/assets.js (focal points,
list of shipped voice files, keyart flag) so RPG_ASSETS.voice() can answer null synchronously for
lines that are not shipped, and mirrors web/static/rpg into dist/dev/rpg/ (when dist/ exists) so the
RPG demo pages in dist/dev/<demo>/ can load the art with setRpgAssetBase('../').

Re-running is idempotent: the WebP encoder (and ffmpeg with bitexact flags) is deterministic, so
unchanged inputs give identical bytes. Requires Python 3.8+ and Pillow with WebP support; ffmpeg is
optional.
"""

import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

try:
    from PIL import Image, ImageDraw, ImageFont, features
except ImportError:  # pragma: no cover - environment problem
    sys.exit('rpg-assets: Pillow is required (python3 -m pip install Pillow)')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'rpg')
OUT = os.path.join(ROOT, 'web', 'static', 'rpg')
CROPS_FILE = os.path.join(SRC, 'crops.json')
ASSETS_JS = os.path.join(ROOT, 'src', 'rpg', 'assets.js')
HEROES_JS = os.path.join(ROOT, 'src', 'rpg', 'data', 'heroes.js')
DEV_MIRROR = os.path.join(ROOT, 'dist', 'dev', 'rpg')

SRC_W, SRC_H = 1280, 720
SPLASH_SIZE = (1280, 720)
CARD_SIZE = (480, 640)
TOKEN_SIZE = (256, 256)
BG_SIZE = (1280, 720)
KEYART_SIZE = (1280, 720)

# WebP quality per kind. Splash / card / keyart are looked at full screen; tokens are tiny on the
# board but must stay crisp around the eyes; backgrounds sit behind a dimmed board.
QUALITY = {'splash': 80, 'card': 80, 'token': 84, 'bg': 74, 'keyart': 80}
WEBP_METHOD = 6  # slowest / best compression; deterministic

VOICE_EVENTS = ('summon', 'skill', 'ultimate', 'victory')
BG_IDS_DEFAULT = ('bg-dawn', 'bg-ash', 'bg-sky')
KEYART_SRC = os.path.join(SRC, 'keyart', 'valkyries-keyart.png')

GEN_BEGIN = '// @generated-begin tools/rpg-assets.py'
GEN_END = '// @generated-end'

CARD_ASPECT = CARD_SIZE[0] / CARD_SIZE[1]


# ------------------------------------------------------------------------------------ helpers

def rel(path):
    return os.path.relpath(path, ROOT)


def fmt_kb(n):
    return f'{n / 1024:.1f} KB' if n < 1024 * 1024 else f'{n / 1024 / 1024:.2f} MB'


def warn(msg):
    print(f'rpg-assets: WARNING: {msg}', file=sys.stderr)


def save_webp(img, path, quality):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    img.save(tmp, 'WEBP', quality=quality, method=WEBP_METHOD)
    os.replace(tmp, path)
    return os.path.getsize(path)


def fit(img, size):
    """Resizes to exactly `size` (Lanczos); a no-op when the size already matches."""
    if img.size == tuple(size):
        return img
    return img.resize(size, Image.LANCZOS, reducing_gap=3.0)


def cover(img, size):
    """Scales + centre-crops `img` to fill `size` (CSS object-fit: cover)."""
    w, h = img.size
    tw, th = size
    s = max(tw / w, th / h)
    nw, nh = max(tw, round(w * s)), max(th, round(h * s))
    img = img.resize((nw, nh), Image.LANCZOS) if (nw, nh) != (w, h) else img
    x, y = (nw - tw) // 2, (nh - th) // 2
    return img.crop((x, y, x + tw, y + th))


def load_rgb(path):
    with Image.open(path) as im:
        im.load()
        return im.convert('RGB') if im.mode != 'RGB' else im.copy()


# ------------------------------------------------------------------------------------ roster

def roster_from_heroes_js():
    """Hero ids + expected focal from src/rpg/data/heroes.js (top-level entries of HEROES only)."""
    if not os.path.exists(HEROES_JS):
        return {}
    text = open(HEROES_JS, encoding='utf-8').read()
    out = {}
    # A hero entry starts with exactly four spaces of indentation: "    id: 'liora',"; nested ability
    # ids are indented deeper. The expected focal sits in the same entry: "focal: { x: 0.5, y: 0.27 }".
    starts = [(m.start(), m.group(1)) for m in re.finditer(r"^    id: '([a-z0-9-]+)',", text, re.M)]
    for i, (pos, hid) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(text)
        m = re.search(r'focal:\s*\{\s*x:\s*([0-9.]+),\s*y:\s*([0-9.]+)\s*\}', text[pos:end])
        out[hid] = (float(m.group(1)), float(m.group(2))) if m else (0.5, 0.27)
    return out


def load_crops_doc():
    if not os.path.exists(CROPS_FILE):
        return {'version': 1, 'source': {'width': SRC_W, 'height': SRC_H}, 'heroes': {}}
    with open(CROPS_FILE, encoding='utf-8') as f:
        doc = json.load(f)
    doc.setdefault('heroes', {})
    return doc


def write_crops_doc(doc):
    """crops.json with one line per hero (diff-friendly)."""
    out = ['{']
    for key in [k for k in doc if k != 'heroes']:
        val = doc[key]
        if isinstance(val, list) and val and all(isinstance(v, str) for v in val):
            lines = ',\n'.join('    ' + json.dumps(v, ensure_ascii=False) for v in val)
            out.append(f'  {json.dumps(key)}: [\n{lines}\n  ],')
        else:
            out.append(f'  {json.dumps(key)}: {json.dumps(val, ensure_ascii=False)},')
    out.append('  "heroes": {')
    ids = list(doc['heroes'])
    width = max((len(h) for h in ids), default=0) + 3
    for i, hid in enumerate(ids):
        e = doc['heroes'][hid]
        order = ['face', 'token', 'card', 'src'] + [k for k in e if k not in ('face', 'token', 'card', 'src')]
        body = ', '.join(f'{json.dumps(k)}: {json.dumps(e[k], ensure_ascii=False)}' for k in order if k in e)
        out.append(f'    {(json.dumps(hid) + ":").ljust(width)} {{ {body} }}{"," if i < len(ids) - 1 else ""}')
    out.append('  }')
    out.append('}')
    tmp = CROPS_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write('\n'.join(out) + '\n')
    os.replace(tmp, CROPS_FILE)


def file_sha(path):
    h = hashlib.sha1()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()[:12]


def resolve_crop(hid, entry, expected_focal):
    """Validated crop geometry for one hero: face centre, token square, card rectangle (source px)."""
    problems = []
    if entry is None:
        fx, fy = expected_focal
        entry = {'face': {'x': round(fx * SRC_W), 'y': round(fy * SRC_H)}}
        problems.append('no entry in crops.json, using the expected focal from heroes.js')
    face = entry.get('face') or {}
    fx, fy = int(face.get('x', SRC_W // 2)), int(face.get('y', SRC_H // 4))
    if not (0 <= fx < SRC_W and 0 <= fy < SRC_H):
        problems.append(f'face ({fx},{fy}) is outside the frame')
        fx, fy = min(max(fx, 0), SRC_W - 1), min(max(fy, 0), SRC_H - 1)

    tok = entry.get('token') or {}
    size = int(tok.get('size', 232))
    # optional offset of the token centre from the face centre (e.g. to keep a tall hat in frame)
    tcx, tcy = fx + int(tok.get('dx', 0)), fy + int(tok.get('dy', 0))
    size = max(64, min(size, SRC_H))
    tx = min(max(tcx - size // 2, 0), SRC_W - size)
    ty = min(max(tcy - size // 2, 0), SRC_H - size)
    shift = max(abs(tx + size // 2 - tcx), abs(ty + size // 2 - tcy))
    if shift > size * 0.04:  # a few px at the frame edge are invisible; more means a bad crop
        problems.append(f'token square was clamped to the frame by {shift}px, the face is off-centre in the token')
    token = (tx, ty, size, size)

    card = entry.get('card')
    if card:
        cx, cy, cw, ch = int(card['x']), int(card['y']), int(card['w']), int(card['h'])
    else:
        ch = 640
        cw = round(ch * CARD_ASPECT)
        cx, cy = fx - cw // 2, fy - 140
    if abs(cw / ch - CARD_ASPECT) > 0.01:
        problems.append(f'card {cw}x{ch} is not 3:4 (it will be stretched)')
    cx = min(max(cx, 0), SRC_W - cw)
    cy = min(max(cy, 0), SRC_H - ch)
    if cw > SRC_W or ch > SRC_H:
        problems.append('card rectangle is larger than the frame')
    if not (cx <= fx < cx + cw and cy <= fy < cy + ch):
        problems.append('the face is outside the card rectangle')
    return {'face': (fx, fy), 'token': token, 'card': (cx, cy, cw, ch)}, problems


# ------------------------------------------------------------------------------------ jobs

def build_hero(job):
    """Worker: writes splash / card / token for one hero. Returns {kind: bytes}."""
    hid, src, crop = job['id'], job['src'], job['crop']
    img = load_rgb(src)
    if img.size != (SRC_W, SRC_H):
        img = cover(img, (SRC_W, SRC_H))
    sizes = {}
    sizes['splash'] = save_webp(fit(img, SPLASH_SIZE), os.path.join(OUT, 'splash', hid + '.webp'), QUALITY['splash'])
    x, y, w, h = crop['card']
    sizes['card'] = save_webp(fit(img.crop((x, y, x + w, y + h)), CARD_SIZE), os.path.join(OUT, 'card', hid + '.webp'), QUALITY['card'])
    x, y, w, h = crop['token']
    sizes['token'] = save_webp(fit(img.crop((x, y, x + w, y + h)), TOKEN_SIZE), os.path.join(OUT, 'token', hid + '.webp'), QUALITY['token'])
    return hid, sizes


def build_plain(job):
    """Worker: one full-frame image (background / key art)."""
    img = load_rgb(job['src'])
    return job['name'], save_webp(cover(img, job['size']), job['out'], job['quality'])


# ------------------------------------------------------------------------------------ voice

def strip_id3(data):
    """MP3 bytes without the leading ID3v2 tag(s) and the trailing ID3v1 tag (audio frames untouched)."""
    start = 0
    while data[start:start + 3] == b'ID3' and len(data) >= start + 10:
        flags = data[start + 5]
        s = data[start + 6:start + 10]
        if any(b & 0x80 for b in s):
            break  # not a valid synch-safe size: leave the data alone
        size = (s[0] << 21) | (s[1] << 14) | (s[2] << 7) | s[3]
        start += 10 + size + (10 if flags & 0x10 else 0)  # footer present
    end = len(data)
    if end - start > 128 and data[end - 128:end - 125] == b'TAG':
        end -= 128
    body = data[start:end]
    # sanity: the remaining stream must start with an MPEG frame sync
    if len(body) < 4 or body[0] != 0xFF or (body[1] & 0xE0) != 0xE0:
        return data
    return body


def have_ffmpeg():
    return shutil.which('ffmpeg') is not None


def measure_lufs(src):
    """Integrated loudness (EBU R128) of an audio file in LUFS, or None."""
    try:
        r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', src, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return None
    m = re.findall(r'^\s*I:\s*(-?[0-9.]+|-inf)\s*LUFS', r.stderr.decode(errors='replace'), re.M)
    if not m or m[-1] == '-inf':
        return None
    return float(m[-1])


VOICE_PEAK = 0.84  # limiter ceiling, ≈ −1.5 dBFS (headroom for MP3 overshoot)
VOICE_GAIN_RANGE = (-12.0, 16.0)  # never boost the noise floor of a whisper by more than this


def encode_voice(src, dst, kbps, lufs=None):
    """Re-encodes one voice line to `kbps` CBR mono MP3 (44.1 kHz, no tags, bitexact). With `lufs`, the
    line is first brought to that integrated loudness (static gain + a transparent peak limiter), so
    soft-spoken and shouting heroes play at the same perceived volume. Returns True on success."""
    tmp = dst + '.tmp.mp3'
    filters = []
    if lufs is not None:
        measured = measure_lufs(src)
        if measured is not None:
            gain = min(max(lufs - measured, VOICE_GAIN_RANGE[0]), VOICE_GAIN_RANGE[1])
            filters.append(f'volume={gain:.2f}dB')
            filters.append(f'alimiter=limit={VOICE_PEAK}:attack=5:release=60:level=0')
    cmd = ['ffmpeg', '-v', 'error', '-y', '-i', src, '-map', '0:a:0', '-map_metadata', '-1']
    if filters:
        cmd += ['-af', ','.join(filters)]
    cmd += ['-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', f'{kbps}k',
            '-fflags', '+bitexact', '-flags:a', '+bitexact', '-id3v2_version', '0', '-write_id3v1', '0', tmp]
    try:
        r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as e:
        warn(f'ffmpeg failed on {rel(src)}: {e}')
        return False
    if r.returncode != 0 or not os.path.exists(tmp) or os.path.getsize(tmp) < 512:
        warn(f'ffmpeg failed on {rel(src)}: {r.stderr.decode(errors="replace").strip()[:200]}')
        if os.path.exists(tmp):
            os.remove(tmp)
        return False
    os.replace(tmp, dst)
    return True


def ship_voice(src, dst, kbps, lufs=None):
    """One voice line -> web/static/rpg/voice/. Returns 'encoded' | 'copied' | 'unchanged'."""
    if kbps and have_ffmpeg():
        before = open(dst, 'rb').read() if os.path.exists(dst) else None
        if encode_voice(src, dst, kbps, lufs):
            return 'unchanged' if before == open(dst, 'rb').read() else 'encoded'
    data = strip_id3(open(src, 'rb').read())
    if os.path.exists(dst) and open(dst, 'rb').read() == data:
        return 'unchanged'
    with open(dst + '.tmp', 'wb') as f:
        f.write(data)
    os.replace(dst + '.tmp', dst)
    return 'copied'


# ------------------------------------------------------------------------------------ manifest

def write_manifest(focal, voice_files, has_keyart, dry=False):
    """Rewrites the @generated block of src/rpg/assets.js. Returns True when the file changed."""
    if not os.path.exists(ASSETS_JS):
        warn(f'{rel(ASSETS_JS)} not found, manifest not written')
        return False
    text = open(ASSETS_JS, encoding='utf-8').read()
    b, e = text.find(GEN_BEGIN), text.find(GEN_END)
    if b < 0 or e < b:
        warn(f'{rel(ASSETS_JS)} has no {GEN_BEGIN!r} ... {GEN_END!r} block, manifest not written')
        return False
    lines = [GEN_BEGIN + ' — do not edit by hand, run `python3 tools/rpg-assets.py`.']
    lines.append('/** Face centre of every hero in its 1280×720 splash, 0..1 (from assets/rpg/crops.json). */')
    lines.append('const FOCAL = {')
    for hid in sorted(focal):
        x, y = focal[hid]
        lines.append(f'  {hid}: [{x / SRC_W:.4f}, {y / SRC_H:.4f}],')
    lines.append('};')
    lines.append('/** Voice lines shipped in web/static/rpg/voice/ as `<heroId>-<event>` (others are absent). */')
    lines.append('const VOICE_FILES = [')
    row = []
    for name in sorted(voice_files):
        row.append(f"'{name}'")
        if len(row) == 6:
            lines.append('  ' + ', '.join(row) + ',')
            row = []
    if row:
        lines.append('  ' + ', '.join(row) + ',')
    lines.append('];')
    lines.append(f'/** Whether web/static/rpg/keyart.webp is shipped. */')
    lines.append(f'const HAS_KEYART = {"true" if has_keyart else "false"};')
    block = '\n'.join(lines) + '\n'
    new = text[:b] + block + text[e:]
    if new == text:
        return False
    if not dry:
        with open(ASSETS_JS + '.tmp', 'w', encoding='utf-8') as f:
            f.write(new)
        os.replace(ASSETS_JS + '.tmp', ASSETS_JS)
    return True


# ------------------------------------------------------------------------------------ sheets

def _font(size):
    for p in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf'):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def contact_sheet(ids, path, cols=6):
    """Shipped cards + circle-masked tokens (as the board shows them), for eyeballing crops."""
    cell_w, card_w, card_h, tok = 210, 192, 256, 132
    cell_h = card_h + tok + 34
    rows = (len(ids) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * cell_w, rows * cell_h), (16, 12, 28))
    d = ImageDraw.Draw(sheet)
    font = _font(14)
    mask = Image.new('L', (tok * 4, tok * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, tok * 4 - 1, tok * 4 - 1), fill=255)
    mask = mask.resize((tok, tok), Image.LANCZOS)
    for i, hid in enumerate(ids):
        ox, oy = (i % cols) * cell_w + (cell_w - card_w) // 2, (i // cols) * cell_h + 6
        card_p, tok_p = os.path.join(OUT, 'card', hid + '.webp'), os.path.join(OUT, 'token', hid + '.webp')
        if os.path.exists(card_p):
            sheet.paste(load_rgb(card_p).resize((card_w, card_h), Image.LANCZOS), (ox, oy))
            # upper-third tick: the face should sit above it (upper fifth of the card)
            d.line([(ox, oy + card_h // 3), (ox + 8, oy + card_h // 3)], fill=(255, 210, 63), width=2)
        if os.path.exists(tok_p):
            t = load_rgb(tok_p).resize((tok, tok), Image.LANCZOS)
            tx, ty = (i % cols) * cell_w + (cell_w - tok) // 2, oy + card_h + 4
            sheet.paste(t, (tx, ty), mask)
            d.ellipse((tx - 2, ty - 2, tx + tok + 1, ty + tok + 1), outline=(255, 210, 63), width=3)
            d.line([(tx + tok // 2 - 5, ty + tok // 2), (tx + tok // 2 + 5, ty + tok // 2)], fill=(41, 230, 255))
            d.line([(tx + tok // 2, ty + tok // 2 - 5), (tx + tok // 2, ty + tok // 2 + 5)], fill=(41, 230, 255))
        d.text((ox, oy + card_h + tok + 8), hid, fill=(237, 232, 255), font=font)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    sheet.save(path)
    print(f'contact sheet -> {path}')


def debug_sheet(jobs, path, cols=4):
    """Downscaled sources with the face centre (+), token square (cyan) and card rectangle (gold)."""
    s = 0.25
    tw, th = int(SRC_W * s), int(SRC_H * s)
    rows = (len(jobs) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * tw, rows * th), 'black')
    font = _font(13)
    for i, job in enumerate(jobs):
        im = load_rgb(job['src']).resize((tw, th), Image.LANCZOS)
        d = ImageDraw.Draw(im)
        fx, fy = job['crop']['face']
        x, y, w, h = job['crop']['card']
        d.rectangle((x * s, y * s, (x + w) * s - 1, (y + h) * s - 1), outline=(255, 210, 63), width=2)
        x, y, w, h = job['crop']['token']
        d.rectangle((x * s, y * s, (x + w) * s - 1, (y + h) * s - 1), outline=(41, 230, 255), width=2)
        d.line([(fx * s - 6, fy * s), (fx * s + 6, fy * s)], fill=(255, 46, 99), width=2)
        d.line([(fx * s, fy * s - 6), (fx * s, fy * s + 6)], fill=(255, 46, 99), width=2)
        d.text((4, th - 18), job['id'], fill=(255, 255, 255), font=font, stroke_width=2, stroke_fill=(0, 0, 0))
        sheet.paste(im, ((i % cols) * tw, (i // cols) * th))
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    sheet.save(path)
    print(f'debug sheet -> {path}')


# ------------------------------------------------------------------------------------ main

def list_files(d, ext):
    if not os.path.isdir(d):
        return []
    return sorted(f for f in os.listdir(d) if f.endswith(ext) and not f.startswith('.') and '.tmp' not in f)


def dir_size(d):
    total, n = 0, 0
    for base, _, files in os.walk(d):
        for f in files:
            if '.tmp' in f:
                continue
            total += os.path.getsize(os.path.join(base, f))
            n += 1
    return total, n


def mirror_for_demos():
    """dist/dev/rpg <- web/static/rpg (git-ignored build output; lets demo pages load the art)."""
    if not os.path.isdir(os.path.join(ROOT, 'dist')):
        return
    tmp = DEV_MIRROR + '.tmp'
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.copytree(OUT, tmp)
    shutil.rmtree(DEV_MIRROR, ignore_errors=True)
    os.replace(tmp, DEV_MIRROR)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--only', action='append', choices=['heroes', 'bg', 'keyart', 'voice'],
                    help='build only these parts (repeatable); the manifest is always refreshed')
    ap.add_argument('--hero', action='append', help='restrict hero art to these ids (repeatable)')
    ap.add_argument('--sheet', help='write a contact sheet of the shipped cards + tokens to this PNG')
    ap.add_argument('--debug-sheet', help='write the sources with face/token/card rectangles to this PNG')
    ap.add_argument('--check', action='store_true', help='validate crops.json and sources only; write nothing')
    ap.add_argument('--prune', action='store_true', help='delete shipped files whose source is gone')
    ap.add_argument('--stamp', action='append', metavar='ID',
                    help="record the current source hash of these heroes in crops.json ('all' = every hero) "
                         'after re-checking their crops')
    ap.add_argument('--voice-kbps', type=int, default=64,
                    help='re-encode voice to this CBR mono MP3 bitrate with ffmpeg (0 = copy the audio frames)')
    ap.add_argument('--voice-lufs', type=float, default=-16.0,
                    help='loudness target of the re-encoded voice in LUFS (0 = keep the source loudness)')
    ap.add_argument('--jobs', type=int, default=os.cpu_count() or 2, help='parallel encoders')
    args = ap.parse_args(argv)

    if not features.check('webp'):
        sys.exit('rpg-assets: this Pillow build has no WebP support')

    parts = set(args.only or ['heroes', 'bg', 'keyart', 'voice'])
    roster = roster_from_heroes_js()
    crops_doc = load_crops_doc()
    crops = crops_doc['heroes']
    hero_pngs = {f[:-4] for f in list_files(os.path.join(SRC, 'heroes'), '.png')}
    ids = sorted(set(roster) | set(crops) | hero_pngs, key=lambda h: (list(roster).index(h) if h in roster else 999, h))
    errors = 0

    # ---- validate
    jobs = []
    focal = {}
    stamped = []
    for hid in ids:
        if roster and hid not in roster:
            warn(f'{hid}: art / crop exists but the hero is not in heroes.js')
        if hid in crops and hid not in hero_pngs:
            warn(f'{hid}: crops.json entry but no assets/rpg/heroes/{hid}.png')
        crop, problems = resolve_crop(hid, crops.get(hid), roster.get(hid, (0.5, 0.27)))
        for p in problems:
            warn(f'{hid}: {p}')
        if hid not in crops:
            errors += 1
        focal[hid] = crop['face']
        if hid in hero_pngs:
            src = os.path.join(SRC, 'heroes', hid + '.png')
            jobs.append({'id': hid, 'src': src, 'crop': crop})
            if hid in crops:
                sha = file_sha(src)
                if args.stamp and ('all' in args.stamp or hid in args.stamp):
                    if crops[hid].get('src') != sha:
                        crops[hid]['src'] = sha
                        stamped.append(hid)
                elif crops[hid].get('src') and crops[hid]['src'] != sha:
                    warn(f'{hid}: heroes/{hid}.png changed since its crop was measured - re-check face/card '
                         f'(--debug-sheet / --sheet), then --stamp {hid}')
        elif hid in roster:
            warn(f'{hid}: no source art (assets/rpg/heroes/{hid}.png)')
            errors += 1

    voice_src = []
    for f in list_files(os.path.join(SRC, 'voice'), '.mp3'):
        m = re.fullmatch(r'([a-z0-9]+)-([a-z]+)\.mp3', f)
        if not m or m.group(2) not in VOICE_EVENTS or (roster and m.group(1) not in roster):
            warn(f'voice/{f}: not <heroId>-<{"|".join(VOICE_EVENTS)}>.mp3, skipped')
            continue
        if os.path.getsize(os.path.join(SRC, 'voice', f)) < 512:
            warn(f'voice/{f}: suspiciously small ({os.path.getsize(os.path.join(SRC, "voice", f))} B), skipped')
            continue
        voice_src.append(f)

    if args.stamp:
        unknown = [h for h in args.stamp if h != 'all' and h not in crops]
        for h in unknown:
            warn(f'--stamp {h}: no such hero in crops.json')
        if stamped:
            write_crops_doc(crops_doc)
        print(f'stamped: {", ".join(stamped) if stamped else "nothing changed"}')

    if args.check:
        print(f'rpg-assets: {len(jobs)} hero sources, {len(voice_src)} voice files, {errors} error(s)')
        if args.debug_sheet:
            debug_sheet(jobs, args.debug_sheet)
        return 1 if errors else 0

    os.makedirs(OUT, exist_ok=True)
    report = {}

    # ---- images (parallel)
    img_jobs, plain_jobs = [], []
    if 'heroes' in parts:
        img_jobs = [j for j in jobs if not args.hero or j['id'] in args.hero]
    if 'bg' in parts:
        for f in list_files(os.path.join(SRC, 'bg'), '.png'):
            name = f[:-4]
            plain_jobs.append({'name': 'bg/' + name, 'src': os.path.join(SRC, 'bg', f), 'size': BG_SIZE,
                               'out': os.path.join(OUT, 'bg', name + '.webp'), 'quality': QUALITY['bg']})
        missing = [b for b in BG_IDS_DEFAULT if not os.path.exists(os.path.join(SRC, 'bg', b + '.png'))]
        for b in missing:
            warn(f'background {b}.png is missing')
    if 'keyart' in parts and os.path.exists(KEYART_SRC):
        plain_jobs.append({'name': 'keyart', 'src': KEYART_SRC, 'size': KEYART_SIZE,
                           'out': os.path.join(OUT, 'keyart.webp'), 'quality': QUALITY['keyart']})

    with concurrent.futures.ProcessPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        futs = [pool.submit(build_hero, j) for j in img_jobs] + [pool.submit(build_plain, j) for j in plain_jobs]
        for fut in concurrent.futures.as_completed(futs):
            name, sizes = fut.result()
            report[name] = sizes

    # ---- voice (the lines that exist)
    voice_stats = {}
    if 'voice' in parts and voice_src:
        os.makedirs(os.path.join(OUT, 'voice'), exist_ok=True)
        if args.voice_kbps and not have_ffmpeg():
            warn('ffmpeg not found: voice lines are copied without re-encoding')
        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
            for res in pool.map(lambda f: ship_voice(os.path.join(SRC, 'voice', f), os.path.join(OUT, 'voice', f), args.voice_kbps,
                                                 args.voice_lufs or None), voice_src):
                voice_stats[res] = voice_stats.get(res, 0) + 1

    # ---- prune / stale report
    expected = {('splash', h) for h in hero_pngs} | {('card', h) for h in hero_pngs} | {('token', h) for h in hero_pngs}
    expected |= {('bg', f[:-4]) for f in list_files(os.path.join(SRC, 'bg'), '.png')}
    stale = []
    for kind in ('splash', 'card', 'token', 'bg'):
        for f in list_files(os.path.join(OUT, kind), '.webp'):
            if (kind, f[:-5]) not in expected:
                stale.append(os.path.join(OUT, kind, f))
    if os.path.exists(os.path.join(OUT, 'keyart.webp')) and not os.path.exists(KEYART_SRC):
        stale.append(os.path.join(OUT, 'keyart.webp'))
    for f in list_files(os.path.join(OUT, 'voice'), '.mp3'):
        if f not in voice_src:
            stale.append(os.path.join(OUT, 'voice', f))
    for p in stale:
        if args.prune:
            os.remove(p)
            print(f'pruned {rel(p)}')
        else:
            warn(f'{rel(p)} has no source (kept; --prune deletes it)')
    for base, _, files in os.walk(OUT):
        for f in files:
            if '.tmp' in f:
                os.remove(os.path.join(base, f))

    # ---- manifest (from what is actually shipped)
    shipped_voice = [f[:-4] for f in list_files(os.path.join(OUT, 'voice'), '.mp3')]
    has_keyart = os.path.exists(os.path.join(OUT, 'keyart.webp'))
    changed = write_manifest(focal, shipped_voice, has_keyart)

    mirror_for_demos()

    # ---- report
    if report:
        hero_rows = sorted(k for k in report if not k.startswith('bg/') and k != 'keyart')
        if hero_rows:
            tot = {k: sum(report[h][k] for h in hero_rows) for k in ('splash', 'card', 'token')}
            print(f'heroes built: {len(hero_rows)}  splash {fmt_kb(tot["splash"])}  card {fmt_kb(tot["card"])}  token {fmt_kb(tot["token"])}')
        for k in sorted(k for k in report if k.startswith('bg/') or k == 'keyart'):
            print(f'{k}: {fmt_kb(report[k])}')
    grand = 0
    print('shipped web/static/rpg:')
    for kind in ('splash', 'card', 'token', 'bg', 'voice'):
        size, n = dir_size(os.path.join(OUT, kind))
        grand += size
        print(f'  {kind:7s} {n:3d} files  {fmt_kb(size)}')
    if has_keyart:
        size = os.path.getsize(os.path.join(OUT, 'keyart.webp'))
        grand += size
        print(f'  keyart    1 file   {fmt_kb(size)}')
    else:
        print('  keyart    -        (no assets/rpg/keyart/valkyries-keyart.png)')
    print(f'  total          {fmt_kb(grand)}')
    voiced = [h for h in roster if any(f.startswith(h + '-') for f in shipped_voice)]
    stats = ', '.join(f'{v} {k}' for k, v in sorted(voice_stats.items()))
    print(f'voice: {len(shipped_voice)} line(s) shipped for {len(voiced)} hero(es){" (" + stats + ")" if stats else ""}')
    print(f'manifest {rel(ASSETS_JS)}: {"updated" if changed else "unchanged"}')

    if args.sheet:
        contact_sheet([j['id'] for j in jobs], args.sheet)
    if args.debug_sheet:
        debug_sheet(jobs, args.debug_sheet)
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
