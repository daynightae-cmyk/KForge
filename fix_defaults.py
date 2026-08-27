import glob, os
base = "C:/Users/day night/.traycer/worktrees/daynightae-cmyk__kforge/recovery-world-class-hardening/client/workbench/"
for path in glob.glob(os.path.join(base, "*Surface.tsx")):
    fname = os.path.basename(path)
    # Get component name from filename
    name = fname.replace("Surface.tsx", "")
    component_name = name[0].upper() + name[1:] + "Surface"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    # Only add default export if not present
    if "export default" not in content:
        content += f"\nexport default {component_name};\n"
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"Added default export to {fname}: {component_name}")
    else:
        print(f"Already has default export: {fname}")
