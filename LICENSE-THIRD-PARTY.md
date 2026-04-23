# LICENSE-THIRD-PARTY

OMCC includes content derived from upstream MIT-licensed projects. Their copyright notices and license terms are preserved here and in `licenses/`.

## oh-my-claudecode (primary upstream — MIT)

- Repository: <https://github.com/Yeachan-Heo/oh-my-claudecode>
- License: MIT
- Source SHA imported: see `docs/ATTRIBUTION.md`
- License text: [`licenses/oh-my-claudecode.LICENSE`](./licenses/oh-my-claudecode.LICENSE)

Files in `.github/agents/`, `.github/skills/`, `.github/copilot-instructions.md`, `templates/`, and parts of `bridge/` are derived from this upstream. See `docs/ATTRIBUTION.md` for per-file provenance.

```text
MIT License

Copyright (c) 2025 Yeachan Heo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## oh-my-githubcopilot (design inspiration only)

- Repository: <https://github.com/jmstar85/oh-my-githubcopilot>
- License status: **ambiguous** — README declares MIT but no `LICENSE` file is present in the repository, and the README footer simultaneously asserts "© 2026 jmstar85. All rights reserved." Because of this contradiction, OMCC does **not** copy text or code from this upstream.
- OMCC's hook-extension architecture and `omcc init/setup/doctor` CLI shape were design-inspired by patterns observed in this project. No source text is included.
- A courtesy issue has been filed asking the upstream to add an explicit `LICENSE` file. If/when added under MIT, future OMCC versions may adopt OMG-original files with attribution.
