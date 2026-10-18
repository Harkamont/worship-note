import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from local_text_processing import chord_observations, choose_lyrics
class ProcessingRegressionTests(unittest.TestCase):
 def test_empty_auxiliary_hymn_result_keeps_available_vision_text(self):
  staff={'spacing':5,'grandstaff':True,'lyricCrop':{'x':0,'y':20,'width':200,'height':80}}
  raw={'observations':[{'text':'가사','box':{'x':20,'y':30,'width':40,'height':15},'confidence':1}]}
  rows=choose_lyrics(staff,raw,raw,raw,{'observations':[]})
  self.assertEqual([r['text'] for r in rows],['가사'])
 def test_parenthetical_chord_extensions_and_optional_wrappers_survive(self):
  for value in ['C(add9)','D(7)','F#m7(b5)','(Bm7)']:
   ob={'text':value,'box':{'x':30,'y':40,'width':60,'height':14},'confidence':1}
   self.assertEqual([c['text'] for c in chord_observations([ob])],[value[1:-1] if value=='(Bm7)' else value])
 def test_zero_sized_space_does_not_move_spaced_minor_chord(self):
  ob={'text':'B m7','box':{'x':450,'y':140,'width':50,'height':16},'confidence':1,'characters':[
   {'text':'B','box':{'x':450,'y':140,'width':16,'height':16}},
   {'text':' ','box':{'x':0,'y':89,'width':0,'height':0}},
   {'text':'m','box':{'x':470,'y':140,'width':30,'height':16}},
   {'text':'7','box':{'x':470,'y':140,'width':30,'height':16}}]}
  codes=chord_observations([ob]);self.assertEqual(codes[0]['text'],'Bm7');self.assertEqual(codes[0]['x'],475);self.assertEqual(codes[0]['y'],148)
if __name__=='__main__':unittest.main()
