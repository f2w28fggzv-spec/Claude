# Third-party notices

Besides its npm dependencies (see `package.json`; the MediaPipe runtime and pose model come from `@mediapipe/tasks-vision`), the app includes the following third-party data and font.

## Body and muscle outlines

`src/screens/bodyPaths.ts` contains SVG path data (male figure, front and back) copied from **react-native-body-highlighter** 3.2.0 by ELABBASSI Hicham (npm: `react-native-body-highlighter`). It is used under the MIT License:

```
MIT License

Copyright (c) 2022 ELABBASSI Hicham

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

## Bricolage Grotesque (font)

The app's typeface is **Bricolage Grotesque** (variable, weight and optical-size axes), installed from npm as `@fontsource-variable/bricolage-grotesque` and bundled with the app, so it is served from the app's own site. Copyright 2022 The Bricolage Grotesque Project Authors (https://github.com/ateliertriay/bricolage). It is licensed under the SIL Open Font License, Version 1.1; the full licence text is in `public/licenses/bricolage-grotesque-OFL.txt`, which is deployed with the app (`licenses/bricolage-grotesque-OFL.txt` on the site).

## Libraries inside MediaPipe's WebAssembly runtime

The pose-detection runtime (`mediapipe/wasm/vision_wasm_internal.wasm` and `.js`, from `@mediapipe/tasks-vision` 1.2.0, Apache-2.0) is the same in the web app and the iPhone app, and has these libraries compiled into it. The list comes from the runtime's own strings (the source paths and messages it names), the versions from the build files of MediaPipe's release `v1.2.0` (`WORKSPACE`, `MODULE.bazel`) and of the TensorFlow commit it pins (`a481b10260dfdf833a1b16007eead49c1d7febf3`). Each licence text, with the version and the URL it was read from (27 November 2026), is in `src/native/licenses/`, which the iPhone app shows in its Terms (section 7).

| Library | Version | Licence | Text |
|---|---|---|---|
| MediaPipe (Copyright The MediaPipe Authors; its licence adds a notice for code from Lucent Technologies) | 1.2.0 | Apache-2.0 | `mediapipe.txt`, `apache-2.0.txt` |
| TensorFlow Lite (its licence adds a BSD notice for code derived from Caffe) | commit `a481b102…` | Apache-2.0 | `wasm-runtime-apache-2.0.txt` |
| LiteRT | 2.3.0 | Apache-2.0 | `wasm-runtime-apache-2.0.txt` |
| Abseil | 20260526.0 | Apache-2.0 | `wasm-runtime-apache-2.0.txt` |
| OpenCV (its COPYRIGHT file is quoted) | 4.10.0 | Apache-2.0 | `wasm-runtime-apache-2.0.txt` |
| ruy | commit `3286a34c…` | Apache-2.0 | `wasm-runtime-apache-2.0.txt` |
| gemmlowp | commit `16e8662c…` | Apache-2.0 | `wasm-runtime-apache-2.0.txt` |
| FlatBuffers | 25.9.23 | Apache-2.0 | `wasm-runtime-apache-2.0.txt` |
| OR-Tools (its topological sorter) | 9.11 | Apache-2.0 | `wasm-runtime-apache-2.0.txt` |
| TCMalloc (a malloc hook; no version pinned, main branch) | – | Apache-2.0 | `wasm-runtime-apache-2.0.txt` |
| XNNPACK | commit `53a1797b…` | BSD-3-Clause | `xnnpack-bsd-3-clause.txt` |
| pthreadpool (XNNPACK calls it; the runtime's strings don't name it, listed to be safe) | commit `02460584…` | BSD-2-Clause | `pthreadpool-bsd-2-clause.txt` |
| Protocol Buffers | 6.31.1 | BSD-3-Clause | `protobuf-bsd-3-clause.txt` |
| Eigen (source: https://gitlab.com/libeigen/eigen/-/tree/ea13a98decd497a8c5588fb5de71b57bcf10d864) | commit `ea13a98d…` | MPL-2.0, parts BSD | `eigen-mpl-2.0.txt` |
| fft2d (Takuya Ooura) | OouraFFT 1.0 | its own notice | `fft2d.txt` |
| zlib and MiniZip (reading the `.task` model files, which are zip archives) | 1.3.1 | Zlib | `zlib.txt` |
| Emscripten's JavaScript runtime and the musl C library (version not recorded in the runtime: main branch) | – | MIT (or NCSA) | `emscripten-mit.txt` |

The runtime also holds Google code with no public repository of its own (ML Drift, gloop), which comes with MediaPipe under its licence; Emscripten's C++ library (LLVM's libc++ and libc++abi) is under Apache-2.0 with LLVM Exceptions, which asks no notice for compiled code. To be checked in the legal review before a public launch: this list, fft2d's terms ("You may distribute this ORIGINAL package"), and whether XNNPACK's header-only helpers (FP16, FXdiv, MIT) need listing too.

## The iPhone app

The iPhone app (`ios/`) is the same web code inside **Capacitor** 8.6.3 (`@capacitor/ios`, `@capacitor/core`; MIT License, Copyright (c) 2017-present Drifty Co.), whose Cordova compatibility layer (CapacitorCordova) includes code from Apache Cordova (Copyright The Apache Software Foundation, Apache-2.0). It also ships the MediaPipe runtime above and the pose models, Preact (MIT), the body outlines and the font (above). The app shows every licence in its Terms of service (section 7), from the texts in `src/native/licenses/`.
