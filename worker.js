/* Python runner for the mock interview page. Runs Pyodide off the main thread so a slow or
   looping solution can be stopped by terminating this worker. */
var pyodide = null;
var HARNESS = `
import json, sys, time, copy, random, traceback, math, collections
from js import postMessage

PRELUDE = '''
from typing import *
import collections, heapq, bisect, itertools, functools, math, random, re, string
from collections import deque, defaultdict, Counter, OrderedDict
from functools import lru_cache, cache

_LIVE_NODES = []

class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next
        _LIVE_NODES.append(self)
    def __repr__(self):
        return f"ListNode({self.val})"

class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right
        _LIVE_NODES.append(self)
    def __repr__(self):
        return f"TreeNode({self.val})"
'''

_buf = []
_total = [0]

class _Out:
    def write(self, s):
        if _total[0] < 20000:
            _buf.append(s)
            _total[0] += len(s)
            if _total[0] >= 20000:
                _buf.append("\\n[output truncated]\\n")
        return len(s)
    def flush(self):
        pass

sys.stdout = _Out()
sys.stderr = _Out()

def send(obj):
    if _buf:
        postMessage(json.dumps({"t": "out", "s": "".join(_buf)}))
        _buf.clear()
    postMessage(json.dumps(obj))

def fresh_ns(code, filename, setup=None):
    ns = {"__name__": "__main__", "__builtins__": __builtins__}
    exec(PRELUDE, ns)
    if setup:
        exec(compile(setup, "runtime_helpers.py", "exec"), ns)
    exec(compile(code, filename, "exec"), ns)
    return ns

def to_list_node(ns, arr):
    head = None
    for v in reversed(arr):
        head = ns["ListNode"](v, head)
    return head

def from_list_node(node):
    out = []
    while node is not None and len(out) < 300000:
        out.append(node.val)
        node = node.next
    return out

def to_tree(ns, arr):
    if not arr or arr[0] is None:
        return None
    T = ns["TreeNode"]
    root = T(arr[0]); q = [root]; i = 1; qi = 0
    while i < len(arr):
        node = q[qi]; qi += 1
        if i < len(arr) and arr[i] is not None:
            node.left = T(arr[i]); q.append(node.left)
        i += 1
        if i < len(arr) and arr[i] is not None:
            node.right = T(arr[i]); q.append(node.right)
        i += 1
    return root

def from_tree(root):
    if root is None:
        return []
    out, q, qi = [], [root], 0
    while qi < len(q):
        n = q[qi]; qi += 1
        if n is None:
            out.append(None); continue
        out.append(n.val); q.append(n.left); q.append(n.right)
    while out and out[-1] is None:
        out.pop()
    return out

_orig_sample = random.sample
def _safe_sample(population, k, **kw):
    """random.sample over a range wider than 2^31 overflows on 32 bit WebAssembly; sample it by index instead."""
    if isinstance(population, range):
        try:
            len(population)
        except OverflowError:
            size = (population.stop - population.start + population.step - (1 if population.step > 0 else -1)) // population.step
            picked, out = set(), []
            while len(out) < k:
                i = random.randrange(size)
                if i not in picked:
                    picked.add(i); out.append(population.start + i * population.step)
            return out
    return _orig_sample(population, k, **kw)
random.sample = _safe_sample

_NO_WALK = (type, type(len), type(lambda: 0), type(sys))

def safe_release(*roots):
    """Take apart object graphs one link at a time so freeing them never recurses deeply.
    Deep chains (long linked lists, tries built from long words, degenerate trees) would otherwise
    overflow the browser stack when Python frees them."""
    keep, seen, stack = [], set(), list(roots)
    while stack and len(keep) < 3000000:
        o = stack.pop()
        if o is None or isinstance(o, (int, float, str, bytes, bool, _NO_WALK)):
            continue
        if id(o) in seen:
            continue
        seen.add(id(o)); keep.append(o)
        if isinstance(o, dict):
            stack.extend(o.values())
        elif isinstance(o, (list, tuple, set, frozenset, collections.deque)):
            stack.extend(o)
        else:
            d = getattr(o, "__dict__", None)
            if isinstance(d, dict):
                stack.append(d)
            for slot in getattr(type(o), "__slots__", ()) or ():
                try:
                    stack.append(getattr(o, slot))
                except Exception:
                    pass
    for o in keep:
        try:
            if isinstance(o, (dict, list, set, collections.deque)):
                o.clear()
            else:
                for slot in getattr(type(o), "__slots__", ()) or ():
                    try:
                        delattr(o, slot)
                    except Exception:
                        pass
        except Exception:
            pass
    keep.clear()

def release_live(ns):
    """Every ListNode and TreeNode stays alive until the case ends; then unlink them one at a time.
    Otherwise a chain that only a local variable holds (say, the reversed half of a list) is freed
    recursively when the function returns, which overflows the browser stack."""
    live = ns.get("_LIVE_NODES")
    if not live:
        return
    for n in live:
        d = getattr(n, "__dict__", None)
        if d is not None:
            for k in ("next", "left", "right", "prev", "random", "child", "parent"):
                if k in d:
                    d[k] = None
    live.clear()

def convert_out(t, v):
    if t == "list_node":
        return from_list_node(v)
    if t == "tree":
        return from_tree(v)
    if isinstance(v, tuple):
        v = list(v)
    return v

def call(ns, p, args):
    """Returns (output, milliseconds spent inside the candidate's code)."""
    if p.get("adapter"):
        ans = {"__builtins__": __builtins__}
        exec(PRELUDE, ans)
        exec(compile(p["adapter"], "adapter.py", "exec"), ans)
        t0 = time.perf_counter()
        r = ans["adapt"](ns, args)
        ms = (time.perf_counter() - t0) * 1000
        release_live(ns)
        return (list(r) if isinstance(r, tuple) else r), ms
    if p.get("kind") == "design":
        ops, params = args
        out, obj = [], None
        t0 = time.perf_counter()
        for op, a in zip(ops, params):
            if obj is None:
                obj = ns[p["fn"]](*a); out.append(None)
            else:
                r = getattr(obj, op)(*a)
                out.append(list(r) if isinstance(r, tuple) else r)
        ms = (time.perf_counter() - t0) * 1000
        safe_release(obj)
        release_live(ns)
        return out, ms
    types = p.get("arg_types") or ["any"] * len(args)
    conv = []
    for t, a in zip(types, args):
        if t == "list_node": conv.append(to_list_node(ns, a))
        elif t == "tree": conv.append(to_tree(ns, a))
        else: conv.append(a)
    t0 = time.perf_counter()
    r = ns[p["fn"]](*conv)
    ms = (time.perf_counter() - t0) * 1000
    rt = p.get("return_type", "any")
    out = convert_out(rt, r)
    if rt in ("list_node", "tree"):
        safe_release(r)
    safe_release(*[c for t, c in zip(types, conv) if t in ("list_node", "tree")])
    release_live(ns)
    return out, ms

def norm(p, v):
    mode = p.get("compare", "exact")
    try:
        if mode == "unordered":
            return sorted(v, key=repr)
        if mode == "unordered_nested":
            return sorted([sorted(x, key=repr) if isinstance(x, list) else x for x in v], key=repr)
    except Exception:
        return v
    return v

def same(p, got, exp, args):
    if p.get("checker"):
        cns = fresh_ns(p["checker"], "checker.py")
        try:
            return bool(cns["check"](copy.deepcopy(args), got, exp))
        except Exception:
            return False
    if p.get("compare") == "float":
        try:
            return abs(got - exp) <= 1e-5 * max(1.0, abs(exp))
        except Exception:
            return False
    return norm(p, got) == norm(p, exp)

def short(v, n=360):
    try:
        r = repr(v)
    except Exception:
        r = "<unprintable>"
    return r if len(r) <= n else r[:n] + " ... (" + format(len(r), ",") + " chars)"

def describe(params, args):
    parts = []
    for name, a in zip(params, args):
        if isinstance(a, list):
            parts.append(name + ": list of " + format(len(a), ","))
        elif isinstance(a, str):
            parts.append(name + ": string of length " + format(len(a), ","))
        else:
            parts.append(name + " = " + short(a, 40))
    return ", ".join(parts)

def candidate_trace(e):
    """Only show frames from the candidate's file, like a judge would."""
    te = traceback.TracebackException.from_exception(e)
    frames = [f for f in te.stack if f.filename == "solution.py"]
    lines = []
    for f in frames[-6:]:
        lines.append(f"  line {f.lineno}, in {f.name}")
        if f.line:
            lines.append("    " + f.line.strip())
    msg = "".join(te.format_exception_only()).strip()
    if isinstance(e, SyntaxError) and e.lineno:
        lines = [f"  line {e.lineno}"] + (["    " + e.text.strip()] if e.text else [])
    if isinstance(e, RecursionError):
        msg += "  (recursion went too deep; consider an iterative approach)"
    return ("\\n".join(lines) + "\\n" + msg).strip()

def run_job(payload_json):
    P = json.loads(payload_json)
    p = P["problem"]
    _total[0] = 0
    send({"t": "phase", "phase": "load", "limit": 4000})
    try:
        ns = fresh_ns(P["code"], "solution.py", p.get("setup"))
    except BaseException as e:
        send({"t": "load_error", "trace": candidate_trace(e)})
        return
    if p.get("fn") and (p["fn"] not in ns or not callable(ns[p["fn"]])):
        send({"t": "missing"})
        return
    for i, c in enumerate(P["cases"]):
        send({"t": "case_start", "i": i, "limit": P.get("limit", 3000)})
        args = copy.deepcopy(c["args"])
        try:
            got, ms = call(ns, p, args)
            ok = same(p, got, c["expected"], c["args"])
            send({"t": "case", "i": i, "ok": ok, "got": short(got), "ms": ms})
        except BaseException as e:
            send({"t": "case", "i": i, "ok": False, "error": candidate_trace(e), "ms": 0})
    if P.get("gen"):
        try:
            random.seed(12345)
            gns = {"random": random, "__builtins__": __builtins__}
            exec(p["gen"], gns)
            bigs = gns["gen"]()
            ref = fresh_ns(p["optimal"]["code"], "reference.py", p.get("setup"))
        except BaseException as e:
            send({"t": "gen_error", "trace": traceback.format_exc()})
            bigs = []
        base = len(P["cases"])
        for j, args in enumerate(bigs):
            i = base + j
            label = describe(p["params"], args) if p.get("kind") != "design" else format(len(args[0]), ",") + " operations"
            exp, ref_ms = call(ref, p, copy.deepcopy(args))
            limit = max(2500, int(ref_ms * 15) + 1500)
            send({"t": "case_start", "i": i, "limit": limit, "gen": True, "label": label, "ref_ms": ref_ms})
            try:
                got, ms = call(ns, p, copy.deepcopy(args))
                ok = same(p, got, exp, args)
                send({"t": "case", "i": i, "ok": ok, "got": short(got, 120), "expected": short(exp, 120), "ms": ms, "ref_ms": ref_ms, "gen": True, "label": label})
            except BaseException as e:
                send({"t": "case", "i": i, "ok": False, "error": candidate_trace(e), "ms": 0, "ref_ms": ref_ms, "gen": True, "label": label})
    send({"t": "done"})
`;


/* ---------- SQL questions run on SQLite (sql.js), no Python needed ---------- */
var BASE = "", SQL = null;
async function ensureSql() {
  if (!SQL) { importScripts(BASE + "sql-wasm.js"); SQL = await initSqlJs({ locateFile: function (f) { return BASE + f; } }); }
}
function roundVal(v) { return (typeof v === "number" && !Number.isInteger(v)) ? Math.round(v * 1e5) / 1e5 : v; }
function runSql(tables, data, query, checkQuery) {
  var db = new SQL.Database();
  try {
    Object.keys(tables).forEach(function (name) {
      var cols = tables[name];
      db.run("CREATE TABLE " + name + " (" + cols.map(function (c) { return '"' + c[0] + '" ' + c[1]; }).join(", ") + ")");
      var rows = data[name] || [];
      if (rows.length) {
        var st = db.prepare("INSERT INTO " + name + " VALUES (" + cols.map(function () { return "?"; }).join(",") + ")");
        rows.forEach(function (r) { st.run(r); }); st.free();
      }
    });
    var t0 = performance.now(), res;
    if (checkQuery) { db.exec(query); res = db.exec(checkQuery); } else res = db.exec(query);
    var last = res.length ? res[res.length - 1] : { columns: [], values: [] };
    return { columns: last.columns, rows: last.values.map(function (r) { return r.map(roundVal); }), ms: performance.now() - t0 };
  } finally { db.close(); }
}
function sqlSame(p, got, exp) {
  if (got.rows.length !== exp.rows.length) return false;
  var a = got.rows.map(function (r) { return JSON.stringify(r); }), b = exp.rows.map(function (r) { return JSON.stringify(r); });
  if (!p.order_matters) { a.sort(); b.sort(); }
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function showRows(r) {
  var head = r.columns.join(" | ");
  var body = r.rows.slice(0, 8).map(function (x) { return x.map(function (v) { return v === null ? "NULL" : String(v); }).join(" | "); });
  if (r.rows.length > 8) body.push("... " + (r.rows.length - 8) + " more rows");
  return (head ? head + "\n" : "") + (body.length ? body.join("\n") : "(no rows)");
}
async function runSqlJob(P) {
  var send = function (o) { postMessage(JSON.stringify(o)); };
  try { await ensureSql(); } catch (err) { send({ t: "load_error", trace: "SQLite could not load: " + err }); return; }
  var p = P.problem;
  P.cases.forEach(function (c, i) {
    send({ t: "case_start", i: i, limit: 4000 });
    try {
      var got = runSql(p.tables, c.args[0], P.code, p.check_query);
      send({ t: "case", i: i, ok: sqlSame(p, got, c.expected), got: showRows(got), ms: got.ms });
    } catch (err) {
      send({ t: "case", i: i, ok: false, error: String(err && err.message || err), ms: 0 });
    }
  });
}

self.onmessage = async function (e) {
  var msg = e.data;
  if (msg.cmd === "sql") {
    await runSqlJob(JSON.parse(msg.payload));
    postMessage(JSON.stringify({ t: "finished", job: msg.job }));
    return;
  }
  if (msg.cmd === "init") {
    BASE = msg.sqlBase || msg.base;
    try {
      importScripts(msg.base + "pyodide.js");
      // The standard library ships as plain Python sources in a JSON file and is written into
      // Pyodide's filesystem before Python starts (artifacts cannot serve the usual stdlib archive).
      var stdRes = await fetch(msg.base + "stdlib.json");
      if (!stdRes.ok) throw new Error("stdlib.json " + stdRes.status);
      var std = await stdRes.json();
      pyodide = await loadPyodide({
        indexURL: msg.base,
        stdLibURL: msg.base + "pyodide-lock.json",
        fsInit: function (FS) {
          Object.keys(std).forEach(function (p) {
            var full = "/lib/python3.13/" + p;
            FS.mkdirTree(full.slice(0, full.lastIndexOf("/")));
            FS.writeFile(full, std[p]);
          });
        }
      });
      await pyodide.runPythonAsync(HARNESS);
      postMessage(JSON.stringify({ t: "ready", version: pyodide.version }));
    } catch (err) {
      postMessage(JSON.stringify({ t: "init_error", s: String(err && err.message || err) }));
    }
  } else if (msg.cmd === "run") {
    try {
      pyodide.globals.get("run_job")(msg.payload);
    } catch (err) {
      var text = String(err && err.message || err);
      var fatal = /fatally failed|Maximum call stack|RangeError|memory access out of bounds|unreachable/i.test(text);
      postMessage(JSON.stringify({ t: fatal ? "fatal" : "load_error", trace: text }));
    }
    postMessage(JSON.stringify({ t: "finished", job: msg.job }));
  }
};
