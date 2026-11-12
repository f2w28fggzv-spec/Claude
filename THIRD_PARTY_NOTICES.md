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
