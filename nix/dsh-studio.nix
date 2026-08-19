# DSH Studio package builder.
#
# dshSource selects where the pinned DeepSeek Harness runtime comes from:
#   "llm-agents"  (default) — numtide/llm-agents.nix, pre-built npm package
#   "pinned"                — this repo's dsh-source.json revision, built from source
#   "nixpkgs"               — pkgs.deepseek-harness (kept as a placeholder; the
#                             nixpkgs PR is not yet merged, so this throws)

{ pkgs, system, llm-agents, dshSourceSpec }:

{ surface # "full" | "web" | "tui"
, dshSource ? "llm-agents"
}:

let
  lib = pkgs.lib;

  isFull = surface == "full";
  includesWeb = surface != "tui";
  includesTui = surface != "web";

  # ---------------------------------------------------------------------------
  # DSH runtime selection
  # ---------------------------------------------------------------------------

  dshRuntime =
    if dshSource == "llm-agents" then
      llm-agents.packages.${system}.dsh
    else if dshSource == "pinned" then
      pkgs.callPackage ./dsh-runtime-pinned.nix { inherit dshSourceSpec; }
    else if dshSource == "nixpkgs" then
      # Reserved: the nixpkgs deepseek-harness PR has not landed yet.
      pkgs.deepseek-harness or (throw ''
        dshSource = "nixpkgs" requires pkgs.deepseek-harness, which is not yet
        in nixpkgs (see NixOS/nixpkgs#552467). Use "llm-agents" (default) or
        "pinned" for now.
      '')
    else
      throw "unknown dshSource: ${dshSource}";

  # ---------------------------------------------------------------------------
  # DSH Studio front-end bundle. The same build produces all surface adapters;
  # the outer derivation controls which launchers and renderers are exposed.
  cleanSource = lib.cleanSourceWith {
    src = ../.;
    filter = path: type:
      let base = baseNameOf path;
      in !(lib.hasSuffix ".nix" base)
      && base != "flake.lock"
      && base != "release"
      && base != ".stage"
      && base != ".cache"
      && base != "node_modules"
      && base != "dist";
  };

  betterSidebarSrc = pkgs.fetchFromGitHub {
    owner = "omdsh-dev";
    repo = "DSH-better-sidebar";
    rev = "2e9db44a71bb75c9fa1185330541dce2582deee3";
    hash = "sha256-VQ8lyHNtcTHrOum21Z4dZyZgrxexmUY7yEN8kjao838=";
  };
  tuiSrc = pkgs.fetchFromGitHub {
    owner = "ccch1mneyyy";
    repo = "dsh-TUI";
    rev = "6a8956678fc3746ed14b62bfee066ee8fc68f3cb";
    hash = "sha256-dxR0MdhKY+HHbLOZscCpNaww1Clfxc781HxmBg8kpcg=";
  };

  # fetchPnpmDeps and the real build MUST see the same workspace graph.
  source = pkgs.runCommand "dsh-studio-source" { } ''
    cp -r ${cleanSource} $out
    chmod -R u+w $out
    rm -rf $out/upstream/DSH-better-sidebar $out/upstream/dsh-TUI
    cp -r ${betterSidebarSrc} $out/upstream/DSH-better-sidebar
    cp -r ${tuiSrc} $out/upstream/dsh-TUI
  '';

  dshStudioBundle = pkgs.stdenv.mkDerivation rec {
    pname = "dsh-studio-${surface}-bundle";
    version = (builtins.fromJSON (builtins.readFile ../package.json)).version;

    src = source;

    pnpmDeps = pkgs.fetchPnpmDeps {
      inherit pname version src;
      fetcherVersion = 4;
      hash = "sha256-fxLfVxTAqQrLdYmuRgQhiUm3WT4lhqBBecAfZ7745JU=";
    };

    nativeBuildInputs = [
      pkgs.nodejs_24
      pkgs.pnpm
      pkgs.pnpmConfigHook
    ];

    # The upstream build scripts (esbuild) are what produce dist/.
    buildPhase = ''
      runHook preBuild

      # The full release pipeline (build:dsh + stage:dsh) is skipped on purpose:
      # the DSH runtime is provided by ${dshSource} instead of the staged copy.
      node scripts/build.mjs

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p $out/lib/dsh-studio
      cp -r dist $out/lib/dsh-studio/
      cp -r bin $out/lib/dsh-studio/
      cp package.json $out/lib/dsh-studio/

      # Carry package manifests so the final package can register the selected
      # surfaces into dsh-runtime/node_modules (mirrors stage-dsh.mjs).
      mkdir -p $out/lib/dsh-studio/manifests
      cp package.json $out/lib/dsh-studio/manifests/desktop.json
      for p in plugins/*/package.json; do
        name=$(basename $(dirname "$p"))
        cp "$p" "$out/lib/dsh-studio/manifests/$name.json"
      done
      cp web/package.json $out/lib/dsh-studio/manifests/web.json
      cp upstream/dsh-TUI/package.json $out/lib/dsh-studio/manifests/tui-renderer.json

      # Copy the pinned renderer and apply the guarded DSH Studio adaptation.
      mkdir -p $out/lib/dsh-studio/tui-renderer
      cp -r upstream/dsh-TUI/lib upstream/dsh-TUI/skills \
        upstream/dsh-TUI/cordis.patch.yml upstream/dsh-TUI/cordis.yml \
        upstream/dsh-TUI/LICENSE $out/lib/dsh-studio/tui-renderer/
      node -e "import('./scripts/tui-upstream-adapter.mjs').then(({ adaptTuiRendererPackage }) => adaptTuiRendererPackage('$out/lib/dsh-studio/tui-renderer'))"

      # Collect runtime dependency closures that the DSH runtime may not ship.
      mkdir -p $out/lib/dsh-studio/extra-deps
      ${pkgs.python3}/bin/python3 ${./collect-deps.py} \
        node_modules/.pnpm \
        plugins/better-sidebar-runtime/package.json \
        $out/lib/dsh-studio/extra-deps
      ${pkgs.python3}/bin/python3 ${./collect-deps.py} \
        node_modules/.pnpm \
        upstream/dsh-TUI/package.json \
        $out/lib/dsh-studio/extra-deps

      runHook postInstall
    '';

    # Electron is supplied by nixpkgs only in the full outer package.
    env.ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
  };

in
pkgs.stdenv.mkDerivation {
  pname = "dsh-studio-${if isFull then "desktop" else surface}${lib.optionalString (dshSource != "llm-agents") "-${dshSource}"}";
  version = dshStudioBundle.version;

  dontUnpack = true;

  nativeBuildInputs = [ pkgs.makeWrapper ];

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/dsh-studio $out/bin

    # DSH Studio built assets
    cp -r ${dshStudioBundle}/lib/dsh-studio/dist $out/lib/dsh-studio/dist
    cp ${dshStudioBundle}/lib/dsh-studio/package.json $out/lib/dsh-studio/package.json

    # DSH runtime
    mkdir -p $out/dsh-runtime
    cp -r ${dshRuntime}/lib/dsh/* $out/dsh-runtime/
    chmod -R u+w $out/dsh-runtime
    chmod +x $out/dsh-runtime/lib/bin.js || true

    # Node runtime: reuse the same nodejs that built the bundle. The DSH
    # runtime's HMR service requires --expose-internals (upstream releases
    # ship the flag baked into their launcher; we wrap node itself).
    mkdir -p $out/node-runtime/bin
    makeWrapper ${pkgs.nodejs_24}/bin/node $out/node-runtime/bin/node \
      --add-flags "--expose-internals"

    # Register DSH Studio packages into dsh-runtime/node_modules so the DSH
    # profile loader can resolve them (mirrors installDesktopPackages in
    # scripts/stage-dsh.mjs).
    ${pkgs.python3}/bin/python3 ${./register-plugins.py} \
      ${dshStudioBundle}/lib/dsh-studio \
      $out/lib/dsh-studio/dist \
      $out/dsh-runtime \
      ${surface}

    # Copy plugin runtime dependencies that the DSH runtime does not ship
    # (e.g. schemastery for better-sidebar-runtime).
    if [ -d "${dshStudioBundle}/lib/dsh-studio/extra-deps" ]; then
      for dep in ${dshStudioBundle}/lib/dsh-studio/extra-deps/*/; do
        name=$(basename "$dep")
        if [ ! -d "$out/dsh-runtime/node_modules/$name" ]; then
          cp -r "$dep" "$out/dsh-runtime/node_modules/$name"
          chmod -R u+w "$out/dsh-runtime/node_modules/$name"
        fi
      done
    fi

    # HMR is a development-time feature that requires --expose-internals;
    # the packaged runtime keeps it enabled (matching upstream releases).

    # dsh-studio launcher
    makeWrapper ${pkgs.nodejs_24}/bin/node $out/bin/dsh-studio \
      --add-flags "$out/lib/dsh-studio/dist/dsh-studio.js" \
      --set DSH_STUDIO_WEB_ROOT "$out" \
      --set DSH_STUDIO_TUI_ROOT "$out" \
      --set DSH_STUDIO_SURFACES "${if isFull then "desktop,web,tui" else surface}" \
      ${lib.optionalString isFull ''
        --set DSH_STUDIO_DESKTOP_APP "$out/bin/dsh-studio" \
      ''}

    ${lib.optionalString isFull ''
      # Electron wrapper. DSH_STUDIO_RESOURCES_ROOT is required because loading
      # dist/main.js directly keeps app.isPackaged false under Nix.
      makeWrapper ${pkgs.electron_42}/bin/electron $out/bin/dsh-studio \
        --add-flags "$out/lib/dsh-studio/dist/main.js" \
        --set DSH_STUDIO_RESOURCES_ROOT "$out" \
        --set DSH_STUDIO_WEB_ROOT "$out"

      mkdir -p $out/share/applications
      cat > $out/share/applications/dsh-studio.desktop <<EOF
      [Desktop Entry]
      Name=DSH Studio
      Exec=$out/bin/dsh-studio
      Type=Application
      Categories=Development;
      EOF
    ''}

    runHook postInstall
  '';

  meta = with lib; {
    description = "DSH Studio ${if isFull then "full Desktop/Web/TUI" else if includesWeb then "Web" else "TUI"} distribution";
    homepage = "https://github.com/hust-open-atom-club/oh-dsh";
    license = licenses.mit;
    platforms = platforms.linux;
    mainProgram = "dsh-studio";
  };
}
