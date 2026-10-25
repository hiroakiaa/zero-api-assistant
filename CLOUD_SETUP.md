# ZERO self-hosted inference

Status: connection code and a loopback-only inference bridge are implemented. A loopback-only Ollama server and bridge have been exercised on the owner-authorized PC. An owner-approved temporary Cloudflare route is present, but authenticated transmission and GAS activation remain disabled while explicit key-use consent is pending. Local generation does not prove iPhone end-to-end operation.

The path is browser → GAS → an owner-operated HTTPS bridge → the same host's local Ollama. Browser model downloads and paid hosted inference APIs are not used. A server still needs memory, storage, power, network access and uptime. Using an existing PC avoids a new inference API bill; it does not make those resources free.

## Local setup, after choosing the machine

1. Install Node.js 20+ and Ollama from their official sources. No installer is executed by this repository.
2. Run Ollama in local-only mode, bound to loopback. Do not publish Ollama port 11434.

```powershell
$env:OLLAMA_NO_CLOUD = '1'
$env:OLLAMA_HOST = '127.0.0.1:11434'
ollama serve
```

If the Ollama desktop app is already running, it must be stopped before starting a separately configured server. Changing shell environment variables does not reconfigure an existing process.

3. In another terminal, download the server model once:

```powershell
ollama pull qwen2.5:7b-instruct
```

This currently has approximately 4.7 GB of weights; actual execution needs additional memory. This bridge uses only the tested non-reasoning `qwen2.5:7b-instruct` model. It rejects arbitrary models and cloud-hosted model tags. The model uses Apache 2.0; retain its notices on the server. Registry tags may change, so record the installed model digest and version before a production rollout.

4. Create a secret in your own terminal and start the bridge. Do not paste the secret into chat, commit it, include it in a URL, or put it in browser JavaScript.

```powershell
$env:ZERO_AI_SECRET = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
$env:ZERO_AI_MODEL = 'qwen2.5:7b-instruct'
node cloud/CloudServer.mjs
```

The published standalone file is `CloudServer.mjs` at the repository root, so use `node CloudServer.mjs` when using that copy. The bridge listens on `127.0.0.1:8787`. Closing the terminal stops it. Preserve the secret securely if you need to restart it with the same GAS configuration.

5. Test real local generation before exposing anything:

```powershell
$zeroBody = @{ prompt = '短い挨拶を1文で書いて'; kind = '文章'; history = @() } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri 'http://127.0.0.1:8787/zero/chat' -Method Post -ContentType 'application/json' -Headers @{ Authorization = "Bearer $env:ZERO_AI_SECRET" } -Body ([Text.Encoding]::UTF8.GetBytes($zeroBody))
```

The authenticated `/zero/health` endpoint confirms the bridge process is responding; it does not prove the model is installed or generation works. Use the generation request above for that.

## Public connection, after review

Choose an HTTPS reverse proxy or an existing public server that you are authorized to operate. This repository does not create a tunnel, open a firewall, bind a public port, purchase hosting, or configure a public route. Review the concrete exposure and access controls before enabling it. Forward only `/zero/chat` to the loopback bridge and preserve the Authorization header. Do not expose Ollama itself. A private LAN URL or the iPhone's localhost cannot be reached by GAS.

In the Apps Script project's **Script properties**, configure:

| Property | Value |
| --- | --- |
| `ZERO_AI_URL` | Your reviewed `https://your-host/zero/chat` endpoint, without query or credentials |
| `ZERO_AI_SECRET` | The same secret used by the bridge |
| `ZERO_AI_ENABLED` | `true` only after the endpoint is ready and reviewed |

The app receives only a configured/not-configured flag. It never receives the URL or secret. No new Google OAuth scopes are required beyond the existing external-request scope, and no first-time permission approval is accepted automatically.

The owner-approved test deployment currently uses Cloudflare Quick Tunnel. Its hostname changes when the tunnel restarts, so update `ZERO_AI_URL` after checking the replacement endpoint. Keep `ZERO_AI_ENABLED` false while a replacement is unverified. This route has no uptime guarantee, and generation stops while the PC sleeps or its processes stop. No automatic startup or restart has been configured. The owner separately approved saving the bridge key in GAS and sending authentication through the specified tunnel; the key is excluded from published files.

## Behavior and rollout

- Registered API/calculation requests continue to use their existing handlers first. Writing, translation, summaries, code help and unsupported conversational prompts use the configured cloud server.
- Only the current prompt and up to four recent generated messages, totaling at most 700 history characters, are sent to the inference server. API answers and local-model history are not automatically sent. The prompt is at most 2,000 characters; the current chat field is more restrictive.
- No browser credentials, remote endpoints, model choices, tools or execution options can be supplied in a generation request. The bridge calls only `http://127.0.0.1:11434/api/chat` with a fixed local model, no reasoning-model switch, no tools, and a bounded output.
- One generation at a time is accepted. GAS shares a maximum of 100 attempts per Japan-calendar day across users. Failures count as attempts. The bridge rejects concurrent requests rather than maintaining an unbounded queue. Request-body reception has a 10-second deadline and a 16,000-byte limit, including chunked requests without Content-Length. Incomplete bodies, oversized bodies and disconnected clients release the generation slot; disconnects during generation abort the local upstream request. There is no paid or local-download fallback.
- Request bodies, generated answers and secrets are not logged by the bridge. GAS conversation history continues to use the existing private spreadsheet when enabled. No prompt/answer cache is added.
- Generated text is returned without model/license/source footers. Incomplete output is identified rather than treated as complete.
- For unambiguous Japanese prose requests of one to eight exact sentences, the bridge checks sentence boundaries with `Intl.Segmenter`. A completed answer with the wrong count gets at most one rewrite on the same local model, within the original timeout and generation slot. A second mismatch fails instead of reporting a conforming answer. Translation, code, quoted source text, ranges and approximate limits are excluded. Truncated output keeps its incomplete status. This check does not establish factual correctness or compliance with every other writing instruction.
- Before retiring the device-local option, verify real text quality, latency, concurrency behavior, outages, restarts and iPhone browser use on the selected host. Keep model downloads manual until this has passed.

Official references: [Ollama chat API](https://docs.ollama.com/api/chat), [local-only mode and networking](https://docs.ollama.com/faq), [Qwen2.5-7B-Instruct model registry](https://ollama.com/library/qwen2.5:7b-instruct), [model license](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct).
