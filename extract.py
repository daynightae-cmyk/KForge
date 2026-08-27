workbench_path = "C:/Users/day night/.traycer/worktrees/daynightae-cmyk__kforge/recovery-world-class-hardening/client/workbench/KForgeWorkbench.tsx"
with open(workbench_path, "r", encoding="utf-8") as f:
    content = f.read()

def extract(start_name, end_name):
    s = content.find(start_name)
    e = content.find(end_name)
    if s == -1 or e == -1:
        print(f"MISSING: {start_name} or {end_name}")
        return ""
    return content[s:e].strip()

names = [
    ("function ProjectsSurface", "function OnlineSurface", "projectsSurface.tsx"),
    ("function OnlineSurface", "function AISurface", "onlineSurface.tsx"),
    ("function AISurface", "function QualitySurface", "aiSurface.tsx"),
    ("function QualitySurface", "function DeveloperSurface", "qualitySurface.tsx"),
    ("function DeveloperSurface", "function RemoteSurface", "developerSurface.tsx"),
    ("function RemoteSurface", "function ReleaseSurface", "remoteSurface.tsx"),
    ("function ReleaseSurface", "function SystemSurface", "releaseSurface.tsx"),
    ("function SystemSurface", "function IntelligenceSurface", "systemSurface.tsx"),
    ("function IntelligenceSurface", "function SimpleFetchSurface", "intelligenceSurface.tsx"),
]

base = "C:/Users/day night/.traycer/worktrees/daynightae-cmyk__kforge/recovery-world-class-hardening/client/workbench/"
for start, end, file_name in names:
    code = extract(start, end)
    with open(base + file_name, "w", encoding="utf-8") as f:
        f.write(code + "\n")
    print(f"WROTE {file_name} ({len(code)} chars)")
