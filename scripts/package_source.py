"""Create the public source ZIP from an explicit allowlist, never the workspace."""
import argparse
import json
import re
import zipfile
from pathlib import Path

ROOT_FILES = {
    'package.json', 'package-lock.json', 'README.md', 'LICENSE',
    'THIRD_PARTY_NOTICES.md', 'CONTRIBUTING.md', '.env.example', '.gitignore',
    'tsconfig.json', 'next.config.ts', 'vite.config.ts', 'postcss.config.mjs',
    'eslint.config.mjs', 'cloudflare-env.d.ts', 'components.json',
}
DIRECTORIES = {'app', 'components', 'lib', 'public', 'scripts', 'desktop',
               'tests', 'docs', 'build', 'db', 'hooks', 'vendor', '.github'}
EXTENSIONS = {'.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.cjs', '.py', '.md',
              '.txt', '.json', '.css', '.svg', '.sh', '.command', '.cmd', '.yml',
              '.yaml', '.toml', '.spec', '.html', '.d.ts', '.woff2'}
DOCUMENT_IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg'}
DOCUMENT_IMAGE_DIRECTORIES = {'images', 'screenshots'}
BLOCKED_NAMES = {'settings.json', 'manifest.local.json', '__pycache__',
                 'node_modules', 'dist', 'release', 'releases', 'runtime', '.git'}
REQUIRED = {'package.json', 'package-lock.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md'}
CREDENTIAL = re.compile(rb'(?:sk-or-v1-|sk-proj-|ghp_|github_pat_)[A-Za-z0-9_-]{20,}')
PRIVATE_KEY = re.compile(rb'-----BEGIN (?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED) )?PRIVATE KEY-----')
INLINE_IMAGE = re.compile(rb'data:image/[^,\s]+;base64,', re.IGNORECASE)


def source_files(root: Path):
    root = root.resolve()
    private_home = str(Path.home()).encode('utf-8') + b'/'
    files = []
    for path in sorted(root.rglob('*')):
        relative = path.relative_to(root)
        parts = relative.parts
        if parts[0] not in ROOT_FILES and parts[0] not in DIRECTORIES:
            continue
        if any(part in BLOCKED_NAMES or (part.startswith('.') and part not in {'.github', '.env.example', '.gitignore'}) for part in parts):
            continue
        if path.is_symlink():
            raise ValueError('Release source contains a symlink: ' + str(relative))
        if not path.is_file():
            continue
        document_image = (len(parts) > 2 and parts[0] == 'docs'
                          and parts[1] in DOCUMENT_IMAGE_DIRECTORIES
                          and path.suffix.lower() in DOCUMENT_IMAGE_EXTENSIONS)
        if len(parts) > 1 and path.suffix not in EXTENSIONS and not document_image:
            continue
        content = path.read_bytes()
        if CREDENTIAL.search(content) or PRIVATE_KEY.search(content) or private_home in content:
            raise ValueError('Release source contains a credential or private developer path: ' + str(relative))
        if (parts[0] == 'docs' or relative.name == 'README.md') and INLINE_IMAGE.search(content):
            raise ValueError('Release documentation contains an embedded image; use a reviewed docs image file: ' + str(relative))
        files.append((relative, content, path.stat().st_mode))
    missing = REQUIRED - {str(relative) for relative, _, _ in files}
    if missing:
        raise ValueError('Missing public release files: ' + ', '.join(sorted(missing)))
    return files


def build_source_archive(root: Path, output: Path):
    files = source_files(Path(root))
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for relative, content, mode in files:
            entry = zipfile.ZipInfo('chanyang-note/' + relative.as_posix())
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = (mode & 0xFFFF) << 16
            archive.writestr(entry, content)
    return {'files': len(files), 'bytes': output.stat().st_size, 'archive': str(output)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Create a clean public source release')
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--output', type=Path, required=True)
    arguments = parser.parse_args()
    print(json.dumps(build_source_archive(arguments.root, arguments.output), ensure_ascii=False))
