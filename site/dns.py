
import json, subprocess, sys, time, urllib.request, urllib.error
def token():
    try: return subprocess.run(['security', 'find-generic-password', '-s', 'cloudflare-dns', '-a', 'nibbi.ai', '-w'], capture_output=True, text=True, check=True).stdout.strip()
    except Exception: return None
def api(tok, method, path, body=None):
    req = urllib.request.Request('https://api.cloudflare.com/client/v4' + path, data=(json.dumps(body).encode() if body is not None else None), method=method, headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r: return json.load(r)
    except urllib.error.HTTPError as e: return {'success': False, 'http': e.code, 'body': e.read().decode()[:300]}
tok = token()
if not tok: print('no token yet'); sys.exit(3)
v = api(tok, 'GET', '/user/tokens/verify'); print('token:', v.get('result', {}).get('status'), v.get('errors'))
zones = api(tok, 'GET', '/zones?name=nibbi.ai'); z = (zones.get('result') or [None])[0]
if not z: print('token cannot see zone nibbi.ai:', zones.get('errors') or zones.get('body')); sys.exit(4)
zone = z['id']
recs = api(tok, 'GET', f'/zones/{zone}/dns_records?per_page=100').get('result') or []
def ensure(name):
    have = [r for r in recs if r['name'] == name and r['type'] == 'CNAME']
    if have and have[0]['content'] == 'nibbi.pages.dev' and have[0]['proxied']: print('exists', name); return
    if have: r = api(tok, 'PUT', f"/zones/{zone}/dns_records/{have[0]['id']}", {'type': 'CNAME', 'name': name, 'content': 'nibbi.pages.dev', 'proxied': True, 'ttl': 1})
    else: r = api(tok, 'POST', f'/zones/{zone}/dns_records', {'type': 'CNAME', 'name': name, 'content': 'nibbi.pages.dev', 'proxied': True, 'ttl': 1})
    print(('created ' if not have else 'updated ') + name, r.get('success'), r.get('errors') or r.get('body') or '')
ensure('nibbi.ai'); ensure('www.nibbi.ai')
print('dns done')
