import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path


class SourcePackageTests(unittest.TestCase):
    def module(self):
        script = Path(__file__).resolve().parents[1] / 'scripts' / 'package_source.py'
        self.assertTrue(script.exists(), 'A release needs an allowlisted source packager')
        spec = importlib.util.spec_from_file_location('source_package', script)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def fixture(self, root):
        for name in ['package.json', 'package-lock.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']:
            (root / name).write_text('{}' if name.endswith('.json') else 'public source')
        (root / 'app').mkdir()
        (root / 'app/page.tsx').write_text('export default function Page() {}')
        (root / 'desktop').mkdir()
        (root / 'desktop/launcher.py').write_text('print("start")')

    def test_only_public_source_is_archived(self):
        module = self.module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            for name in ['.env.local', 'personal.musicxml', 'settings.json', 'private.jpg']:
                (root / name).write_text('private')
            for name in ['work', 'outputs', 'node_modules', '.openai']:
                (root / name).mkdir()
                (root / name / 'private.txt').write_text('private')
            (root / 'desktop/settings.json').write_text('private')
            (root / 'desktop/__pycache__').mkdir()
            (root / 'desktop/__pycache__/launcher.pyc').write_text('cache')
            archive = root / 'release.zip'
            module.build_source_archive(root, archive)
            with zipfile.ZipFile(archive) as file:
                names = file.namelist()
                self.assertIn('chanyang-note/app/page.tsx', names)
                self.assertIn('chanyang-note/desktop/launcher.py', names)
                self.assertFalse(any('private' in name or '.env.local' in name or 'settings.json' in name or '__pycache__' in name for name in names))

    def test_symlinks_and_key_values_are_not_published(self):
        module = self.module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            outside = root / 'private-key'
            outside.write_text('private')
            (root / 'app/linked.txt').symlink_to(outside)
            with self.assertRaisesRegex(ValueError, 'symlink'):
                module.build_source_archive(root, root / 'release.zip')
            (root / 'app/linked.txt').unlink()
            (root / 'app/unsafe.ts').write_text('const key = "sk-or-v1-' + 'a' * 48 + '"')
            with self.assertRaisesRegex(ValueError, 'credential'):
                module.build_source_archive(root, root / 'release.zip')

    def test_packager_source_can_be_included_in_its_own_archive(self):
        module = self.module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            (root / 'scripts').mkdir()
            original = Path(__file__).resolve().parents[1] / 'scripts/package_source.py'
            (root / 'scripts/package_source.py').write_bytes(original.read_bytes())
            module.build_source_archive(root, root / 'release.zip')

    def test_only_designated_documentation_folders_include_raster_images(self):
        module = self.module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            public_images = [
                'docs/images/upload.png',
                'docs/screenshots/editor.jpg',
                'docs/screenshots/details/tooltip.JPEG',
            ]
            private_images = [
                'private.png', 'public/upload.jpg', 'app/user.png',
                'docs/private.png', 'docs/images-private/score.png',
                'docs/other/screenshots/score.jpg',
            ]
            retained_assets = ['public/logo.svg', 'public/fonts/serif.woff2']
            for name in public_images + private_images + retained_assets:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'fixture asset')
            archive = root / 'release.zip'
            module.build_source_archive(root, archive)
            with zipfile.ZipFile(archive) as file:
                names = set(file.namelist())
                for name in public_images + retained_assets:
                    self.assertIn('chanyang-note/' + name, names)
                for name in private_images:
                    self.assertNotIn('chanyang-note/' + name, names)

    def test_github_tokens_are_rejected_without_echoing_the_value(self):
        module = self.module()
        for prefix in ['ghp_', 'github_pat_']:
            with self.subTest(prefix=prefix), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.fixture(root)
                value = prefix + 'a' * 48
                (root / 'app/unsafe.ts').write_text('const key = "' + value + '"')
                with self.assertRaisesRegex(ValueError, 'credential') as caught:
                    module.build_source_archive(root, root / 'release.zip')
                self.assertNotIn(value, str(caught.exception))

    def test_private_keys_are_rejected_without_echoing_the_value(self):
        module = self.module()
        for kind in ['', 'RSA ', 'EC ', 'DSA ', 'OPENSSH ', 'ENCRYPTED ']:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.fixture(root)
                value = '-----BEGIN ' + kind + 'PRIVATE KEY-----\nfixture\n'
                (root / 'app/unsafe.txt').write_text(value)
                with self.assertRaisesRegex(ValueError, 'credential') as caught:
                    module.build_source_archive(root, root / 'release.zip')
                self.assertNotIn(value, str(caught.exception))

    def test_documentation_rejects_embedded_images(self):
        module = self.module()
        for name in ['README.md', 'docs/guide.md', 'docs/images/guide.html']:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.fixture(root)
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                value = 'data:' + 'image/png;base64,' + 'a' * 80
                path.write_text('<img src="' + value + '">')
                with self.assertRaisesRegex(ValueError, 'embedded image') as caught:
                    module.build_source_archive(root, root / 'release.zip')
                self.assertNotIn(value, str(caught.exception))


if __name__ == '__main__':
    unittest.main()
