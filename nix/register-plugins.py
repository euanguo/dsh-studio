"""Register DSH Studio plugin packages into dsh-runtime/node_modules.

Mirrors installDesktopPackages() from scripts/stage-dsh.mjs: selected plugin
manifests are copied into node_modules/<name>/package.json with build/scripts/
devDependencies stripped, and compiled files are placed beside them.

Usage: register-plugins.py <bundleRoot> <distRoot> <dshRuntimeRoot> <surface>
  bundleRoot     — dsh-studio bundle output (contains manifests/ and tui-renderer/)
  distRoot       — final package dist root ($out/lib/dsh-studio/dist)
  dshRuntimeRoot — $out/dsh-runtime
  surface        — full, web, or tui
"""

import json
import os
import shutil
import sys

def main():
    bundle_root, dist_root, dsh_runtime, surface = sys.argv[1:5]
    manifests_dir = os.path.join(bundle_root, "manifests")
    node_modules = os.path.join(dsh_runtime, "node_modules")

    # manifest key -> compiled output under distRoot. The desktop root is the
    # only package whose files live directly under distRoot.
    plugin_dirs = {
        "desktop": "",
        "web": "web",
        "tui": os.path.join("plugins", "tui"),
        "skins": os.path.join("plugins", "skins"),
        "sidebar": os.path.join("plugins", "sidebar"),
        "panel-controls": os.path.join("plugins", "panel-controls"),
        "pinned-summary": os.path.join("plugins", "pinned-summary"),
        "plugin-marketplace": os.path.join("plugins", "plugin-marketplace"),
        "better-sidebar-runtime": os.path.join("plugins", "better-sidebar-runtime"),
        "vision": os.path.join("plugins", "vision"),
    }
    selected = {
        "full": set(plugin_dirs) | {"tui-renderer"},
        "web": {"web", "skins", "sidebar", "panel-controls", "pinned-summary", "better-sidebar-runtime", "vision"},
        "tui": {"tui", "tui-renderer", "skins", "vision"},
    }.get(surface)
    if selected is None:
        raise ValueError(f"unknown DSH Studio surface: {surface}")
    installed_versions = {}

    for manifest_file in sorted(os.listdir(manifests_dir)):
        plugin_key = manifest_file.removesuffix(".json")
        if plugin_key not in selected:
            continue
        with open(os.path.join(manifests_dir, manifest_file)) as f:
            manifest = json.load(f)

        for key in ("build", "devDependencies", "scripts"):
            manifest.pop(key, None)

        name = manifest.get("name")
        package_dir = os.path.join(node_modules, *name.split("/"))
        os.makedirs(package_dir, exist_ok=True)

        with open(os.path.join(package_dir, "package.json"), "w") as f:
            json.dump(manifest, f, indent=2)
            f.write("\n")

        deps_link = os.path.join(package_dir, "node_modules")
        if plugin_key == "tui-renderer":
            # The renderer requires React 19 while the Web runtime carries
            # React 18. Keep its direct dependency graph package-local.
            os.makedirs(deps_link, exist_ok=True)
            dependency_names = set(manifest.get("dependencies", {}))
            dependency_names.update(manifest.get("peerDependencies", {}))
            extra_deps = os.path.join(bundle_root, "extra-deps")
            for dependency in sorted(dependency_names):
                extra = os.path.join(extra_deps, *dependency.split("/"))
                shared = os.path.join(node_modules, *dependency.split("/"))
                target = extra if os.path.isdir(extra) else shared
                if not os.path.isdir(target):
                    raise FileNotFoundError(f"missing TUI runtime dependency: {dependency}")
                link = os.path.join(deps_link, *dependency.split("/"))
                os.makedirs(os.path.dirname(link), exist_ok=True)
                os.symlink(target, link)
        else:
            # Other bundled plugins use the DSH runtime's dependency graph.
            os.symlink(node_modules, deps_link)

        # Copy the compiled package files.
        if plugin_key == "tui-renderer":
            src_base = os.path.join(bundle_root, "tui-renderer")
            for fname in os.listdir(src_base):
                src = os.path.join(src_base, fname)
                dst = os.path.join(package_dir, fname)
                if os.path.isdir(src):
                    shutil.copytree(src, dst)
                else:
                    shutil.copy2(src, dst)
        else:
            dist_subdir = plugin_dirs[plugin_key]
            src_base = os.path.join(dist_root, dist_subdir)
            dst_dir = os.path.join(package_dir, "dist")
            os.makedirs(dst_dir, exist_ok=True)
            if plugin_key == "desktop":
                filenames = ("plugin.js", "client.js", "client.js.map", "cordis.patch.yml")
            else:
                filenames = os.listdir(src_base)
            for fname in filenames:
                src = os.path.join(src_base, fname)
                if os.path.exists(src):
                    shutil.copy2(src, os.path.join(dst_dir, fname))

        installed_versions[name] = manifest["version"]
        print(f"registered {name}")

    # Merge registered dsh-studio package names into the dsh runtime's
    # package.json dependencies so healProfilesModuleFallback links them
    # into the profile's module fallback (mirrors stage-dsh.mjs:616-621).
    cli_manifest_path = os.path.join(dsh_runtime, "package.json")
    with open(cli_manifest_path) as f:
        cli_manifest = json.load(f)
    deps = cli_manifest.setdefault("dependencies", {})
    deps.update(installed_versions)
    with open(cli_manifest_path, "w") as f:
        json.dump(cli_manifest, f, indent=2)
        f.write("\n")

if __name__ == "__main__":
    main()
