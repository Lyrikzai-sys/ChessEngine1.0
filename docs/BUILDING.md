# Building

## Browser

```bash
npm install
npm run dev
```

## Desktop

```bash
npm run tauri build
```

Produces an NSIS installer and a standalone executable in
`src-tauri/target/release/bundle/nsis/` and `src-tauri/target/release/`.

Prebuilt Windows binaries are attached to the
[GitHub Releases](../../releases) page rather than committed here, so they
stay out of git history. They are not code-signed, so Windows SmartScreen
warns on first run.

## The Windows toolchain trap

Tauri pulls in a build dependency that compiles C++, so the MSVC toolchain has
to be present and complete. If the build fails with:

```
fatal error C1083: Cannot open include file: 'excpt.h'
```

the problem is the Visual Studio installation, not this project. A machine can
carry a broken install and a working one at the same time — which is exactly
what happened here:

```
...\Microsoft Visual Studio\18\Community\VC\Tools\MSVC\14.51.36231\
    include\   0 files
    lib\       onecore only, no x64
    VC\Auxiliary\Build\vcvarsall.bat   missing

...\Microsoft Visual Studio\18\BuildTools\VC\Tools\MSVC\14.50.35717\
    include\   271 files, excpt.h present
    lib\x64\   108 files
```

`cl.exe` existed in the first one but had no standard headers, which produces
a compiler error that reads like a source problem.

Ask the installer which copy actually has the C++ toolset rather than trusting
whichever Visual Studio is on `PATH`:

```bat
"C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe" ^
  -all -products * ^
  -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 ^
  -property installationPath
```

Then run that install's `VC\Auxiliary\Build\vcvars64.bat` before building.

## Tests

```bash
npm test
npm run typecheck
```
