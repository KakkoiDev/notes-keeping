import json, sys, time
import laya_mlx as laya
model = sys.argv[1]; out = sys.argv[2]
agent = laya.load(model)
fx = json.load(open(sys.argv[3] if len(sys.argv)>3 else 'fixtures.json'))
LBL = ['not-mentioned','started','finished','rejected']
INS = "What does the assistant's reply say about this task: no mention of it, work on it has started, it is finished, or it is refused or dropped?"
DESC = {'not-mentioned':'the reply does not talk about this task at all, even if it reports other work',
        'started':'the reply says work on this task has begun or is partly done, more remains',
        'finished':'the reply says this task is complete and done',
        'rejected':'the reply says this task will not be done, refused, skipped or dropped'}
Q_base = {'s':{'type':'choice','instructions':INS,'criteria':LBL}}
Q_dict = {'s':{'type':'choice','instructions':INS,'criteria':DESC}}
Q_noul = {k:{'type':'noul','instructions':q} for k,q in {
 'about':'Does the assistant reply talk about this specific task?',
 'finished':'Does the reply say this specific task is finished?',
 'started':'Does the reply say work on this specific task has started but is not finished?',
 'rejected':'Does the reply say this specific task will not be done?'}.items()}
L_base = {'l':{'type':'choice','instructions':'Is this line an action the assistant should carry out, or only background and context?','criteria':['task','background']}}
L_dict = {'l':{'type':'choice','instructions':'Is this line an action the assistant should carry out, or only background and context?','criteria':{'task':'a request, instruction or requirement for the assistant to do something','background':'context, history, a fact, a thanks or a remark that asks for nothing'}}}
L_noul = {'l':{'type':'noul','instructions':'Does this line ask the assistant to do something?'}}
agent.predict('w', Q_base)
res = {}
for split, d in fx.items():
    rows = []
    for c in d['status']:
        st = f"Task: {c['todo']}\nAssistant reply: {c['reply']}"
        r = agent.predict(st, Q_base)['answers']['s']
        r2 = agent.predict(st, Q_dict)['answers']['s']
        n = agent.predict(st, Q_noul)['answers']
        rows.append({**c, 'base': r['probabilities'], 'dict': r2['probabilities'], 'noul': {k: v['noul'] for k, v in n.items()}})
    lrows = []
    for c in d['lines']:
        a = agent.predict(c['text'], L_base)['answers']['l']['probabilities']['task']
        b = agent.predict(c['text'], L_dict)['answers']['l']['probabilities']['task']
        n = agent.predict(c['text'], L_noul)['answers']['l']['noul']
        lrows.append({**c, 'base': a, 'dict': b, 'noul': n})
    res[split] = {'status': rows, 'lines': lrows}
json.dump(res, open(out, 'w'), ensure_ascii=False)
print('ok', model)
