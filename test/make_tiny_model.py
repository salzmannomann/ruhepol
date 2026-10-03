"""Erzeugt ein winziges BERT-artiges Embedding-Modell für die automatischen Tests.

Aufbau wie ein echtes transformers.js-Modell (config.json, tokenizer.json, onnx/…),
aber mit 16 Dimensionen und einem kleinen Wortschatz, dessen Wörter in Themen-Gruppen
liegen (Klima, Wohnen, Krieg, Neutral, Frieden). So lässt sich die ganze Kette in Chrome testen:
Laufzeit laden → Tokenizer → ONNX → Mean-Pooling → Entscheidung.

Aufruf: python3 test/make_tiny_model.py   (braucht: pip install onnx numpy)
"""
import json
import os

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

OUT = os.path.join(os.path.dirname(__file__), 'fixtures', 'tiny-model')
DIM = 16

GROUPS = {
    0: 'klimakrise klimawandel gletscher schmelzen co2 hitze durre erderwarmung emissionen climate meeresspiegel',
    1: 'wohnungskrise wohnungen mieten miete wohnbau familien leistbare',
    2: 'krieg soldaten panzer front raketen luftangriffe war bombardierung',
    3: 'kultur konzert theater museum musik sport wetter sonnig ausflug radwege bahnstrecke',
    4: 'frieden waffenstillstand einigung',
}

special = ['[PAD]', '[UNK]', '[CLS]', '[SEP]', '[MASK]']
vocab = {t: i for i, t in enumerate(special)}
group_of = {}
for g, words in GROUPS.items():
    for w in words.split():
        vocab[w] = len(vocab)
        group_of[w] = g
for p in list(',.:;!?-–()"\'') + ['query']:
    if p not in vocab:
        vocab[p] = len(vocab)

rng = np.random.default_rng(42)
emb = np.zeros((len(vocab), DIM), dtype=np.float32)
for w, i in vocab.items():
    if w in group_of:
        emb[i, group_of[w]] = 1.0
        emb[i, 5:] = rng.normal(0, 0.05, DIM - 5)

ids = helper.make_tensor_value_info('input_ids', TensorProto.INT64, ['batch', 'seq'])
mask = helper.make_tensor_value_info('attention_mask', TensorProto.INT64, ['batch', 'seq'])
types = helper.make_tensor_value_info('token_type_ids', TensorProto.INT64, ['batch', 'seq'])
out = helper.make_tensor_value_info('last_hidden_state', TensorProto.FLOAT, ['batch', 'seq', DIM])
table = numpy_helper.from_array(emb, name='embeddings')
node = helper.make_node('Gather', ['embeddings', 'input_ids'], ['last_hidden_state'], axis=0)
graph = helper.make_graph([node], 'tiny', [ids, mask, types], [out], [table])
model = helper.make_model(graph, opset_imports=[helper.make_opsetid('', 13)])
model.ir_version = 8
onnx.checker.check_model(model)
os.makedirs(os.path.join(OUT, 'onnx'), exist_ok=True)
onnx.save(model, os.path.join(OUT, 'onnx', 'model_quantized.onnx'))

with open(os.path.join(OUT, 'config.json'), 'w') as f:
    json.dump({'model_type': 'bert', 'architectures': ['BertModel'], 'hidden_size': DIM,
               'vocab_size': len(vocab), 'max_position_embeddings': 512}, f, indent=2)

added = [{'id': vocab[t], 'content': t, 'single_word': False, 'lstrip': False, 'rstrip': False,
          'normalized': False, 'special': True} for t in special]
tokenizer = {
    'version': '1.0', 'truncation': None, 'padding': None, 'added_tokens': added,
    'normalizer': {'type': 'BertNormalizer', 'clean_text': True, 'handle_chinese_chars': True,
                   'strip_accents': True, 'lowercase': True},
    'pre_tokenizer': {'type': 'BertPreTokenizer'},
    'post_processor': {
        'type': 'TemplateProcessing',
        'single': [{'SpecialToken': {'id': '[CLS]', 'type_id': 0}}, {'Sequence': {'id': 'A', 'type_id': 0}},
                   {'SpecialToken': {'id': '[SEP]', 'type_id': 0}}],
        'pair': [{'SpecialToken': {'id': '[CLS]', 'type_id': 0}}, {'Sequence': {'id': 'A', 'type_id': 0}},
                 {'SpecialToken': {'id': '[SEP]', 'type_id': 0}}, {'Sequence': {'id': 'B', 'type_id': 1}},
                 {'SpecialToken': {'id': '[SEP]', 'type_id': 1}}],
        'special_tokens': {
            '[CLS]': {'id': '[CLS]', 'ids': [vocab['[CLS]']], 'tokens': ['[CLS]']},
            '[SEP]': {'id': '[SEP]', 'ids': [vocab['[SEP]']], 'tokens': ['[SEP]']},
        },
    },
    'decoder': {'type': 'WordPiece', 'prefix': '##', 'cleanup': True},
    'model': {'type': 'WordPiece', 'unk_token': '[UNK]', 'continuing_subword_prefix': '##',
              'max_input_chars_per_word': 100, 'vocab': vocab},
}
with open(os.path.join(OUT, 'tokenizer.json'), 'w') as f:
    json.dump(tokenizer, f, ensure_ascii=False)
with open(os.path.join(OUT, 'tokenizer_config.json'), 'w') as f:
    json.dump({'tokenizer_class': 'BertTokenizer', 'do_lower_case': True, 'model_max_length': 512,
               'cls_token': '[CLS]', 'sep_token': '[SEP]', 'pad_token': '[PAD]', 'unk_token': '[UNK]',
               'mask_token': '[MASK]'}, f, indent=2)
with open(os.path.join(OUT, 'special_tokens_map.json'), 'w') as f:
    json.dump({'cls_token': '[CLS]', 'sep_token': '[SEP]', 'pad_token': '[PAD]', 'unk_token': '[UNK]',
               'mask_token': '[MASK]'}, f, indent=2)
print('Testmodell geschrieben:', OUT, f'({len(vocab)} Wörter, {DIM} Dimensionen)')
