#!/usr/bin/env python3
"""
NAVADA NeuroAtlas dev server.
- Serves the static app (no-cache for development).
- Proxies the AI Tutor to the Anthropic API using a key from Brain/.env,
  so the key is NEVER exposed to the browser.

.env (in this folder):
    ANTHROPIC_API_KEY=sk-ant-...
    NAVADA_TUTOR_MODEL=claude-sonnet-4-6   # optional
"""
import http.server, socketserver, json, os, urllib.request, urllib.error

PORT = 8099
ENV = {}

def load_env():
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                ENV[k.strip()] = v.strip().strip('"').strip("'")
    # allow real environment to win if set
    for k in ("ANTHROPIC_API_KEY", "NVIDIA_API_KEY", "NAVADA_TUTOR_MODEL"):
        if os.environ.get(k):
            ENV[k] = os.environ[k]

def has_key():
    return bool(ENV.get("NVIDIA_API_KEY") or ENV.get("ANTHROPIC_API_KEY"))

def default_model():
    if ENV.get("NVIDIA_API_KEY"):
        return ENV.get("NAVADA_TUTOR_MODEL", "meta/llama-3.3-70b-instruct")
    return ENV.get("NAVADA_TUTOR_MODEL", "claude-sonnet-4-6")

def llm_chat(messages, context):
    if not has_key():
        return {"error": "no_key", "reply": "AI Tutor is offline - no API key configured yet."}
    model = default_model()

    organ = (context or {}).get("organ", "brain")
    if organ == "eye":
        sys_prompt = (
            "You are the NAVADA OptosAtlas Tutor, a warm, expert ophthalmology/vision teacher embedded in "
            "an interactive 3D eye learning app (part of the NAVADA Atlas platform). Teach clearly and "
            "concisely (2-5 short sentences unless asked for more). Use simple analogies. Be accurate; if "
            "unsure, say so. Cover eye anatomy (cornea, iris, lens, anterior/posterior segments, retina), "
            "the six extraocular muscles and eye movements, the pupillary light reflex, accommodation and "
            "focus, and how the eye sends signals to the brain. Relate answers to what the user is currently "
            "looking at when relevant."
        )
    elif organ == "gut":
        sys_prompt = (
            "You are the NAVADA GutAtlas Tutor, a warm, expert gastroenterology/gut-health teacher embedded "
            "in an interactive 3D app of the large intestine (part of the NAVADA Atlas platform). Teach clearly "
            "and concisely (2-5 short sentences unless asked for more). Use simple analogies. Be accurate; if "
            "unsure, say so. Cover the colon (ascending, transverse, descending, sigmoid), the duodenum and the "
            "appendix, peristalsis and transit, water absorption, the gut microbiome and fibre, and conditions "
            "like constipation, diarrhoea and appendicitis. Be supportive and non-squeamish about digestion and "
            "bowel habits. Relate answers to what the user is currently looking at when relevant."
        )
    elif organ == "gluco":
        sys_prompt = (
            "You are the NAVADA GlucoAtlas Tutor, a warm, expert metabolism/diabetes teacher embedded in "
            "an interactive 3D app of the organs that control blood sugar (part of the NAVADA Atlas platform). "
            "Teach clearly and concisely (2-5 short sentences unless asked for more). Use simple analogies. Be "
            "accurate; if unsure, say so. Cover the stomach, duodenum, pancreas (islets, insulin and glucagon), "
            "liver (glycogen storage and release), gallbladder and spleen, how a meal raises blood glucose and "
            "how the body brings it back down, incretins like GLP-1, exercise, hypoglycaemia and diabetes. Be "
            "supportive and non-judgemental about food and blood sugar. Relate answers to what the user is "
            "currently looking at when relevant."
        )
    elif organ == "ear":
        sys_prompt = (
            "You are the NAVADA OtoAtlas Tutor, a warm, expert audiology/hearing teacher embedded in "
            "an interactive 3D ear learning app (part of the NAVADA Atlas platform). Teach clearly and "
            "concisely (2-5 short sentences unless asked for more). Use simple analogies. Be accurate; if "
            "unsure, say so. Cover ear anatomy (outer ear/auricle, eardrum, the three ossicles - malleus, "
            "incus, stapes - the Eustachian tube, cochlea and vestibule), how sound is conducted and turned "
            "into nerve signals, pitch and loudness, balance, and conditions like noise-induced hearing loss "
            "and ear popping. Relate answers to what the user is currently looking at when relevant."
        )
    elif organ == "lungs":
        sys_prompt = (
            "You are the NAVADA RespiroAtlas Tutor, a warm, expert respiratory teacher embedded in an "
            "interactive 3D lungs learning app (part of the NAVADA Atlas platform). Teach clearly and "
            "concisely (2-5 short sentences unless asked for more). Use simple analogies. Be accurate; "
            "if unsure, say so. Cover respiratory anatomy (lung lobes, trachea, bronchi, diaphragm, "
            "alveoli), the mechanics of breathing, gas exchange, spirometry/lung volumes, and conditions "
            "like asthma and breath-holding. Relate answers to what the user is currently looking at when relevant."
        )
    elif organ == "heart":
        sys_prompt = (
            "You are the NAVADA CardioAtlas Tutor, a warm, expert cardiology teacher embedded in an "
            "interactive 3D heart learning app (part of the NAVADA Atlas platform). Teach clearly and "
            "concisely (2-5 short sentences unless asked for more). Use simple analogies. Be accurate; "
            "if unsure, say so. Cover heart anatomy (chambers, valves, papillary muscles), the cardiac "
            "cycle, the conduction system, the ECG, and conditions like tachycardia, atrial fibrillation "
            "and myocardial infarction. Relate answers to what the user is currently looking at when relevant."
        )
    else:
        sys_prompt = (
            "You are the NAVADA NeuroAtlas Tutor, a warm, expert neuroscience teacher embedded in an "
            "interactive 3D brain learning app. Teach clearly and concisely (2-5 short sentences unless "
            "asked for more). Use simple analogies. Be accurate; if unsure, say so. This app is part of "
            "NAVADA_9, a wearable-neurotech concept that reads the brain's error-related potential (ErrP) "
            "from the anterior cingulate, detected behind the ear, to correct AI in real time. "
            "Relate answers to what the user is currently looking at when relevant."
        )
    if context:
        reg = context.get("region")
        scn = context.get("scenario")
        bits = []
        if reg: bits.append(f"Currently selected part: {reg}.")
        if scn: bits.append(f"Current scenario: {scn}.")
        if bits:
            sys_prompt += "\n\nLive context — " + " ".join(bits)

    try:
        if ENV.get("NVIDIA_API_KEY"):
            # NVIDIA NIM - OpenAI-compatible chat completions
            oai_msgs = [{"role": "system", "content": sys_prompt}] + messages
            body = json.dumps({
                "model": model, "messages": oai_msgs,
                "max_tokens": 700, "temperature": 0.4,
            }).encode("utf-8")
            req = urllib.request.Request(
                "https://integrate.api.nvidia.com/v1/chat/completions", data=body,
                headers={"Authorization": "Bearer " + ENV["NVIDIA_API_KEY"],
                         "Content-Type": "application/json", "Accept": "application/json"},
                method="POST")
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.loads(r.read().decode("utf-8"))
            text = data["choices"][0]["message"]["content"]
        else:
            # Anthropic Messages API
            body = json.dumps({
                "model": model, "max_tokens": 700,
                "system": sys_prompt, "messages": messages,
            }).encode("utf-8")
            req = urllib.request.Request(
                "https://api.anthropic.com/v1/messages", data=body,
                headers={"x-api-key": ENV["ANTHROPIC_API_KEY"],
                         "anthropic-version": "2023-06-01", "content-type": "application/json"},
                method="POST")
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.loads(r.read().decode("utf-8"))
            text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
        return {"reply": text or "(no response)", "model": model}
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "ignore")
        return {"error": f"http_{e.code}", "reply": f"AI error ({e.code}). {detail[:200]}"}
    except Exception as e:
        return {"error": "exception", "reply": f"AI request failed: {e}"}


class Handler(http.server.SimpleHTTPRequestHandler):
    # HTTP/1.1 keeps the TCP connection alive so the many small assets on a page
    # reuse one connection instead of opening a fresh one each time.
    protocol_version = "HTTP/1.1"

    def _json(self, obj, code=200):
        payload = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def end_headers(self):
        # Path-based caching. Only the big IMMUTABLE binaries (3D models, images,
        # fonts) cache hard for a day — the app shell (html/js/css/json) always
        # revalidates so new features and fixes show up immediately via a cheap 304.
        p = self.path.split("?", 1)[0].lower()
        ASSETS = (".glb", ".gltf", ".bin", ".wasm", ".png", ".jpg", ".jpeg",
                  ".webp", ".gif", ".woff2", ".woff", ".ico")
        if p.startswith("/api"):
            self.send_header("Cache-Control", "no-store")
        elif p.endswith(ASSETS):
            self.send_header("Cache-Control", "public, max-age=86400")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        if self.path == "/api/health":
            return self._json({"ai": has_key(), "model": default_model()})
        return super().do_GET()

    def do_POST(self):
        if self.path == "/api/chat":
            try:
                length = int(self.headers.get("Content-Length", 0))
                payload = json.loads(self.rfile.read(length) or b"{}")
                msgs = payload.get("messages", [])
                ctx = payload.get("context", {})
                return self._json(llm_chat(msgs, ctx))
            except Exception as e:
                return self._json({"error": "bad_request", "reply": str(e)}, 400)
        self.send_error(404)


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

if __name__ == "__main__":
    load_env()
    print(f"NAVADA NeuroAtlas -> http://localhost:{PORT}")
    print(f"AI Tutor: {'ONLINE ('+default_model()+')' if has_key() else 'offline (add a key to .env)'}")
    with ThreadingHTTPServer(("", PORT), Handler) as httpd:
        httpd.serve_forever()
