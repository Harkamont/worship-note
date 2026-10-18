import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image

SCRIPT=Path(__file__).resolve().parents[1]/'scripts'/'local-text-ocr.py'

def load_runner():
    spec=importlib.util.spec_from_file_location('local_text_runner',SCRIPT)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.runner=load_runner()
        self.raw=[{'top':100,'bottom':232,'left':10,'right':490,'spacing':33,'grandstaff':True,'components':[{'top':100,'bottom':132,'left':10,'right':490,'spacing':8,'grandstaff':False},{'top':200,'bottom':232,'left':10,'right':490,'spacing':8,'grandstaff':False}]},{'top':300,'bottom':332,'left':-2,'right':490,'spacing':8,'grandstaff':False}]

    def test_regions_use_upper_five_lines_and_keep_lyric_band_above_bass(self):
        page=self.runner.build_regions(self.raw,500,700)
        first=page['staves'][0]
        self.assertEqual((first['top'],first['bottom'],first['spacing'],first['bassTop']),(100,132,8,200))
        self.assertTrue(first['grandstaff'])
        self.assertEqual(first['chordCrop'],{'x':0,'y':44,'width':500,'height':53})
        self.assertEqual(first['lyricCrop'],{'x':26,'y':143,'width':474,'height':47})
        self.assertEqual(page['staves'][1]['left'],0)
        self.assertEqual([s['index'] for s in page['staves']],[1,2])

    def test_jobs_keep_same_original_coordinate_ids_for_broad_and_tight(self):
        page=self.runner.build_regions(self.raw,500,700)
        full,bands,tight=self.runner.build_jobs(page,Path('/tmp/input.png'))
        self.assertEqual([j['scale'] for j in full],[1,3])
        self.assertEqual([j['id'] for j in bands],['image-s1-chord','image-s1-lyric','image-s2-chord','image-s2-lyric'])
        self.assertEqual([j['id'] for j in tight],['image-s1-chord','image-s2-chord'])
        self.assertGreater(tight[0]['crop']['y'],bands[0]['crop']['y'])
        self.assertEqual(tight[0]['crop']['y'],70)
        self.assertEqual(bands[1]['languages'],['ko-KR','en-US'])
        self.assertFalse(bands[1]['correction'])

    def test_pipeline_forwards_eight_inputs_and_only_grandstaff_lyrics_to_tesseract(self):
        page=self.runner.build_regions(self.raw,500,700)
        received=[]
        def processor(*args):
            received.append(args)
            return [{'index':1,'top':100,'bottom':132,'lyrics':[],'chords':[]}]
        def vision(jobs,directory):
            return [{'id':j['id'],'observations':[],'error':None} for j in jobs]
        def tess(jobs,lang,psm,whitelist):
            return [{'id':j['id'],'testLanguage':lang,'testPsm':psm,'testWhitelist':whitelist} for j in jobs]
        with tempfile.TemporaryDirectory() as directory,patch.object(self.runner,'detect_layout',return_value=(page,12)),patch.object(self.runner,'run_vision_jobs',side_effect=vision),patch.object(self.runner,'run_tesseract_jobs',side_effect=tess):
            result,metrics=self.runner.run_pipeline(Path('/tmp/input.png'),Path(directory),processor)
        self.assertEqual(len(received),1)
        args=received[0]
        self.assertEqual(len(args),8)
        self.assertEqual(args[0],page)
        self.assertEqual(args[1]['id'],'image')
        self.assertEqual(args[2]['id'],'image')
        self.assertEqual(len(args[3]),4)
        self.assertEqual(len(args[4]),2)
        self.assertEqual([j['testPsm'] for j in args[5]],[11,11])
        self.assertEqual([j['testPsm'] for j in args[6]],[11,11])
        self.assertEqual([j['id'] for j in args[7]],['image-s1-lyric'])
        self.assertEqual(args[7][0]['testLanguage'],'kor+eng')
        self.assertFalse(args[7][0]['testWhitelist'])
        self.assertEqual(set(result),{'version','engine','elapsedMs','cost','image','systems','warnings'})
        self.assertEqual(result['cost'],0)
        self.assertEqual(result['image'],{'width':500,'height':700})
        self.assertEqual(metrics['apiCalls'],0)

    def test_normalization_applies_exif_without_modifying_source_and_bounds_pixels(self):
        with tempfile.TemporaryDirectory() as directory:
            directory=Path(directory)
            source=directory/'source.jpg'
            image=Image.new('RGB',(20,30),'white')
            exif=Image.Exif();exif[274]=6
            image.save(source,exif=exif)
            original=source.read_bytes()
            normalized=self.runner.normalize_input(source,directory)
            with Image.open(normalized) as result:
                self.assertEqual(result.size,(30,20))
                self.assertEqual(result.format,'PNG')
            self.assertEqual(source.read_bytes(),original)
        with self.assertRaises(ValueError):self.runner.check_image_size(3000,3000)
        with self.assertRaises(ValueError):self.runner.check_image_size(0,100)

    def test_missing_optional_tesseract_keeps_job_ids_for_the_postprocessor(self):
        page=self.runner.build_regions(self.raw,500,700)
        received=[]
        def processor(*args):received.append(args);return []
        def vision(jobs,directory):return [{'id':j['id'],'observations':[],'error':None} for j in jobs]
        with tempfile.TemporaryDirectory() as directory,patch.object(self.runner,'detect_layout',return_value=(page,1)),patch.object(self.runner,'run_vision_jobs',side_effect=vision),patch.object(self.runner,'run_tesseract_jobs',side_effect=OSError('Unavailable native library')):
            result,_=self.runner.run_pipeline(Path('/tmp/input.png'),Path(directory),processor)
        self.assertEqual([len(group) for group in received[0][5:]],[2,2,1])
        self.assertEqual(received[0][5][0]['id'],'image-s1-chord')
        self.assertEqual(received[0][5][0]['observations'],[])
        self.assertTrue(any('보조' in warning for warning in result['warnings']))

if __name__=='__main__':
    unittest.main()
