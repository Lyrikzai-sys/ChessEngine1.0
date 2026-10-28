# Prebuilt binaries

Windows x64, built from the commit that added them.

| file | what it is |
|---|---|
| `Voxel-Chess-1.0.0-x64-setup.exe` | NSIS installer, ~2.2 MB |
| `voxel-chess.exe` | the application itself, ~8.7 MB, runs without installing |

Neither is code-signed, so Windows SmartScreen will warn on first run.

## Rebuilding

```
npm install
npm run tauri build
```

Output lands in `src-tauri/target/release/bundle/nsis/`.

On Windows this needs the MSVC toolchain, because one of Tauri's build
dependencies compiles C++. If the build fails with
`C1083: Cannot open include file: 'excpt.h'`, the Visual Studio install on
PATH is missing its C++ headers rather than anything being wrong here. Ask
the installer which copy actually has the toolset:

```
"C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe" ^
  -all -products * ^
  -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 ^
  -property installationPath
```

then run that install's `VC\Auxiliary\Build\vcvars64.bat` before building.
A machine can easily carry both a broken and a working install at once.
