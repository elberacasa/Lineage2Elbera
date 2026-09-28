#!/usr/bin/env python3
"""Verify the extracted BSP kit, module closure and portable Node tests.

Python standard library + Node22 or newer; no original inputs or browser launch.
The dependency check is scoped to the supplied static HTML/ES modules, not a
general JavaScript security scanner or visual browser acceptance test.
"""
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
from urllib.parse import urlsplit, unquote

ROOT = Path(__file__).resolve().parents[2]
FILES = frozenset({
    'README.md', 'LICENSE', 'package.json', 'editor/world/js/bsp-collision.js',
    'editor/world/test/bsp-collision.test.mjs', 'editor/world/test/bsp-original.html',
    'editor/world/test/bsp-original.js', 'editor/world/test/index.html',
    'tools/release/smoke_bsp.py',
})


def verify_manifest(root):
    root = Path(root)
    manifest = json.loads((root/'MANIFEST.json').read_text())
    if (manifest.get('format') != 'elbera-tools-bsp-inspector-release-v1' or
            manifest.get('sourceOnly') is not True or
            manifest.get('sourceState') not in ('working-tree-candidate','committed-source')):
        raise ValueError('BSP source manifest required')
    seen = set()
    for row in manifest['files']:
        name = row['path']; path = PurePosixPath(name)
        if name not in FILES or name in seen or str(path) != name:
            raise ValueError('unexpected or repeated manifest path')
        seen.add(name)
        target = root
        for part in path.parts:
            target /= part
            if target.is_symlink(): raise ValueError('symlink in kit source')
        raw = target.read_bytes()
        if len(raw) != row['bytes'] or hashlib.sha256(raw).hexdigest() != row['sha256']:
            raise ValueError('manifest source changed: '+name)
    if seen != FILES: raise ValueError('incomplete BSP manifest')
    return len(seen)


class PageLinks(HTMLParser):
    def __init__(self):
        super().__init__(); self.links=[]; self.modules=[]

    def handle_starttag(self, tag, attributes):
        attrs=dict(attributes)
        for key in ('href','src'):
            if key in attrs: self.links.append(attrs[key])
        if tag=='script':
            if attrs.get('type')!='module' or not attrs.get('src'):
                raise ValueError('expected external module script')
            self.modules.append(attrs['src'])


def dependency_closure(root):
    root=Path(root).resolve(); modules=set(); pages=[]

    def local(base, reference):
        url=urlsplit(reference)
        if url.scheme or url.netloc or url.query or url.fragment or not url.path or url.path.startswith('/'):
            raise ValueError('nonlocal or unsupported kit dependency: '+reference)
        path=(base.parent/unquote(url.path)).resolve()
        try:relative=path.relative_to(root).as_posix()
        except ValueError:raise ValueError('dependency escapes kit') from None
        if relative not in FILES or not path.is_file(): raise ValueError('missing kit dependency: '+reference)
        return path

    for name in ('editor/world/test/index.html','editor/world/test/bsp-original.html'):
        page=root/name; parser=PageLinks();parser.feed(page.read_text());pages.append(name)
        for link in parser.links:local(page,link)
        modules.update(local(page,link) for link in parser.modules)
    queue=list(modules)
    while queue:
        module=queue.pop(); source=module.read_text()
        # These modules currently use only static imports. Reject a future
        # asynchronous/external loader until its closure is deliberately added.
        if re.search(r'\b(?:import\s*\(|fetch\s*\(|Worker\s*\()',source):
            raise ValueError('unreviewed dynamic module dependency')
        for reference in re.findall(r'\b(?:import|export)\s+(?:[^;]*?\s+from\s+)?[\'\"]([^\'\"]+)[\'\"]',source):
            if not reference.startswith('.'):raise ValueError('bare module in browser inspector')
            target=local(module,reference)
            if target not in modules:modules.add(target);queue.append(target)
    expected={'editor/world/test/bsp-original.js','editor/world/js/bsp-collision.js'}
    if {path.relative_to(root).as_posix() for path in modules} != expected:
        raise ValueError('inspector module closure changed')
    return {'htmlPages':pages,'modules':sorted(expected)}


def run_checks(root):
    root=Path(root);count=verify_manifest(root);closure=dependency_closure(root)
    node=shutil.which('node')
    if not node:raise RuntimeError('BSP portable tests require Node22 or newer')
    environment=os.environ.copy()
    for name in ('NODE_OPTIONS','NODE_PATH','PYTHONPATH'):environment.pop(name,None)
    version=subprocess.check_output([node,'--version'],env=environment,text=True).strip()
    match=re.fullmatch(r'v(\d+)\.\d+\.\d+',version)
    if not match or int(match[1])<22:raise RuntimeError('BSP portable tests require Node22 or newer')
    for name in closure['modules']:
        subprocess.run([node,'--check',name],
                       cwd=root,env=environment,check=True,capture_output=True,text=True,timeout=15)
    result=subprocess.run([node,'--test','--test-reporter=tap',
                           'editor/world/test/bsp-collision.test.mjs'],cwd=root,env=environment,
                          capture_output=True,text=True,timeout=30)
    if result.returncode:raise RuntimeError('isolated BSP tests failed:\n'+result.stdout+result.stderr)
    numbers={key:int(value) for key,value in re.findall(r'^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$',result.stdout,re.M)}
    if (numbers.get('tests',0)<42 or numbers.get('pass')!=numbers.get('tests') or
            any(numbers.get(key)!=0 for key in ('fail','cancelled','skipped','todo'))):
        raise RuntimeError('BSP test count or completion mismatch:\n'+result.stdout)
    return {'manifestFiles':count,'nodeVersion':version,'tests':numbers,**closure,
            'scope':'portable source tests and dependency closure; no original inputs or browser execution'}


if __name__ == '__main__':
    print(json.dumps(run_checks(ROOT),indent=2))
