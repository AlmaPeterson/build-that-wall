"""Turn assets/project.json into readable text, so the game's blocks can be read, searched and diffed.

Usage (from the repo root):  python3 -I tools/dump-project.py [project.json] [out-dir]
Writes one file per sprite (docs/project-dump/<Sprite>.txt) plus _globals.txt.
The text is close to scratchblocks: (round) reporters, <pointy> booleans, [square] fields.
"""
import json
import os
import re
import sys
from collections import defaultdict

SRC = sys.argv[1] if len(sys.argv) > 1 else 'assets/project.json'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'docs/project-dump'
IND = '    '

# Simple reporters and stack blocks: opcode -> template. {NAME} is an input or field.
T = {
    # events
    'event_whenflagclicked': 'when green flag clicked',
    'event_whenbroadcastreceived': 'when I receive [{BROADCAST_OPTION}]',
    'event_whenkeypressed': 'when [{KEY_OPTION}] key pressed',
    'event_whenstageclicked': 'when stage clicked',
    'event_whenthisspriteclicked': 'when this sprite clicked',
    'event_whenstopclicked': 'when stop clicked',
    'event_always': 'always (runs every frame)',
    'event_broadcast': 'broadcast {BROADCAST_INPUT}',
    'event_broadcastandwait': 'broadcast {BROADCAST_INPUT} and wait',
    'control_start_as_clone': 'when I start as a clone',
    # control
    'control_wait': 'wait {DURATION} seconds',
    'control_wait_until': 'wait until {CONDITION}',
    'control_stop': 'stop [{STOP_OPTION}]',
    'control_create_clone_of': 'create clone of {CLONE_OPTION}',
    'control_create_clone_of_menu': '[{CLONE_OPTION}]',
    'control_delete_clones_of': 'delete clones of {CLONE_OPTION}',
    'control_delete_this_clone': 'delete this clone',
    'control_if_return_else_return': '(if {boolean} then {TEXT1} else {TEXT2})',
    # data
    'data_setvariableto': 'set [{VARIABLE}] to {VALUE}',
    'data_changevariableby': 'change [{VARIABLE}] by {VALUE}',
    'data_hidevariable': 'hide variable [{VARIABLE}]',
    'data_showvariable': 'show variable [{VARIABLE}]',
    'data_addtolist': 'add {ITEM} to [{LIST}]',
    'data_deleteoflist': 'delete {INDEX} of [{LIST}]',
    'data_deletealloflist': 'delete all of [{LIST}]',
    'data_insertatlist': 'insert {ITEM} at {INDEX} of [{LIST}]',
    'data_replaceitemoflist': 'replace item {INDEX} of [{LIST}] with {ITEM}',
    'data_itemoflist': '(item {INDEX} of [{LIST}])',
    'data_itemnumoflist': '(item # of {ITEM} in [{LIST}])',
    'data_lengthoflist': '(length of [{LIST}])',
    'data_listcontainsitem': '<[{LIST}] contains {ITEM}?>',
    'data_listcontents': '([{LIST}] as text)',
    # operators
    'operator_add': '({NUM1} + {NUM2})',
    'operator_subtract': '({NUM1} - {NUM2})',
    'operator_multiply': '({NUM1} * {NUM2})',
    'operator_divide': '({NUM1} / {NUM2})',
    'operator_mod': '({NUM1} mod {NUM2})',
    'operator_random': '(pick random {FROM} to {TO})',
    'operator_gt': '<{OPERAND1} > {OPERAND2}>',
    'operator_lt': '<{OPERAND1} < {OPERAND2}>',
    'operator_equals': '<{OPERAND1} = {OPERAND2}>',
    'operator_notequal': '<{OPERAND1} != {OPERAND2}>',
    'operator_and': '<{OPERAND1} and {OPERAND2}>',
    'operator_or': '<{OPERAND1} or {OPERAND2}>',
    'operator_not': '<not {OPERAND}>',
    'operator_join': '(join {STRING1} {STRING2})',
    'operator_letter_of': '(letter {LETTER} of {STRING})',
    'operator_length': '(length of {STRING})',
    'operator_round': '(round {NUM})',
    'operator_mathop': '([{OPERATOR}] of {NUM})',
    # looks
    'looks_show': 'show',
    'looks_hide': 'hide',
    'looks_switchcostumeto': 'switch costume to {COSTUME}',
    'looks_costume': '[{COSTUME}]',
    'looks_switchbackdropto': 'switch backdrop to {BACKDROP}',
    'looks_backdrops': '[{BACKDROP}]',
    'looks_costumenumbername': '(costume [{NUMBER_NAME}])',
    'looks_gotofrontback': 'go to [{FRONT_BACK}] layer',
    'looks_setsizeto': 'set size to {SIZE} %',
    'looks_size': '(size)',
    'looks_seteffectto': 'set [{EFFECT}] effect to {VALUE}',
    'looks_cleargraphiceffects': 'clear graphic effects',
    # motion
    'motion_gotoxy': 'go to x: {X} y: {Y}',
    'motion_changebyxy': 'change x by {DX} y by {DY}',
    'motion_glidesecstoxy': 'glide {SECS} secs to x: {X} y: {Y}',
    'motion_setx': 'set x to {X}',
    'motion_sety': 'set y to {Y}',
    'motion_xposition': '(x position)',
    'motion_yposition': '(y position)',
    # sensing
    'sensing_mousedown': '<mouse down?>',
    'sensing_mousex': '(mouse x)',
    'sensing_mousey': '(mouse y)',
    'sensing_timer': '(timer)',
    'sensing_dayssince2000': '(days since 2000)',
    'sensing_of': '([{PROPERTY}] of {OBJECT})',
    'sensing_of_object_menu': '[{OBJECT}]',
    'sensing_touchingobject': '<touching {TOUCHINGOBJECTMENU}?>',
    'sensing_touchingobjectmenu': '[{TOUCHINGOBJECTMENU}]',
    'pmSensingExpansion_getButtonIsDown': '<[{MOUSE_BUTTON}] mouse button down?>',
    'pmSensingExpansion_menu_mouseButton': '[{mouseButton}]',
    # sound and pen
    'sound_play': 'start sound {SOUND_MENU}',
    'sound_sounds_menu': '[{SOUND_MENU}]',
    'pen_clear': 'erase all',
    'pen_drawUriImageWHR': 'draw image {URI} at x: {X} y: {Y} width: {WIDTH} height: {HEIGHT} rotated: {ROTATE}',
}
C_BLOCKS = {'control_forever': 'forever', 'control_repeat': 'repeat {TIMES}',
            'control_repeat_until': 'repeat until {CONDITION}', 'control_if': 'if {CONDITION} then',
            'control_all_at_once': 'all at once'}
HATS = {k for k in T if k.startswith('event_when') or k in ('event_always', 'control_start_as_clone')}


def lit(v):
    """A typed-in value: numbers stay round, text gets square brackets."""
    s = str(v)
    if len(s) > 120 and s.startswith('data:'):
        s = s[:40] + '…(%d chars)' % len(s)
    if re.fullmatch(r'-?\d+(\.\d+)?', s):
        return '(%s)' % s
    return '[%s]' % s.replace('\n', '\\n')


class Dumper:
    def __init__(self, target):
        self.t = target
        self.b = target['blocks']

    def prim(self, p):
        kind = p[0]
        if kind in (4, 5, 6, 7, 8, 9, 10):
            return lit(p[1])
        if kind == 11:
            return '[%s]' % p[1]
        if kind == 12:
            return '(%s)' % p[1]
        if kind == 13:
            return '([%s] as text)' % p[1]
        return '?%r' % (p,)

    def inp(self, block, name):
        """The text of one input slot (a nested block, a variable or a typed value)."""
        i = block.get('inputs', {}).get(name)
        if i is None:
            return '<>' if name.upper() in ('CONDITION', 'BOOLEAN', 'OPERAND') else '()'
        v = i[1]
        if isinstance(v, list):
            return self.prim(v)
        if v is None:
            return '()' if len(i) < 3 else self.slot(i[2])
        return self.expr(v)

    def slot(self, v):
        if isinstance(v, list):
            return self.prim(v)
        return self.expr(v) if v else '()'

    def field(self, block, name):
        f = block.get('fields', {}).get(name)
        return str(f[0]) if f else ''

    def fill(self, tmpl, block):
        def rep(m):
            k = m.group(1)
            if k in block.get('inputs', {}):
                return self.inp(block, k)
            if k in block.get('fields', {}):
                return self.field(block, k)
            return self.inp(block, k)
        return re.sub(r'\{([^}]+)\}', rep, tmpl)

    def proc_text(self, block, defining):
        m = block['mutation']
        code = m['proccode']
        ids = json.loads(m.get('argumentids') or '[]')
        if defining:
            names = json.loads(m.get('argumentnames') or '[]')
            args = ['(%s)' % n for n in names]
        else:
            args = [self.inp(block, a) for a in ids]
        parts = re.split(r'(%[sbn])', code)
        out, n = [], 0
        for part in parts:
            if part in ('%s', '%b', '%n'):
                out.append(args[n] if n < len(args) else '()')
                n += 1
            else:
                out.append(part)
        return ''.join(out).strip()

    def generic(self, block):
        """Extension blocks: ext.opcode NAME:(value) ..."""
        op = block['opcode']
        ext, _, name = op.partition('_')
        bits = ['%s.%s' % (ext, name)]
        for k in block.get('fields', {}):
            bits.append('%s:[%s]' % (k, self.field(block, k)))
        for k in block.get('inputs', {}):
            if k.startswith('SUBSTACK'):
                continue
            bits.append('%s:%s' % (k, self.inp(block, k)))
        return ' '.join(bits)

    def expr(self, bid):
        """A reporter or boolean, written inline."""
        block = self.b.get(bid)
        if block is None:
            return '(?missing)'
        if isinstance(block, list):
            return self.prim(block)
        op = block['opcode']
        if op == 'argument_reporter_string_number' or op == 'argument_reporter_boolean':
            return '(%s)' % self.field(block, 'VALUE')
        if op == 'procedures_call':
            return '(call %s)' % self.proc_text(block, False)
        if op == 'checkbox':
            return '<%s>' % self.field(block, 'CHECKBOX').lower()
        if op in T:
            return self.fill(T[op], block)
        if block.get('shadow') and len(block.get('fields', {})) == 1 and not block.get('inputs'):
            return '[%s]' % next(iter(block['fields'].values()))[0]
        return '(%s)' % self.generic(block)

    def stack(self, bid, depth, out):
        while bid:
            block = self.b.get(bid)
            if not isinstance(block, dict):
                break
            self.stmt(block, depth, out)
            bid = block.get('next')

    def sub(self, block, name, depth, out):
        i = block.get('inputs', {}).get(name)
        if i and isinstance(i[1], str):
            self.stack(i[1], depth, out)

    def stmt(self, block, depth, out):
        op = block['opcode']
        pad = IND * depth
        if op in C_BLOCKS:
            out.append(pad + self.fill(C_BLOCKS[op], block))
            self.sub(block, 'SUBSTACK', depth + 1, out)
            out.append(pad + 'end')
        elif op == 'control_if_else':
            out.append(pad + 'if %s then' % self.inp(block, 'CONDITION'))
            self.sub(block, 'SUBSTACK', depth + 1, out)
            out.append(pad + 'else')
            self.sub(block, 'SUBSTACK2', depth + 1, out)
            out.append(pad + 'end')
        elif op == 'control_expandableIf':
            m = block.get('mutation', {})
            n = int(m.get('branches', '1'))
            for k in range(1, n + 1):
                out.append(pad + ('if' if k == 1 else 'else if') + ' %s then' % self.inp(block, 'BOOL%d' % k))
                self.sub(block, 'SUBSTACK%d' % k, depth + 1, out)
            if m.get('ends-in-else') == 'true':
                out.append(pad + 'else')
                self.sub(block, 'SUBSTACK%d' % (n + 1), depth + 1, out)
            out.append(pad + 'end')
        elif op == 'procedures_definition':
            proto = self.b[block['inputs']['custom_block'][1]]
            warp = proto['mutation'].get('warp') == 'true'
            out.append(pad + 'define %s%s' % (self.proc_text(proto, True), '  (run without screen refresh)' if warp else ''))
        elif op == 'procedures_call':
            out.append(pad + 'call ' + self.proc_text(block, False))
        elif op in T:
            out.append(pad + self.fill(T[op], block))
        else:
            out.append(pad + self.generic(block))
            for k in sorted(block.get('inputs', {})):
                if k.startswith('SUBSTACK'):
                    self.sub(block, k, depth + 1, out)

    def scripts(self):
        tops = [(k, v) for k, v in self.b.items() if isinstance(v, dict) and v.get('topLevel') and not v.get('shadow')]
        # Sort: event scripts first, then custom block definitions by name, then loose blocks; ties by position
        def key(kv):
            k, v = kv
            op = v['opcode']
            if op == 'procedures_definition':
                name = self.b[v['inputs']['custom_block'][1]]['mutation']['proccode']
                return (1, name.lower(), v.get('y', 0), v.get('x', 0))
            if op in HATS:
                return (0, self.fill(T[op], v).lower(), v.get('y', 0), v.get('x', 0))
            return (2, '', v.get('y', 0), v.get('x', 0))
        res = []
        for k, v in sorted(tops, key=key):
            out = []
            if v['opcode'] in HATS:
                out.append(self.fill(T[v['opcode']], v))
                self.stack(v.get('next'), 1, out)
            elif v['opcode'] == 'procedures_definition':
                self.stmt(v, 0, out)
                self.stack(v.get('next'), 1, out)
            else:
                out.append('// loose blocks (not attached to a hat: never run)')
                if v['opcode'] in T and T[v['opcode']].startswith('('):
                    out.append(IND + self.expr(k))
                else:
                    self.stack(k, 1, out)
            res.append('\n'.join(out))
        return res


def slug(name):
    return re.sub(r'[^A-Za-z0-9 _-]', '', name).strip() or 'unnamed'


def main():
    p = json.load(open(SRC))
    os.makedirs(OUT, exist_ok=True)
    blob = json.dumps([t['blocks'] for t in p['targets']])
    targets = sorted(p['targets'], key=lambda t: (not t['isStage'], t['name'].lower()))
    for t in targets:
        d = Dumper(t)
        head = ['# %s%s' % (t['name'], ' (stage)' if t['isStage'] else ''),
                '# %d blocks, %d costumes, %d sounds' % (len(t['blocks']), len(t['costumes']), len(t['sounds']))]
        for c in t.get('comments', {}).values():
            head.append('# comment: ' + c.get('text', '').replace('\n', ' / '))
        body = d.scripts()
        with open(os.path.join(OUT, slug(t['name']) + '.txt'), 'w') as f:
            f.write('\n'.join(head) + '\n\n' + '\n\n'.join(body) + '\n')

    # Globals: variables and lists per target, unused ones marked, plus who sends and receives each broadcast
    g = []
    for t in targets:
        g.append('## %s' % t['name'])
        for vid, v in sorted(t['variables'].items(), key=lambda kv: kv[1][0].lower()):
            used = json.dumps(vid) in blob
            g.append('  var  %-34s = %s%s' % (v[0], json.dumps(v[1])[:80], '' if used else '   (UNUSED)'))
        for lid, l in sorted(t['lists'].items(), key=lambda kv: kv[1][0].lower()):
            used = json.dumps(lid) in blob
            items = json.dumps(l[1])
            g.append('  list %-34s = %s%s' % (l[0], items if len(items) < 200 else items[:200] + '…(%d items)' % len(l[1]),
                                               '' if used else '   (UNUSED)'))
        g.append('')
    senders, receivers = defaultdict(set), defaultdict(set)
    for t in targets:
        d = Dumper(t)
        for b in t['blocks'].values():
            if not isinstance(b, dict):
                continue
            if b['opcode'] == 'event_whenbroadcastreceived':
                receivers[b['fields']['BROADCAST_OPTION'][0]].add(t['name'])
            elif b['opcode'] in ('event_broadcast', 'event_broadcastandwait'):
                name = d.inp(b, 'BROADCAST_INPUT')
                name = name[1:-1] if name.startswith('[') else name + ' (computed)'
                senders[name].add(t['name'])
    g.append('## Broadcasts (message: sent by -> received by)')
    for name in sorted(set(senders) | set(receivers), key=str.lower):
        s = ', '.join(sorted(senders[name])) or 'NOBODY'
        r = ', '.join(sorted(receivers[name])) or 'NOBODY'
        g.append('  %-32s %s -> %s' % (name, s, r))
    with open(os.path.join(OUT, '_globals.txt'), 'w') as f:
        f.write('\n'.join(g) + '\n')


main()
