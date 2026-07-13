# KaiyunCode Asynchronous Image API

This reference reflects the bundled, validated intersection of the production
API tutorial and public model catalog. The bundled JSON snapshot remains the
machine-readable authority for request construction.

## Endpoint Allowlist

| Purpose | Method | Path |
| --- | --- | --- |
| Generate | POST | `/v1/images/async/generations` |
| Edit | POST | `/v1/images/async/edits` |
| Poll | GET | `/v1/images/async/{task_id}` |

There is no synchronous image interface. A POST returns `task_id` or `id`; the
runner then polls with GET. A paid POST is submitted once and is never
automatically retried.

## Production Capabilities

| Capability key | Models | Input profile |
| --- | --- | --- |
| `image_text_generation` | `gpt-image-2`, `gpt-image-2-mid-adobe`, `gpt-image-2-high-adobe`, `gemini-3.1-flash-image`, `gemini-3.0-pro-image`, `wan2.7-image-pro` | Required non-empty `prompt` |
| `image_edit` | Same six public models | Required `prompt` and `image`; protocol is the selected snapshot variant, including JSON generations or URL/file multipart edits |
| `image_multi_reference` | Same six public models | Required `prompt` and repeated `image_urls[]` |
| `image_sequential_generation` | Two Wan profiles under `wan2.7-image-pro` | Required `prompt` and `enable_sequential=true`; the reference profile also requires `image_urls[]` |

`gpt-image-2-max` has been removed from the production public catalog. Tutorial
residue must not make it selectable.

The two sequential Wan profiles share the same capability key and model. The
runner distinguishes them from their normalized parameter schemas: presence of
`image_urls[]` selects the reference profile. This is schema selection, not
protocol inference from a model name.

## Important Parameters

| Parameter | Production constraints |
| --- | --- |
| `prompt` | Required non-empty string |
| `n` | Most profiles document 1; Wan regular generation documents 1-4; Wan sequential generation allows at most 12 |
| `output_format` | `png`, `jpeg`, or `webp` |
| `output_compression` | 0-100 |
| `response_format` | `url` or `b64_json` |
| `background` | `opaque`, `auto`, or `transparent` |
| `moderation` | `auto` or `low` |
| `image_size` | Adobe aliases use `1K`, `2K`, or `4K`; do not replace it with `size` |
| `aspect_ratio` | Use only ratios listed by the selected adapter |
| `enable_sequential` | Must be `true` for sequential generation |
| `image_urls[]` | Public HTTPS URL or image data URL; Wan reference and reference-sequential profiles allow at most 9 images |

The runner validates the actual parameter table attached to the exact adapter.
Do not treat this summary as permission to copy a parameter between models.

## Files And URLs

- JSON media fields reject local paths. Use a public HTTPS URL or image data URL.
- Local edit inputs are read into `Blob` values and sent only through a multipart variant that documents the matching upload field.
- `--image` is repeatable. The selected adapter controls whether one or multiple multipart `image` fields are valid.
- Wan image edit preserves repeated remote `--image` URLs in order. A single remote URL is sent once; other adapters reject counts above their documented multipart cardinality.
- `--mask` may be a URL or local file, but submission stops unless the selected snapshot variant documents the corresponding field.
- Dry-run summaries contain only safe file metadata such as a basename, never the file contents or full local directory.

## CLI

```text
--capability KEY       Required exact capability key
--model MODEL          Required exact public model
--prompt TEXT          Image prompt
--param KEY=VALUE      Repeat for adapter parameters
--image URL_OR_PATH    Repeat for references or documented multipart files
--mask URL_OR_PATH     Edit mask
--task-id ID           Resume polling without a POST
--output PATH          Result destination
--credential-source S  Prefer env|file|codex|claude for this run
--dry-run              Validate and print a human confirmation card (no network)
--json                 Print full JSON (includes confirmCard on dry-run)
```

Media credentials resolve as `env > file` (canonical `~/.codex/kaiyun-tools.env`).
Codex/Claude keys are fallback only when both are absent. Default dry-run
stdout is a human-readable confirmation card that agents must paste into chat
before paid POST.

Resume is independent of the original submission fields:

```bash
node <skill-dir>/scripts/kaiyuncode-image.mjs \
  --task-id img_paid_123 \
  --output ./result.png
```

This path skips capability loading and POST request construction, resolves a
credential for GET polling, and persists the result.

API keys are deliberately not accepted as CLI arguments.

## Results

The polling response accepts the production URL and `b64_json` result shapes.
URL results are downloaded through a temporary sibling and atomically renamed.
Base64 results are decoded strictly, written through a temporary sibling, and
atomically renamed. The returned object contains:

```json
{
  "taskId": "image_task_id",
  "status": "completed",
  "url": "https://cdn.example/result.png?token=%5BREDACTED%5D",
  "path": "/absolute/path/result.png"
}
```

The `url` field is absent for a base64-only result. Signed or sensitive query
values are redacted from reporting.
