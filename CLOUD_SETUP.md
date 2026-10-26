# ZERO self-hosted inference

Status: the owner-authorized PC bridge is connected to the live GAS app through an approved temporary Cloudflare route. The owner explicitly approved storing the bridge secret in GAS and using it through the specified route. Actual live generation and spreadsheet history have been checked. iPhone hardware operation and long-term availability remain unverified.

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

This currently has approximately 4.7 GB of weights; actual execution needs additional memory. General writing and code use the tested non-reasoning `qwen2.5:7b-instruct`. The optional translation route can use `qwen2.5:14b-instruct` (approximately 9.0 GB of additional weights and more execution memory). Only these approved local models are accepted; arbitrary models and cloud-hosted model tags are rejected. Both use Apache 2.0; retain their notices on the server. Registry tags may change, so record installed model digests and versions before a production rollout.

For the optional translation route, first run `ollama pull qwen2.5:14b-instruct` on the server PC. This is a manual server download, never a browser download. Then set `ZERO_AI_TRANSLATION_MODEL=qwen2.5:14b-instruct` before starting the bridge. If this variable is omitted, translations use the general model. If the configured translation model is unavailable, the request fails; it does not download a model or silently switch to another provider.

4. Create a secret in your own terminal and start the bridge. Do not paste the secret into chat, commit it, include it in a URL, or put it in browser JavaScript.

```powershell
$env:ZERO_AI_SECRET = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
$env:ZERO_AI_MODEL = 'qwen2.5:7b-instruct'
# Optional, only after the additional model is installed and tested:
# $env:ZERO_AI_TRANSLATION_MODEL = 'qwen2.5:14b-instruct'
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

## Bounded upstream responses

The bridge reads the local Ollama response as a stream with a 65,536-byte maximum before JSON parsing. It rejects excessive declared lengths, oversized chunked bodies, invalid UTF-8, malformed JSON and empty responses. The existing 8,000-character answer check still applies. Input, inference and response-body handling share the request timeout; response-body cancellation frees the request slot. Non-success upstream bodies are cancelled. Errors return fixed codes without model output, credentials or exception details.

Unauthenticated requests, duplicate Authorization headers, unknown routes, busy requests, non-JSON input and oversized declared input close their connection after the error response. Ollama remains loopback-only and this change adds no public route, firewall rule, automatic startup or permission. These controls reduce resource retention; they do not replace external access controls, abuse protection, network isolation or production load testing.

## Manual connectivity check in the app

The GAS settings dialog offers an explicit bridge connectivity check. GAS derives `/zero/health` from the already configured `/zero/chat` URL, uses the existing bearer secret and refuses redirects. Only a recognized bridge response becomes connected/busy. No prompt or history is sent and no model is started. The public result contains only a state, timestamp and cache flag, never model names, URL or credentials. Results are shared for at most15seconds; a separate85second lease prevents overlapping probes. Each actual probe uses the existing external-request protection budget, not the generation quota. A healthy bridge does not prove model availability or successful generation.

## Read-only runtime check

After setting the same `ZERO_AI_SECRET` and optional port/model environment variables used for the bridge, run:

```powershell
node CloudServer.mjs --check
```

From this source tree, use `node cloud/CloudServer.mjs --check`. This mode does not start a server. It makes only local GET requests to Ollama `/api/version`, `/api/tags`, and the authenticated bridge `/zero/health`. Redirects are refused, each body is bounded, and the complete probe has a5second timeout. Without a valid secret, the bridge is reported as unverified; no unauthenticated health request is sent.

The JSON report lists the Ollama version, bridge response/busy state, and whether the required approved model tags are registered. If a valid bridge response reports the14B translation route, that model is checked as well. Only the required model names, reported digest and size are included; other installed model names, paths, hostnames, environment contents and credentials are not output. Exit0 means these checks passed, exit2 means attention is needed, and exit1 means an invalid invocation or configuration. A busy but responding bridge can pass the diagnostic while `readyToAccept` remains false.

No prompt, generation, pull, model load, service restart, firewall change or Google request occurs. The report does not test model file checksums, GPU execution, answer quality, speed, the public tunnel, or network isolation. It is an operator diagnostic, not production readiness certification. Official metadata endpoints: [list models](https://docs.ollama.com/api/tags) and [version specification](https://github.com/ollama/ollama/blob/main/docs/openapi.yaml).

## One-request local measurement

To measure one real general-generation request, explicitly run this separate command with the same bridge secret and port environment settings:

```sh
node CloudServer.mjs --measure
```

In this source tree, use `node cloud/CloudServer.mjs --measure`. Unlike `--check`, this command generates a response and can load the general model. It first checks the authenticated loopback bridge health and approved model names. If the bridge is already busy, it stops without generating. Otherwise it sends exactly one fixed Japanese question about the four seasons, with empty history, through the existing `/zero/chat` route. That route retains its usual single-request generation slot and time limit. There is no automatic retry, translation request, model download, server restart, GAS request or conversation database write.

The report contains a UTC timestamp, completion state, approved model name, local end-to-end `elapsedMS`, Unicode code-point `responseCharacters`, and finish reason. Only `stop` is completed; truncated or unknown termination is incomplete. Exit0 means this one request completed, Exit2 means it did not, and Exit1 means invalid configuration or invocation. It omits the generated text, credentials, user prompts, file paths and raw errors.

After a valid generation response it reads Ollama's fixed loopback [GET /api/ps](https://docs.ollama.com/api/ps), with a further limit of five seconds inside the overall seventy-second deadline. For the measured model alone, it reports Ollama's `size` as `reportedSizeBytes`, `size_vram` as `reportedVramBytes`, and optional `context_length`. A model already released is `not_loaded`; invalid or unavailable metadata stays `unavailable` without discarding the completed generation timing. These are reported model-memory values, not total GPU utilization, free VRAM, peak memory or independent proof that kernels executed on the GPU. Other installed or loaded model names and metadata are not included.

This is a single sample. Loading a cold model, other PC activity and response length affect time. It does not measure tokens per second, concurrent capacity, translation performance, answer quality, GAS, the browser, or Cloudflare latency. The existing bridge may leave the model loaded for five minutes after generation; the measurement does not unload it or change that policy. Do not run automatic polling or parallel measurements on the production PC.
