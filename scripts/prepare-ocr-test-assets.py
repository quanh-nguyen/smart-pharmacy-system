"""Fetch pinned, SHA-512 verified browser OCR dependencies for offline tests.

No npm install scripts run. Only named files are copied out of trusted archives.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import tarfile
import urllib.request


PACKAGES = [
    ('tesseract.js', 'https://registry.npmjs.org/tesseract.js/-/tesseract.js-5.1.1.tgz',
     'lzVl/Ar3P3zhpUT31NjqeCo1f+D5+YfpZ5J62eo2S14QNVOmHBTtbchHm/YAbOOOzCegFnKf4B3Qih9LuldcYQ==',
     {'dist/tesseract.min.js': 'tesseract.min.js', 'dist/worker.min.js': 'worker.min.js'}),
    ('tesseract.js-core', 'https://registry.npmjs.org/tesseract.js-core/-/tesseract.js-core-5.1.1.tgz',
     'KX3bYSU5iGcO1XJa+QGPbi+Zjo2qq6eBhNjSGR5E5q0JtzkoipJKOUQD7ph8kFyteCEfEQ0maWLu8MCXtvX5uQ==',
     {f'tesseract-core{variant}.{suffix}': f'tesseract-core{variant}.{suffix}'
      for variant in ['', '-lstm', '-simd', '-simd-lstm'] for suffix in ['wasm.js', 'wasm']}),
    ('vie', 'https://registry.npmjs.org/@tesseract.js-data/vie/-/vie-1.0.0.tgz',
     'hFxBtxSiCw6+64uxf0psrlLvcYA5kQimYhTSx1RwjbD5jSxe1bWg3EmipAozkzELQIFAMkJC5vu+ONGRem7YLA==',
     {'4.0.0_best_int/vie.traineddata.gz': 'vie.traineddata.gz'}),
    ('eng', 'https://registry.npmjs.org/@tesseract.js-data/eng/-/eng-1.0.0.tgz',
     'mbTumm6KQPUHyzTPQaF3ObXYnx0SqqfV2nabqFVQBwD6Kl7PhGSLSzOlfFTWy0P3BjghaSKA2W9GB19Jk+ZcTg==',
     {'4.0.0_best_int/eng.traineddata.gz': 'eng.traineddata.gz'}),
]


def prepare(output):
    output.mkdir(parents=True, exist_ok=True)
    cache = output / 'packages'
    cache.mkdir(exist_ok=True)
    provenance = []
    for name, url, expected, files in PACKAGES:
        archive_path = cache / url.rsplit('/', 1)[1]
        if archive_path.exists():
            data = archive_path.read_bytes()
        else:
            with urllib.request.urlopen(url, timeout=60) as response:
                data = response.read(32 * 1024 * 1024 + 1)
        actual = base64.b64encode(hashlib.sha512(data).digest()).decode()
        if actual != expected:
            raise RuntimeError(f'Integrity check failed for {name}; no assets from this package were copied')
        archive_path.write_bytes(data)
        with tarfile.open(archive_path) as archive:
            for source, target in files.items():
                member = archive.getmember('package/' + source)
                if not member.isfile():
                    raise RuntimeError(f'Expected a regular dependency file: {source}')
                (output / target).write_bytes(archive.extractfile(member).read())
        provenance.append({'package': name, 'url': url, 'integrity': 'sha512-' + expected})
    (output / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    print(f'Verified OCR engine and vie/eng language files: {output.resolve()}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('/tmp/smart-pharmacy-ocr-assets'))
    prepare(parser.parse_args().output)
