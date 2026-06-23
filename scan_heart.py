import bpy, re
kw = re.compile(r'(heart|ventricle|atrium|atrial|aorta|aortic|pulmonary trunk|mitral|tricuspid|papillary|myocard|coronary|vena cava|interventricular|cardiac|valve|chordae|septum of heart|auricle)', re.I)
print("=== COLLECTIONS matching cardiac ===")
for c in bpy.data.collections:
    if re.search(r'(heart|cardia|cardiovascular)', c.name, re.I):
        ms=[o.name for o in c.all_objects if o.type=='MESH' and len(o.data.polygons)>0]
        if ms: print(f"\nCOLL '{c.name}' -> {len(ms)} meshes"); [print('   ',m) for m in ms[:60]]
print("\n=== individual cardiac meshes (any collection) ===")
seen=set()
def tri(o): return sum(len(p.vertices)-2 for p in o.data.polygons)
for o in bpy.data.objects:
    if o.type=='MESH' and len(o.data.polygons)>0 and kw.search(o.name) and o.name not in seen:
        seen.add(o.name); print(f"   {o.name[:50]:50} tris~={tri(o)}")
