#!/usr/bin/env python3
"""Local image-only lyric/chord OCR, independent of melody transcription.

Usage: local-text-ocr.py input.png output.json
HOMR supplies staff geometry only. Apple Vision and locally cached Tesseract read
text; no network model, song dictionary, reference score or training is used.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import time

MAX_PIXELS = 4_000_000
MAX_SIDE = 2500


def check_image_size(width, height):
    if width < 1 or height < 1 or width > MAX_SIDE or height > MAX_SIDE or width*height > MAX_PIXELS:
        raise ValueError('Local text OCR accepts up to 4 million pixels and 2500 pixels per side')


def normalize_input(image_path, directory):
    from PIL import Image, ImageOps
    normalized = directory/'normalized.png'
    with Image.open(image_path) as image:
        check_image_size(*image.size)
        ImageOps.exif_transpose(image).convert('RGB').save(normalized)
    return normalized


def mapped_staff(staff, mapping):
    corners = [mapping((float(x), float(y)))
               for x in (staff.min_x, staff.max_x)
               for y in (staff.min_y, staff.max_y)]
    left = min(p[0] for p in corners)
    right = max(p[0] for p in corners)
    top = min(p[1] for p in corners)
    bottom = max(p[1] for p in corners)
    item = {'top': top, 'bottom': bottom, 'left': left, 'right': right,
            'spacing': (bottom-top)/4, 'grandstaff': bool(staff.is_grandstaff)}
    if staff.is_grandstaff:
        parts = staff.split()
        if parts:
            item['components'] = [mapped_staff(part, mapping) for part in parts]
    return item


def crop_box(left, top, right, bottom, width, height):
    x = max(0, min(width-1, math.floor(left)))
    y = max(0, min(height-1, math.floor(top)))
    end_x = max(x+1, min(width, math.floor(right)))
    end_y = max(y+1, min(height, math.floor(bottom)))
    return {'x': x, 'y': y, 'width': end_x-x, 'height': end_y-y}


def build_regions(raw_staves, width, height):
    raw_staves = sorted(raw_staves, key=lambda s: (s['top'], s['left']))
    entries = []
    for index, staff in enumerate(raw_staves, 1):
        if staff.get('grandstaff') and len(staff.get('components', [])) == 2:
            upper, bass = staff['components']
            entry = {**upper, 'grandstaff': True, 'bassTop': bass['top']}
        else:
            entry = {**staff}
            entry.pop('components', None)
        entry.update(index=index, left=max(0, entry['left']), right=min(width, entry['right']))
        entries.append(entry)
    for i, staff in enumerate(entries):
        d = staff['spacing']
        if not math.isfinite(d) or d <= 0:
            raise ValueError('Invalid detected staff spacing')
        previous = raw_staves[i-1]['bottom'] if i else 0
        next_top = entries[i+1]['top'] if i+1 < len(entries) else height
        chord_top = max(0, staff['top']-7*d, previous+d)
        chord_bottom = staff['top']-.35*d
        staff['chordCrop'] = crop_box(0, chord_top, width, chord_bottom, width, height)
        staff['lyricCrop'] = crop_box(staff['left']+2*d, staff['bottom']+1.4*d,
                                      width, min(height, staff.get('bassTop', next_top)-1.2*d),
                                      width, height)
    return {'id': 'image', 'width': width, 'height': height, 'staves': entries}


def detect_layout(image_path):
    import cv2
    from homr.main import ProcessingConfig, detect_staffs_in_image
    from homr.onnx_providers import coreml_available, cuda_available, rocm_available
    image = cv2.imread(str(image_path))
    if image is None:
        raise ValueError('Cannot read image')
    height, width = image.shape[:2]
    config = ProcessingConfig(enable_debug=False, enable_cache=False,
                              write_staff_positions=False, read_staff_positions=False,
                              selected_staff=-1,
                              transformer_use_gpu=(cuda_available() or rocm_available()),
                              segnet_use_gpu=(cuda_available() or rocm_available() or coreml_available()),
                              coreml_encoder=False, title_detection=False)
    started = time.perf_counter()
    groups, _, _, _, _, mapping = detect_staffs_in_image(str(image_path), config)
    raw_staves = [mapped_staff(staff, mapping) for group in groups for staff in group.staffs]
    if not raw_staves:
        raise ValueError('No staffs detected')
    layout = build_regions(raw_staves, width, height)
    return layout, round((time.perf_counter()-started)*1000)


def build_jobs(layout, image_path):
    image = str(image_path.resolve())
    full = [{'id': 'image', 'image': image, 'languages': ['ko-KR', 'en-US'],
             'correction': True, 'scale': scale} for scale in (1, 3)]
    bands = []
    tight = []
    for staff in layout['staves']:
        d = staff['spacing']
        scale = max(1.5, min(4.5, 28/(1.6*d)))
        for kind, languages in [('chord', ['en-US']), ('lyric', ['ko-KR', 'en-US'])]:
            job = {'id': f"image-s{staff['index']}-{kind}", 'image': image,
                   'languages': languages, 'correction': False,
                   'scale': scale, 'crop': staff[kind+'Crop']}
            bands.append(job)
        broad = staff['chordCrop']
        narrow_top = max(broad['y'], math.floor(staff['top']-3.7*d))
        narrow = crop_box(broad['x'], narrow_top, broad['x']+broad['width'],
                          broad['y']+broad['height'], layout['width'], layout['height'])
        tight.append({'id': f"image-s{staff['index']}-chord", 'image': image,
                      'languages': ['en-US'], 'correction': False,
                      'scale': scale, 'crop': narrow})
    return full, bands, tight


def run_vision_jobs(jobs, directory):
    jobs_path = directory/'vision-jobs.json'
    output_path = directory/'vision-results.json'
    jobs_path.write_text(json.dumps(jobs, ensure_ascii=False), encoding='utf-8')
    binary = Path(__file__).with_name('vision-ocr')
    subprocess.run([str(binary), str(jobs_path), str(output_path)], check=True,
                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=55)
    results = json.loads(output_path.read_text(encoding='utf-8'))
    if not isinstance(results, list) or len(results) != len(jobs):
        raise ValueError('Local Vision returned an incomplete batch')
    return results


def run_tesseract_jobs(jobs, lang, psm, whitelist):
    from local_tesseract import recognize_jobs
    return recognize_jobs(jobs, lang=lang, psm=psm, whitelist=whitelist)


def run_pipeline(image_path, directory, processor, reviewer=None):
    started = time.perf_counter()
    layout, detection_ms = detect_layout(image_path)
    full, bands, tight = build_jobs(layout, image_path)
    vision_start = time.perf_counter()
    results = run_vision_jobs(full+bands+tight, directory)
    vision_ms = round((time.perf_counter()-vision_start)*1000)
    raw_full1, raw_full3 = results[:2]
    raw_bands = results[2:2+len(bands)]
    raw_tight = results[2+len(bands):]
    warnings = ['로컬 가사·코드 인식 결과입니다. 음표에 자동으로 붙이지 않았으므로 원본과 대조해 확인해 주세요.']
    failed_vision = sum(bool(r.get('error')) for r in results)
    if failed_vision:
        warnings.append(f'일부 이미지 영역 {failed_vision}개의 글자 인식을 완료하지 못했습니다.')
    tesseract_start = time.perf_counter()
    broad_chords = [job for job in bands if job['id'].endswith('-chord')]
    grand_indices = {staff['index'] for staff in layout['staves'] if staff['grandstaff']}
    grand_lyrics = [job for job in bands if job['id'].endswith('-lyric')
                    and int(job['id'].split('-s', 1)[1].split('-', 1)[0]) in grand_indices]
    tess_groups = []
    for jobs, lang, psm, whitelist in [(broad_chords, 'eng', 11, True),
                                       (tight, 'eng', 11, True),
                                       (grand_lyrics, 'kor+eng', 6, False)]:
        try:
            tess_groups.append(run_tesseract_jobs(jobs, lang, psm, whitelist))
        except (OSError, RuntimeError, ValueError):
            tess_groups.append([{'id':job['id'], 'observations':[], 'error':'Local auxiliary OCR unavailable'} for job in jobs])
            warnings.append('일부 로컬 보조 인식 결과를 얻지 못해 나머지 인식 결과를 사용했습니다.')
    tesseract_ms = round((time.perf_counter()-tesseract_start)*1000)
    processing_start = time.perf_counter()
    systems = processor(layout, raw_full1, raw_full3, raw_bands, raw_tight, *tess_groups)
    if reviewer is not None:
        warnings.extend(reviewer(layout, raw_full1, raw_full3, raw_bands))
    processing_ms = round((time.perf_counter()-processing_start)*1000)
    result = {'version': 1, 'engine': 'Apple Vision + HOMR layout + Tesseract',
              'elapsedMs': round((time.perf_counter()-started)*1000), 'cost': 0,
              'image': {'width': layout['width'], 'height': layout['height']},
              'systems': systems, 'warnings': list(dict.fromkeys(warnings))}
    metrics = {'detectionMs': detection_ms, 'visionMs': vision_ms,
               'tesseractMs': tesseract_ms, 'processingMs': processing_ms,
               'visionJobs': len(results), 'staffCount': len(layout['staves']),
               'grandstaffCount': len(grand_indices),
               'tesseractJobCounts': [len(group) for group in tess_groups],
               'apiCalls': 0, 'apiCostUsd': 0}
    return result, metrics


def main():
    if len(sys.argv) != 3:
        raise SystemExit('Usage: local-text-ocr.py input.png output.json')
    from local_text_processing import process, review_warnings
    image_path = Path(sys.argv[1]).resolve()
    output_path = Path(sys.argv[2]).resolve()
    total_start = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix='local-text-ocr-') as temporary:
        directory = Path(temporary)
        normalized = normalize_input(image_path, directory)
        result, metrics = run_pipeline(normalized, directory, process, review_warnings)
    result['elapsedMs'] = round((time.perf_counter()-total_start)*1000)
    output_path.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False)+'\n', encoding='utf-8')
    metrics['elapsedMs'] = result['elapsedMs']
    output_path.with_suffix('.metrics.json').write_text(json.dumps(metrics, ensure_ascii=False, allow_nan=False)+'\n', encoding='utf-8')


if __name__ == '__main__':
    main()
