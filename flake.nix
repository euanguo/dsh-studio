{
  description = "DSH Studio: installable Desktop, Web, and TUI distributions";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    llm-agents = {
      url = "github:numtide/llm-agents.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, llm-agents }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;

      # The version of deepseek-harness pinned by this repository.
      dshSourceSpec = builtins.fromJSON (builtins.readFile ./dsh-source.json);
    in
    {
      devShells = forAllSystems (system:
        let pkgs = nixpkgs.legacyPackages.${system}; in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_24
              pkgs.pnpm
              pkgs.git
              pkgs.curl
              pkgs.python3 # node-gyp
              pkgs.pkg-config
            ];

            # pnpm install fetches its own electron; no nixpkgs electron here.
            shellHook = ''
              export DSH_STUDIO_SOURCE_ROOT="$PWD"
            '';
          };
        });

      packages = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          mkDshStudio = import ./nix/dsh-studio.nix {
            inherit pkgs system llm-agents dshSourceSpec;
          };
        in
        rec {
          # Full distribution: Desktop, Web, and TUI through one launcher.
          dsh-studio = mkDshStudio { surface = "full"; dshSource = "llm-agents"; };
          dsh-studio = dsh-studio;

          # Layered distributions without Electron.
          dsh-studio-web = mkDshStudio { surface = "web"; dshSource = "llm-agents"; };
          dsh-studio-tui = mkDshStudio { surface = "tui"; dshSource = "llm-agents"; };

          # Variants pinning the DSH runtime to this repo's dsh-source.json.
          dsh-studio-pinned = mkDshStudio { surface = "full"; dshSource = "pinned"; };
          dsh-studio-pinned = dsh-studio-pinned;
          dsh-studio-web-pinned = mkDshStudio { surface = "web"; dshSource = "pinned"; };
          dsh-studio-tui-pinned = mkDshStudio { surface = "tui"; dshSource = "pinned"; };

          # "nixpkgs" variants remain available through mkDshStudio once
          # pkgs.deepseek-harness lands (NixOS/nixpkgs#552467).

          default = dsh-studio;
        });
    };
}
