#!/usr/bin/env python3
"""Local Tesseract C-API helper for image-coordinate OCR crops.

Uses the already cached Audiveris libraries and local traineddata; installs nothing.
C signatures checked against the matching official header:
https://github.com/tesseract-ocr/tesseract/blob/5.5.2/include/tesseract/capi.h
PSM 6 = one text block; PSM 11 = sparse text.  TSV level-5 word boxes are
mapped from the scaled crop to original image pixels. No reference file is read.
Per-job elapsedMs excludes one-time engine initialization.
"""
from __future__ import annotations

import csv
import ctypes as ct
import io
import json
import math
from pathlib import Path
import time

from PIL import Image

WORKSPACE = Path(__file__).resolve().parents[2]
CACHE = WORKSPACE / "work/omr-runtime/user/.javacpp/cache"
TESSERACT_LIB = CACHE / "tesseract-5.5.2-1.5.13-macosx-arm64.jar/org/bytedeco/tesseract/macosx-arm64/libtesseract.5.5.dylib"
LEPTONICA_LIB = CACHE / "leptonica-1.87.0-1.5.13-macosx-arm64.jar/org/bytedeco/leptonica/macosx-arm64/libleptonica.6.dylib"
TESSDATA = WORKSPACE / "work/omr-runtime/tessdata"
# Generic notation alphabet, independent of the supplied songs or references.
MUSIC_CHARACTERS = "ABCDEFGabcdefgMmijnaodsuptlvg#b0123456789/()+-.,°øΔ♭♯"


class LocalTesseract:
    def __init__(self, lang: str, psm: int, whitelist: bool):
        self.leptonica = ct.CDLL(str(LEPTONICA_LIB), mode=ct.RTLD_GLOBAL)
        self.lib = ct.CDLL(str(TESSERACT_LIB), mode=ct.RTLD_GLOBAL)
        signatures = {
            "TessVersion": (ct.c_char_p, []),
            "TessBaseAPICreate": (ct.c_void_p, []),
            "TessBaseAPIDelete": (None, [ct.c_void_p]),
            "TessBaseAPIInit3": (ct.c_int, [ct.c_void_p, ct.c_char_p, ct.c_char_p]),
            "TessBaseAPISetPageSegMode": (None, [ct.c_void_p, ct.c_int]),
            "TessBaseAPISetVariable": (ct.c_int, [ct.c_void_p, ct.c_char_p, ct.c_char_p]),
            "TessBaseAPISetImage": (None, [ct.c_void_p, ct.POINTER(ct.c_ubyte), ct.c_int, ct.c_int, ct.c_int, ct.c_int]),
            "TessBaseAPISetSourceResolution": (None, [ct.c_void_p, ct.c_int]),
            "TessBaseAPIRecognize": (ct.c_int, [ct.c_void_p, ct.c_void_p]),
            "TessBaseAPIGetTsvText": (ct.c_void_p, [ct.c_void_p, ct.c_int]),
            "TessDeleteText": (None, [ct.c_void_p]),
            "TessBaseAPIClear": (None, [ct.c_void_p]),
            "TessBaseAPIClearAdaptiveClassifier": (None, [ct.c_void_p]),
        }
        for name, (restype, argtypes) in signatures.items():
            function = getattr(self.lib, name)
            function.restype = restype
            function.argtypes = argtypes
        self.version = self.lib.TessVersion().decode("utf-8")
        self.handle = self.lib.TessBaseAPICreate()
        if not self.handle:
            raise RuntimeError("TessBaseAPICreate returned null")
        if self.lib.TessBaseAPIInit3(self.handle, str(TESSDATA).encode(), lang.encode()) != 0:
            self.close()
            raise RuntimeError(f"Cannot initialize local traineddata: {lang}")
        self.lib.TessBaseAPISetPageSegMode(self.handle, psm)
        if whitelist:
            if not self.lib.TessBaseAPISetVariable(self.handle, b"tessedit_char_whitelist", MUSIC_CHARACTERS.encode()):
                self.close()
                raise RuntimeError("Could not set the generic music character whitelist")
        # No cross-image adaptive classifier state is retained.
        self.lib.TessBaseAPISetVariable(self.handle, b"classify_enable_learning", b"0")

    def close(self):
        if getattr(self, "handle", None):
            self.lib.TessBaseAPIDelete(self.handle)
            self.handle = None

    def read(self, image: Image.Image) -> str:
        pixels = image.convert("L")
        width, height = pixels.size
        raw = pixels.tobytes()
        buffer = (ct.c_ubyte * len(raw)).from_buffer_copy(raw)
        self.lib.TessBaseAPIClear(self.handle)
        self.lib.TessBaseAPIClearAdaptiveClassifier(self.handle)
        self.lib.TessBaseAPISetImage(self.handle, buffer, width, height, 1, width)
        self.lib.TessBaseAPISetSourceResolution(self.handle, 300)
        if self.lib.TessBaseAPIRecognize(self.handle, None) != 0:
            raise RuntimeError("Tesseract recognition failed")
        pointer = self.lib.TessBaseAPIGetTsvText(self.handle, 0)
        if not pointer:
            raise RuntimeError("TessBaseAPIGetTsvText returned null")
        try:
            return ct.string_at(pointer).decode("utf-8")
        finally:
            self.lib.TessDeleteText(pointer)


def run_job(engine, job, lang, psm, whitelist):
    started = time.perf_counter()
    with Image.open(job["image"]) as original:
        width, height = original.size
        crop = job.get("crop") or {"x": 0, "y": 0, "width": width, "height": height}
        left = max(0, math.floor(crop["x"]))
        top = max(0, math.floor(crop["y"]))
        right = min(width, math.ceil(crop["x"] + crop["width"]))
        bottom = min(height, math.ceil(crop["y"] + crop["height"]))
        if right <= left or bottom <= top:
            raise ValueError(f"Empty crop for {job['id']}")
        area = {"x": left, "y": top, "width": right-left, "height": bottom-top}
        scale = float(job.get("scale") or 1)
        if not math.isfinite(scale) or scale <= 0:
            raise ValueError(f"Invalid scale for {job['id']}")
        scaled_width = max(1, int((right-left)*scale))
        scaled_height = max(1, int((bottom-top)*scale))
        pixels = original.crop((left, top, right, bottom)).convert("L")
        pixels = pixels.resize((scaled_width, scaled_height), Image.Resampling.LANCZOS)
        tsv = engine.read(pixels)
    observations = []
    tsv_fields = ["level", "page_num", "block_num", "par_num", "line_num", "word_num", "left", "top", "width", "height", "conf", "text"]
    # GetTsvText returns data rows; the command-line TSV renderer adds the header.
    for row in csv.DictReader(io.StringIO(tsv), fieldnames=tsv_fields, delimiter="\t"):
        if row.get("level") != "5" or not row.get("text", "").strip():
            continue
        confidence = float(row["conf"])
        if confidence < 0:
            continue
        observations.append({
            "text": row["text"].strip(),
            "confidence": confidence/100,
            "box": {
                "x": left + int(row["left"])*area["width"]/scaled_width,
                "y": top + int(row["top"])*area["height"]/scaled_height,
                "width": int(row["width"])*area["width"]/scaled_width,
                "height": int(row["height"])*area["height"]/scaled_height,
            },
        })
    return {
        "id": job["id"], "width": width, "height": height,
        "crop": area, "scale": scale, "languages": [lang],
        "engine": "Tesseract " + engine.version, "psm": psm,
        "genericMusicWhitelist": whitelist,
        "elapsedMs": round((time.perf_counter()-started)*1000),
        "observations": observations, "error": None,
    }



def recognize_jobs(jobs, lang="eng", psm=11, whitelist=True):
    """Recognize image-only jobs using the local cached engine and traineddata."""
    if not jobs:
        return []
    engine = LocalTesseract(lang, psm, whitelist)
    try:
        return [run_job(engine, job, lang, psm, whitelist) for job in jobs]
    finally:
        engine.close()
