#!/usr/bin/env python3
"""Generate rebrand/overlay/ artwork from the Mira logo PDFs.

Run only when the logo changes: python rebrand/tools/generate_assets.py
Requires PyMuPDF and Pillow. Sizes and corner masks are read from the upstream
file being replaced, so every slot keeps its layout.
"""
import io
import re
import struct
import subprocess
import zlib
from pathlib import Path

import pymupdf
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
BRAND = ROOT / "rebrand/brand"
OVERLAY = ROOT / "rebrand/overlay"
BASE_REF = "upstream/main"
TILES = [
    "public/app-icon.png",
    "public/apple-touch-icon.png",
    "public/favicon.png",
    "src-tauri/icons/32x32.png",
    "src-tauri/icons/128x128.png",
    "src-tauri/icons/128x128@2x.png",
    "src-tauri/icons/icon.png",
]
WHITE, BLACK = (255, 255, 255, 255), (0, 0, 0, 255)


def git_bytes(path):
    return subprocess.run(
        ["git", "show", f"{BASE_REF}:{path}"], cwd=ROOT, capture_output=True, check=True
    ).stdout


def write(path, data):
    target = OVERLAY / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data.encode() if isinstance(data, str) else data)


def load_subpaths():
    """Return subpaths as lists of (op, points) in SVG (y-down) coordinates."""
    pdf = (BRAND / "mira-horizontal-black.pdf").read_bytes()
    stream = zlib.decompress(re.search(rb"stream\r?\n(.*?)endstream", pdf, re.S).group(1))
    tokens = stream.decode().split()
    subpaths, current, stack = [], [], []
    for token in tokens[tokens.index("rg") + 1 :]:
        if re.fullmatch(r"-?\d*\.?\d+", token):
            stack.append(float(token))
            continue
        points = [(stack[i], 208.0 - stack[i + 1]) for i in range(0, len(stack) - 1, 2)]
        stack = []
        if token == "m":
            current = [("M", points)]
        elif token in ("l", "c"):
            current.append((token.upper(), points))
        elif token == "h":
            subpaths.append(current)
    return subpaths


def bbox(subpaths):
    xs = [p[0] for sub in subpaths for _, pts in sub for p in pts]
    ys = [p[1] for sub in subpaths for _, pts in sub for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def path_d(subpaths, scale=1.0, dx=0.0, dy=0.0, digits=1):
    def fmt(value):
        return f"{value:.{digits}f}".rstrip("0").rstrip(".")

    parts = []
    for sub in subpaths:
        for op, pts in sub:
            parts.append(
                op + " ".join(f"{fmt((x - dx) * scale)} {fmt((y - dy) * scale)}" for x, y in pts)
            )
        parts.append("Z")
    return "".join(parts)


SUBPATHS = load_subpaths()
MARK = [s for s in SUBPATHS if bbox([s])[2] < 400]
MX0, MY0, MX1, MY1 = bbox(MARK)
MARK_W, MARK_H = MX1 - MX0, MY1 - MY0
MARK_D = path_d(MARK, 1.0, MX0, MY0)
LX0, LY0, LX1, LY1 = bbox(SUBPATHS)
LOGO_W, LOGO_H = LX1 - LX0, LY1 - LY0


def fitted_path(width, height, pad=0.0, digits=2):
    """Mark path scaled and centred inside a width x height box."""
    scale = min((width - 2 * pad) / MARK_W, (height - 2 * pad) / MARK_H)
    dx = (width - MARK_W * scale) / 2 / scale
    dy = (height - MARK_H * scale) / 2 / scale
    return path_d(MARK, scale, MX0 - dx, MY0 - dy, digits)


def render_mask(subpaths, width):
    a, b, c, d = bbox(subpaths)
    doc = pymupdf.open(BRAND / "mira-horizontal-black.pdf")
    zoom = width / (c - a)
    pix = doc[0].get_pixmap(
        matrix=pymupdf.Matrix(zoom, zoom), clip=pymupdf.Rect(a, b, c, d), alpha=True
    )
    return Image.frombytes("RGBA", (pix.width, pix.height), pix.samples).getchannel("A")


HIRES_MARK = render_mask(MARK, 2400)
HIRES_LOGO = render_mask(SUBPATHS, 3200)


def paint(canvas, mask, color, box):
    bx0, by0, bx1, by1 = box
    scale = min((bx1 - bx0) / mask.width, (by1 - by0) / mask.height)
    size = (max(1, round(mask.width * scale)), max(1, round(mask.height * scale)))
    fitted = mask.resize(size, Image.Resampling.LANCZOS)
    pos = (round((bx0 + bx1 - size[0]) / 2), round((by0 + by1 - size[1]) / 2))
    canvas.paste(Image.new("RGBA", size, color), pos, fitted)


def tile(size):
    canvas = Image.new("RGBA", (size, size), BLACK)
    pad = size * 0.2
    paint(canvas, HIRES_MARK, WHITE, (pad, pad, size - pad, size - pad))
    return canvas


def png_bytes(image):
    buffer = io.BytesIO()
    image.save(buffer, "PNG", optimize=True)
    return buffer.getvalue()


def replace_tile(path):
    old = Image.open(io.BytesIO(git_bytes(path))).convert("RGBA")
    canvas = tile(max(old.size)).resize(old.size, Image.Resampling.LANCZOS)
    canvas.putalpha(old.getchannel("A"))
    write(path, png_bytes(canvas))


def write_icns(path):
    scale = 4
    base = Image.new("RGBA", (1024 * scale, 1024 * scale))
    tile_img = tile(1024).resize((824 * scale, 824 * scale), Image.Resampling.LANCZOS)
    mask = Image.new("L", tile_img.size)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, tile_img.width - 1, tile_img.height - 1), radius=185 * scale, fill=255
    )
    base.paste(tile_img, (100 * scale, 100 * scale), mask)
    types = [("icp4", 16), ("ic11", 32), ("icp5", 32), ("ic12", 64), ("ic07", 128),
             ("ic13", 256), ("ic08", 256), ("ic14", 512), ("ic09", 512), ("ic10", 1024)]
    body = b""
    for code, size in types:
        data = png_bytes(base.resize((size, size), Image.Resampling.LANCZOS))
        body += code.encode() + struct.pack(">I", len(data) + 8) + data
    write(path, b"icns" + struct.pack(">I", len(body) + 8) + body)


def write_ico(path):
    sizes = sorted(Image.open(io.BytesIO(git_bytes(path))).info["sizes"])
    buffer = io.BytesIO()
    tile(sizes[-1][0]).save(buffer, "ICO", sizes=sizes)
    write(path, buffer.getvalue())


def wordmark(path):
    size = Image.open(io.BytesIO(git_bytes(path))).size
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    paint(canvas, HIRES_LOGO, (35, 30, 30, 255), (0, 0, *size))
    write(path, png_bytes(canvas))


def svg_assets():
    mark64 = fitted_path(64, 48)
    (BRAND / "mira-mark-64.txt").write_text(mark64 + "\n", newline="\n")
    write(
        "public/buzz-mark.svg",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48" aria-hidden="true">'
        f'<path d="{mark64}" fill="black"/></svg>\n',
    )
    # Same canvas and cycle as upstream's loader, so launch.ts timing still holds.
    loading = fitted_path(466, 309, pad=40)
    write(
        "public/buzz-loading-mark.svg",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-16 -16 498 341" width="498" height="341">'
        "<title>Mira loading animation</title>"
        f'<path d="{loading}" fill="currentColor">'
        '<animate attributeName="opacity" values="0.35;1;0.35" dur="1.76s" repeatCount="indefinite"/>'
        "</path></svg>\n",
    )
    for name, color in (("black", "#000"), ("white", "#fff")):
        (BRAND / f"mira-horizontal-{name}.svg").write_text(
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {LOGO_W:.1f} {LOGO_H:.1f}" '
            f'role="img" aria-label="Mira"><path fill="{color}" '
            f'd="{path_d(SUBPATHS, 1.0, LX0, LY0)}"/></svg>\n',
            newline="\n",
        )


def main():
    for path in TILES:
        replace_tile(path)
    write_icns("src-tauri/icons/icon.icns")
    write_ico("src-tauri/icons/icon.ico")
    write_ico("public/favicon.ico")
    wordmark("public/buzz-wordmark.png")
    svg_assets()
    print(f"{len(TILES)} tiles, mark {MARK_W:.0f}x{MARK_H:.0f}")


if __name__ == "__main__":
    main()
